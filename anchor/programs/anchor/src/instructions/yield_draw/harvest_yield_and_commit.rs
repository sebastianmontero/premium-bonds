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
///
/// # Accounts
///
/// * `crank`: The crank signer executing the harvest. Must match the `jobs_account` specified in `global_config`.
/// * `global_config`: The global configuration account for checking authorization of the crank signer.
/// * `pool`: The prize pool account containing pool configurations, fee parameters, and state.
/// * `ticket_registry`: The account loader for the ticket registry, used to snapshot and merge pending tickets into active tickets.
/// * `current_draw_cycle`: The new draw cycle account that is initialized to track the prize pot and randomness status.
/// * `pool_pst_vault`: The pool's $PST token account, whose balance is read to determine current holdings.
/// * `pst_mint`: The Huma $PST mint, whose supply is read to calculate the $PST price.
/// * `huma_pool_state`: The Huma pool state account containing assets information.
/// * `randomness_account`: The Switchboard randomness account.
/// * `pst_token_program`: The SPL Token program or Token2022 program for the PST mint and vault.
/// * `system_program`: The Solana System program.
///
/// # PDA Derivations
///
/// * `global_config`: PDA derived with seeds `[GLOBAL_CONFIG_SEED]` (i.e. `b"global_config"`)
/// * `pool`: PDA derived with seeds `[PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"prize_pool"`) and bump `pool.vault_authority_bump`
/// * `current_draw_cycle`: PDA initialized with seeds `[DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.current_draw_cycle_id.to_le_bytes().as_ref()]` (i.e. `b"draw_cycle"`) and a dynamic bump
/// * `pool_pst_vault`: PDA derived with seeds `[POOL_PST_SEED, pool.pool_id.to_le_bytes().as_ref()]` (i.e. `b"pool_pst_vault"`) and a dynamic bump
#[derive(Accounts)]
pub struct HarvestYieldAndCommit<'info> {
    /// The crank signer executing the harvest. Must match the `jobs_account` in the global configuration.
    #[account(mut)]
    pub crank: Signer<'info>,

    /// The global configuration account, checked to authorize the crank bot.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account, tracking deposit and prize status.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
        has_one = ticket_registry
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The ticket registry account loader, holding all active and pending tickets.
    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// The draw cycle account initialized for the current draw.
    #[account(
        init,
        payer = crank,
        space = DISCRIMINATOR + DrawCycle::INIT_SPACE,
        seeds = [DRAW_CYCLE_SEED, pool.load()?.pool_id.to_le_bytes().as_ref(), pool.load()?.current_draw_cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub current_draw_cycle: Box<Account<'info, DrawCycle>>,

    /// Pool's $PST vault — read balance to calculate current value.
    #[account(
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
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
    /// CHECK: This is the raw Huma PoolState account. It is unchecked because it is a foreign program account that is deserialized manually inside the instruction handler using the `huma::read_mode_assets` and `huma::read_huma_redemption_queue` helpers. To ensure safety, it is validated using an ownership constraint check (`huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID`) to verify it belongs to the official Huma program.
    #[account(constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID)]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: This is the raw randomness account from Switchboard On-Demand. It is unchecked because it is a foreign account owned by the Switchboard On-Demand program. Safety is guaranteed by the constraint check verifying that its owner matches the Switchboard On-Demand program ID (`switchboard_on_demand::get_switchboard_on_demand_program_id()`). In `reveal_and_pick_winners`, its data is also parsed and validated using `RandomnessAccountData::parse`.
    #[account(
        constraint = randomness_account.owner.to_bytes() == switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes() @ PremiumBondsError::InvalidRandomnessAccount
    )]
    pub randomness_account: UncheckedAccount<'info>,

    /// The SPL Token interface for the PST mint/vault.
    pub pst_token_program: Interface<'info, TokenInterface>,
    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Handles the yield harvest and draw cycle commitment.
