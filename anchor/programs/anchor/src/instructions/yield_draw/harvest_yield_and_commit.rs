use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount, Mint, transfer_checked, TransferChecked};
use crate::state::{GlobalConfig, PrizePool, DrawCycle, DrawStatus, TicketRegistry, PoolStatus};
use crate::kamino;
use crate::error::PremiumBondsError;
use crate::constants::{GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED, DRAW_CYCLE_SEED, POOL_VAULT_SEED, POOL_KTOKENS_SEED};
use crate::constants::DISCRIMINATOR;

#[derive(Accounts)]
pub struct HarvestYieldAndCommit<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.jobs_account == crank.key() @ PremiumBondsError::UnauthorizedCrank
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        init,
        payer = crank,
        space = DISCRIMINATOR + DrawCycle::INIT_SPACE,
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), pool.current_draw_cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub current_draw_cycle: Account<'info, DrawCycle>,

    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        seeds = [POOL_KTOKENS_SEED, pool.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = reserve_collateral_mint,
        token::token_program = ktokens_token_program
    )]
    pub pool_ktokens_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = token_mint,
        token::token_program = token_program,
        address = pool.fee_wallet
    )]
    pub fee_wallet: InterfaceAccount<'info, TokenAccount>,

    #[account(
        address = pool.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    // Kamino
    /// CHECK: Validated by address constraint
    #[account(address = crate::constants::KAMINO_PROGRAM_ID)]
    pub kamino_program: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: 
    pub reserve: UncheckedAccount<'info>,
    /// CHECK: 
    pub lending_market: UncheckedAccount<'info>,
    /// CHECK: 
    pub lending_market_authority: UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: 
    pub reserve_liquidity_supply: UncheckedAccount<'info>,
    #[account(
        mut,
        mint::token_program = ktokens_token_program
    )]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,

    pub token_program: Interface<'info, TokenInterface>,
    pub ktokens_token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<HarvestYieldAndCommit>, ktokens_to_burn: u64) -> Result<()> {
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

    let balance_before = ctx.accounts.pool_vault_account.amount;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        PRIZE_POOL_SEED,
        pool_id_bytes.as_ref(),
        &[authority_bump],
    ]];

    let mut yield_generated: u64 = 0;
    let mut fee: u64 = 0;
    let mut net_yield: u64 = 0;

    if ktokens_to_burn > 0 {
        kamino::redeem_reserve_collateral(
            ctx.accounts.kamino_program.to_account_info(),
            pool.to_account_info(), 
            ctx.accounts.reserve.to_account_info(),
            ctx.accounts.lending_market.to_account_info(),
            ctx.accounts.lending_market_authority.to_account_info(),
            ctx.accounts.reserve_liquidity_supply.to_account_info(),
            ctx.accounts.reserve_collateral_mint.to_account_info(),
            ctx.accounts.pool_vault_account.to_account_info(), 
            ctx.accounts.pool_ktokens_vault.to_account_info(), 
            ctx.accounts.token_program.to_account_info(),
            ctx.accounts.ktokens_token_program.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ktokens_to_burn,
            signer_seeds,
        )?;
        ctx.accounts.pool_vault_account.reload()?;

        yield_generated = ctx.accounts.pool_vault_account.amount.checked_sub(balance_before).unwrap();
        fee = pool.calculate_fee(yield_generated);
        net_yield = yield_generated.checked_sub(fee).unwrap();

        if fee > 0 {
            let cpi_accounts = TransferChecked {
                from: ctx.accounts.pool_vault_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.fee_wallet.to_account_info(),
                authority: pool.to_account_info(),
            };
            transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
                fee,
                ctx.accounts.token_mint.decimals,
            )?;
            
            pool.total_fees_collected = pool.total_fees_collected.checked_add(fee).unwrap();
        }
    }

    let eligible_locked_count;
    {
        let mut ticket_registry = ctx.accounts.ticket_registry.load_mut()?;

        // 1. Snapshot the perfectly mature active tickets BEFORE merging.
        // This strictly prevents Pending (JIT) deposits from being eligible for the current prize draw!
        eligible_locked_count = ticket_registry.active_tickets_count;

        // 2. O(1) Block merge! Advance Pending tickets into Active so they mature over the NEXT cycle.
        ticket_registry.active_tickets_count += ticket_registry.pending_tickets_count;
        ticket_registry.pending_tickets_count = 0;
    } // borrow released before draw_cycle writes below

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    draw_cycle.pool_id = pool.pool_id;
    draw_cycle.cycle_id = pool.current_draw_cycle_id;
    
    if yield_generated > 0 && eligible_locked_count > 0 {
        require!(
            !pool.prize_tiers.is_empty(),
            PremiumBondsError::PrizeTiersNotConfigured
        );
        draw_cycle.status = DrawStatus::AwaitingRandomness;
        pool.is_frozen_for_draw = true;
    } else {
        // Shortcut: If no yield was generated OR there are zero mature tickets eligible to win,
        // instantly complete the cycle to merge Pending -> Active tickets without paying for a VRF oracle draw!
        draw_cycle.status = DrawStatus::Complete;
    }
    
    draw_cycle.locked_ticket_count = eligible_locked_count; 
    draw_cycle.prize_pot = net_yield;
    draw_cycle.cycle_fee_collected = fee;

    pool.current_draw_cycle_id = pool.current_draw_cycle_id.checked_add(1).unwrap();
    pool.advance_cycle_end_at(current_time);

    Ok(())
}
