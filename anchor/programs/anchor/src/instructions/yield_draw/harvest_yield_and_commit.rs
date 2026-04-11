use anchor_lang::prelude::*;
use anchor_spl::token::{Token, TokenAccount};
use crate::state::{GlobalConfig, PrizePool, DrawCycle, DrawStatus, TicketRegistry};
use crate::kamino;
use crate::error::PremiumBondsError;

#[derive(Accounts)]
#[instruction(cycle_id: u32)]
pub struct HarvestYieldAndCommit<'info> {
    #[account(mut)]
    pub crank: Signer<'info>,

    #[account(
        seeds = [b"global_config"],
        bump,
        has_one = jobs_account 
    )]
    pub global_config: Account<'info, GlobalConfig>,

    /// CHECK: Validated by constraint above (crank == jobs_account)
    pub jobs_account: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"prize_pool", pool.pool_id.to_le_bytes().as_ref()],
        bump = pool.vault_authority_bump,
    )]
    pub pool: Account<'info, PrizePool>,

    #[account(mut)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        init,
        payer = crank,
        space = DrawCycle::INIT_SPACE,
        seeds = [b"draw_cycle", pool.pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        bump
    )]
    pub current_draw_cycle: Account<'info, DrawCycle>,

    #[account(mut)]
    pub pool_vault_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub pool_ktokens_vault: Account<'info, TokenAccount>,

    // Kamino
    /// CHECK: CPI Target
    pub kamino_program: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: 
    pub reserve: AccountInfo<'info>,
    /// CHECK: 
    pub lending_market: AccountInfo<'info>,
    /// CHECK: 
    pub lending_market_authority: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: 
    pub reserve_liquidity_supply: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: 
    pub reserve_collateral_mint: AccountInfo<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle(ctx: Context<HarvestYieldAndCommit>, cycle_id: u32, ktokens_to_burn: u64) -> Result<()> {
    require!(ctx.accounts.crank.key() == ctx.accounts.global_config.jobs_account, PremiumBondsError::UnauthorizedTicket);
    let pool = &mut ctx.accounts.pool;

    let balance_before = ctx.accounts.pool_vault_account.amount;

    let pool_id_bytes = pool.pool_id.to_le_bytes();
    let authority_bump = pool.vault_authority_bump;
    let signer_seeds: &[&[&[u8]]] = &[&[
        b"prize_pool",
        pool_id_bytes.as_ref(),
        &[authority_bump],
    ]];

    if ktokens_to_burn > 0 {
        kamino::redeem_reserve_collateral(
            ctx.accounts.kamino_program.clone(),
            pool.to_account_info(), 
            ctx.accounts.reserve.clone(),
            ctx.accounts.lending_market.clone(),
            ctx.accounts.lending_market_authority.clone(),
            ctx.accounts.reserve_liquidity_supply.clone(),
            ctx.accounts.reserve_collateral_mint.clone(),
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
    
    // O(1) Block merge! The massive compute saving architecture element.
    ticket_registry.active_tickets_count += ticket_registry.pending_tickets_count;
    ticket_registry.pending_tickets_count = 0;

    let draw_cycle = &mut ctx.accounts.current_draw_cycle;
    draw_cycle.pool_id = pool.pool_id;
    draw_cycle.cycle_id = cycle_id;
    draw_cycle.status = DrawStatus::AwaitingRandomness;
    draw_cycle.locked_ticket_count = ticket_registry.active_tickets_count; 
    draw_cycle.prize_pot = yield_generated;

    Ok(())
}
