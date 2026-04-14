use anchor_lang::prelude::*;
use anchor_spl::token_interface::{TokenInterface, TokenAccount};
use crate::state::{GlobalConfig, PrizePool, DrawCycle, DrawStatus, TicketRegistry};
use crate::kamino;
use crate::error::PremiumBondsError;
use crate::constants::{GLOBAL_CONFIG_SEED, PRIZE_POOL_SEED, DRAW_CYCLE_SEED};
use crate::constants::DISCRIMINATOR;

#[derive(Accounts)]
#[instruction(cycle_id: u32)]
pub struct HarvestYieldAndCommit<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = jobs_account 
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// CHECK: Validated by constraint above (crank == jobs_account)
    pub jobs_account: UncheckedAccount<'info>,

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
        seeds = [DRAW_CYCLE_SEED, pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub current_draw_cycle: Account<'info, DrawCycle>,

    #[account(mut)]
    pub pool_vault_account: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub pool_ktokens_vault: InterfaceAccount<'info, TokenAccount>,

    // Kamino
    /// CHECK: CPI Target
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
    #[account(mut)]
    /// CHECK: 
    pub reserve_collateral_mint: UncheckedAccount<'info>,

    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<HarvestYieldAndCommit>, cycle_id: u32, ktokens_to_burn: u64) -> Result<()> {
    require!(ctx.accounts.crank.key() == ctx.accounts.global_config.jobs_account, PremiumBondsError::UnauthorizedCrank);
    let pool = &mut ctx.accounts.pool;

    let balance_before = ctx.accounts.pool_vault_account.amount;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        PRIZE_POOL_SEED,
        pool_id_bytes.as_ref(),
        &[authority_bump],
    ]];

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
            ctx.accounts.system_program.to_account_info(),
            ktokens_to_burn,
            signer_seeds,
        )?;
    }

    ctx.accounts.pool_vault_account.reload()?;
    let yield_generated = ctx.accounts.pool_vault_account.amount.checked_sub(balance_before).unwrap();

    let mut ticket_registry = ctx.accounts.ticket_registry.load_mut()?;
    
    // 1. Snapshot the perfectly mature active tickets BEFORE merging.
    // This strictly prevents Pending (JIT) deposits from being eligible for the current prize draw!
    let eligible_locked_count = ticket_registry.active_tickets_count;

    // 2. O(1) Block merge! Advance Pending tickets into Active so they mature over the NEXT cycle.
    ticket_registry.active_tickets_count += ticket_registry.pending_tickets_count;
    ticket_registry.pending_tickets_count = 0;

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    draw_cycle.pool_id = pool.pool_id;
    draw_cycle.cycle_id = cycle_id;
    
    if yield_generated > 0 && eligible_locked_count > 0 {
        draw_cycle.status = DrawStatus::AwaitingRandomness;
    } else {
        // Shortcut: If no yield was generated OR there are zero mature tickets eligible to win,
        // instantly complete the cycle to merge Pending -> Active tickets without paying for a VRF oracle draw!
        draw_cycle.status = DrawStatus::Complete;
    }
    
    draw_cycle.locked_ticket_count = eligible_locked_count; 
    draw_cycle.prize_pot = yield_generated;

    Ok(())
}
