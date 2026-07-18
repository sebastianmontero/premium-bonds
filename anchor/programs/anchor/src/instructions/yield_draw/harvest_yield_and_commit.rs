use crate::constants::DISCRIMINATOR;
use crate::constants::{DRAW_CYCLE_SEED, GLOBAL_CONFIG_SEED, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::huma;
use crate::state::{DrawCycle, DrawStatus, GlobalConfig, PoolStatus, PrizePool, TicketRegistry};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounting-only yield harvest — no token movements.
///
/// Reads the $PST price from Huma's PoolState on-chain to calculate
/// the yield accrued since last harvest, without redeeming any $PST.
///
/// Flow:
/// 1. Read total_assets from Huma PoolState + $PST supply from mode mint.
/// 2. Calculate: current_value = pool_pst_balance × (total_assets / pst_supply)
/// 3. yield = current_value − total_deposited_principal − total_fees_accrued
/// 4. fee = yield × fee_basis_points / 10000
/// 5. prize_pot = yield − fee
/// 6. Accrue fee to pool.total_fees_accrued (no transfer)
/// 7. Create draw cycle with prize_pot
#[derive(Accounts)]
pub struct HarvestYieldAndCommit<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        init,
        payer = crank,
        space = DISCRIMINATOR + DrawCycle::INIT_SPACE,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.current_draw_cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    /// Pool's $PST vault — read balance to calculate current value.
    #[account(
        seeds = [POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = pst_mint,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Huma $PST mint — read supply for price calculation.
    #[account(
        mint::token_program = pst_token_program
    )]
    pub pst_mint: Box<InterfaceAccount<'info, Mint>>,

    // ── Huma Finance read-only account ──────────────────────────────────────
    /// CHECK: Huma PoolState — deserialized manually to read ModeState.assets.
    /// Validated by the Huma program ID ownership check.
    #[account(constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID)]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: Validated in handler via owner check
    #[account(
        constraint = randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub randomness_account: UncheckedAccount<'info>,

    pub pst_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<HarvestYieldAndCommit>) -> Result<()> {
    let pool = &mut ctx.accounts.pool;

    require!(
        pool.status == PoolStatus::Active,
        PremiumBondsError::PoolNotActive
    );

    require!(
        !pool.is_frozen_for_draw,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let current_time = Clock::get()?.unix_timestamp;
    require!(
        current_time >= pool.current_cycle_end_at,
        PremiumBondsError::CycleNotEnded
    );

    // ── Registry merge: Pending → Active ────────────────────────────────────
    let eligible_locked_count;
    {
        let mut ticket_registry = ctx.accounts.ticket_registry.load_mut()?;

        // Snapshot mature active tickets BEFORE merging.
        eligible_locked_count = ticket_registry.total_active_tickets;

        // O(1) block merge: Pending → Active for NEXT cycle eligibility.
        ticket_registry.total_active_tickets += ticket_registry.total_pending_tickets;
        ticket_registry.total_pending_tickets = 0;

        // Increment draw cycle to trigger lazy merges, and reset preparation index
        ticket_registry.draw_cycle_id += 1;
        ticket_registry.draw_prepared_up_to = 0;
    }

    // ── Accounting-only yield calculation ────────────────────────────────────
    //
    // Read $PST price from Huma PoolState to determine the USDC value of our
    // $PST holdings without moving any tokens.

    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = ctx.accounts.pst_mint.supply;
    let pool_pst_balance = ctx.accounts.pool_pst_vault.amount;

    // current_value = pool_pst_balance × total_assets / pst_supply
    let current_value = huma::pst_shares_to_usdc(pool_pst_balance, pst_supply, total_assets);

    // If there are no active tickets, we do not harvest any yield or accrue fees.
    // The yield will roll over naturally in the Huma pool and be harvested in a later cycle
    // when active tickets are present.
    let yield_generated = if eligible_locked_count > 0 {
        let fees_in_vault = pool
            .total_fees_accrued
            .checked_sub(pool.total_fees_withdrawn)
            .unwrap();

        let book_value = pool
            .total_deposited_principal
            .checked_add(fees_in_vault)
            .unwrap()
            .checked_add(pool.total_prizes_allocated)
            .unwrap();

        current_value.saturating_sub(book_value)
    } else {
        0
    };

    let fee = pool.calculate_fee(yield_generated);
    let net_yield = yield_generated.checked_sub(fee).unwrap();

    // Accrue fee (accounting only — no token transfer)
    if fee > 0 {
        pool.total_fees_accrued = pool.total_fees_accrued.checked_add(fee).unwrap();
        pool.total_fees_collected = pool.total_fees_collected.checked_add(fee).unwrap();
    }

    // ── Draw Cycle creation ─────────────────────────────────────────────────
    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    draw_cycle.pool_id = pool.pool_id;
    draw_cycle.cycle_id = pool.current_draw_cycle_id;
    draw_cycle.randomness_account = ctx.accounts.randomness_account.key();
    draw_cycle.harvest_slot = Clock::get()?.slot;

    if yield_generated > 0 && eligible_locked_count > 0 {
        require!(
            !pool.prize_tiers.is_empty(),
            PremiumBondsError::PrizeTiersNotConfigured
        );
        draw_cycle.status = DrawStatus::AwaitingRandomness;
        pool.is_frozen_for_draw = true;

        pool.total_prizes_allocated = pool
            .total_prizes_allocated
            .checked_add(net_yield)
            .ok_or(PremiumBondsError::MathOverflow)?;
    } else {
        draw_cycle.status = DrawStatus::Complete;
    }

    draw_cycle.locked_ticket_count = eligible_locked_count;
    draw_cycle.prize_pot = net_yield;
    draw_cycle.cycle_fee_collected = fee;

    pool.current_draw_cycle_id = pool.current_draw_cycle_id.checked_add(1).unwrap();
    pool.advance_cycle_end_at(current_time);

    msg!(
        "HarvestYieldAndCommit: cycle={}, pst_balance={}, current_value={}, yield={}, fee={}, prize_pot={}",
        draw_cycle.cycle_id,
        pool_pst_balance,
        current_value,
        yield_generated,
        fee,
        net_yield,
    );

    Ok(())
}