///
/// It reads the $PST price from Huma's PoolState on-chain to compute the total
/// value of the pool's $PST holdings. It then calculates the yield accrued
/// since the last harvest by subtracting the book value (deposited principal +
/// accrued fees + allocated prizes) from the current value.
///
/// If yield is generated and there are active tickets, a fee is deducted and accrued to
/// the pool's fees, the rest goes to the prize pot of the new draw cycle, and the draw
/// cycle's status is set to `AwaitingRandomness` while locking the pool for the draw.
/// If no yield is generated or no active tickets exist, the draw cycle is completed immediately.
///
/// Additionally, it performs a block merge on the ticket registry, converting all pending
/// tickets from the previous cycle into active tickets for the next cycle.
pub fn handle(ctx: Context<HarvestYieldAndCommit>) -> Result<()> {
    let pool = &mut ctx.accounts.pool.load_mut()?;

    require!(
        pool.status == (PoolStatus::Active as u8),
        PremiumBondsError::PoolNotActive
    );

    require!(
        pool.is_frozen_for_draw == 0,
        PremiumBondsError::AwaitingRandomnessFreeze
    );

    let clock = Clock::get()?;
    let current_time = clock.unix_timestamp;
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
        ticket_registry.total_active_tickets = ticket_registry
            .total_active_tickets
            .checked_add(ticket_registry.total_pending_tickets)
            .ok_or(PremiumBondsError::MathOverflow)?;
        ticket_registry.total_pending_tickets = 0;

        // Increment draw cycle to trigger lazy merges, and reset preparation index
        ticket_registry.draw_cycle_id = ticket_registry
            .draw_cycle_id
            .checked_add(1)
            .ok_or(PremiumBondsError::MathOverflow)?;
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

    let fees_in_vault = pool
        .total_fees_accrued
        .checked_sub(pool.total_fees_withdrawn)
        .ok_or(PremiumBondsError::MathOverflow)?;

    let book_value = pool
        .total_deposited_principal
        .checked_add(fees_in_vault)
        .ok_or(PremiumBondsError::MathOverflow)?
        .checked_add(pool.total_prizes_allocated)
        .ok_or(PremiumBondsError::MathOverflow)?;

    // ── Base Draw Cycle metadata (unconditionally initialized) ───────────────
    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    draw_cycle.pool_id = pool.pool_id;
    draw_cycle.cycle_id = pool.current_draw_cycle_id;
    draw_cycle.randomness_account = ctx.accounts.randomness_account.key();
    draw_cycle.harvest_slot = clock.slot;
    draw_cycle.version = 1;

    // ── Circuit Breaker 1: On-Chain Solvency Guard ───────────────────────────
    if current_value < book_value {
        let deficit = book_value.saturating_sub(current_value);
        if deficit > crate::constants::SOLVENCY_DUST_TOLERANCE {
            pool.status = PoolStatus::Paused as u8;
            pool.is_frozen_for_draw = 0;
            draw_cycle.status = DrawStatus::HaltedInsolvent;
            draw_cycle.locked_ticket_count = eligible_locked_count;
            draw_cycle.prize_pot = 0;
            draw_cycle.cycle_fee_collected = 0;
            pool.current_draw_cycle_id = pool
                .current_draw_cycle_id
                .checked_add(1)
                .ok_or(PremiumBondsError::MathOverflow)?;
            pool.advance_cycle_end_at(current_time)?;
            emit_cpi!(crate::events::EmergencyInsolvencyDetected {
                pool_id: pool.pool_id,
                current_value,
                book_value,
                deficit,
            });
            return Ok(());
        }
    }

    // If there are no active tickets, we do not harvest any yield or accrue fees.
    // The yield rolls over naturally in the Huma pool for subsequent cycles.
    let yield_generated = if eligible_locked_count > 0 {
        current_value.saturating_sub(book_value)
    } else {
        0
    };

    // ── Circuit Breaker 2: Yield Velocity Spike Guard ─────────────────────────
    if pool.max_yield_basis_points > 0 && yield_generated > 0 {
        let max_allowed_yield = (book_value as u128)
            .saturating_mul(pool.max_yield_basis_points as u128)
            .checked_div(10_000)
            .ok_or(PremiumBondsError::MathOverflow)?;
        if (yield_generated as u128) > max_allowed_yield {
            pool.status = PoolStatus::Paused as u8;
            pool.is_frozen_for_draw = 0;
            draw_cycle.status = DrawStatus::HaltedYieldSpike;
            draw_cycle.locked_ticket_count = eligible_locked_count;
            draw_cycle.prize_pot = 0;
            draw_cycle.cycle_fee_collected = 0;
            pool.current_draw_cycle_id = pool
                .current_draw_cycle_id
                .checked_add(1)
                .ok_or(PremiumBondsError::MathOverflow)?;
            pool.advance_cycle_end_at(current_time)?;
            emit_cpi!(crate::events::YieldVelocityBreached {
                pool_id: pool.pool_id,
                yield_generated,
                max_allowed_yield: max_allowed_yield as u64,
            });
            return Ok(());
        }
    }

    let fee = pool.calculate_fee(yield_generated)?;
    let net_yield = yield_generated
        .checked_sub(fee)
        .ok_or(PremiumBondsError::MathOverflow)?;

    if yield_generated > 0 && yield_generated >= pool.min_yield_threshold && eligible_locked_count > 0 {
        require!(
            pool.prize_tiers_count > 0,
            PremiumBondsError::PrizeTiersNotConfigured
        );
        draw_cycle.status = DrawStatus::AwaitingRandomness;
        pool.is_frozen_for_draw = 1;

        // Accrue fee (accounting only — no token transfer)
        if fee > 0 {
            pool.total_fees_accrued = pool
                .total_fees_accrued
                .checked_add(fee)
                .ok_or(PremiumBondsError::MathOverflow)?;
        }

        pool.total_prizes_allocated = pool
            .total_prizes_allocated
            .checked_add(net_yield)
            .ok_or(PremiumBondsError::MathOverflow)?;

        emit_cpi!(crate::events::YieldHarvested {
            pool_id: pool.pool_id,
            cycle_id: pool.current_draw_cycle_id,
            raw_yield: yield_generated,
            fee,
            prize_pot: net_yield,
            locked_ticket_count: eligible_locked_count,
            randomness_account: ctx.accounts.randomness_account.key(),
        });
    } else {
        draw_cycle.status = DrawStatus::Skipped;
        emit_cpi!(crate::events::DrawSkipped {
            pool_id: pool.pool_id,
            cycle_id: pool.current_draw_cycle_id,
            raw_yield: yield_generated,
            threshold: pool.min_yield_threshold,
        });
    }

    draw_cycle.locked_ticket_count = eligible_locked_count;
    draw_cycle.prize_pot = net_yield;
    draw_cycle.cycle_fee_collected = fee;

    pool.current_draw_cycle_id = pool
        .current_draw_cycle_id
        .checked_add(1)
        .ok_or(PremiumBondsError::MathOverflow)?;
    pool.advance_cycle_end_at(current_time)?;

    #[cfg(feature = "debug-logs")]
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
