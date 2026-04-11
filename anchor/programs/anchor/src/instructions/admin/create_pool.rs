use anchor_lang::prelude::*;
use crate::state::{GlobalConfig, PrizePool, PoolStatus, TicketRegistry};
use anchor_spl::token::Mint;

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CreatePool<'info> {
    #[account(
        mut,
        seeds = [b"global_config"],
        bump,
        has_one = admin
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = PrizePool::INIT_SPACE,
        seeds = [b"prize_pool", pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Account<'info, PrizePool>,

    /// Client MUST create this massive 10.4MB account upfront via SystemProgram.
    /// It avoids the 10KB CPI limit for initializing PDAs. We just bind it here.
    #[account(zero)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    pub token_mint: Account<'info, Mint>,

    pub system_program: Program<'info, System>,
}

pub fn handle(
    ctx: Context<CreatePool>, 
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
) -> Result<()> {
    let pool = &mut ctx.accounts.pool;
    pool.vault_authority_bump = ctx.bumps.pool; // Since PDA is seeds, we use its bump as a generic vault authority
    pool.pool_id = pool_id;
    pool.token_mint = ctx.accounts.token_mint.key();
    pool.ticket_registry = ctx.accounts.ticket_registry.key();
    pool.bond_price = bond_price;
    pool.stake_cycle_duration_hrs = stake_cycle_duration_hrs;
    pool.fee_basis_points = fee_basis_points;
    pool.status = PoolStatus::Active;
    pool.total_deposited_principal = 0;
    
    let clock = Clock::get()?;
    pool.current_cycle_end_at = clock.unix_timestamp + (stake_cycle_duration_hrs * 3600);

    let mut ticket_registry = ctx.accounts.ticket_registry.load_init()?;
    ticket_registry.pool_id = pool_id;
    ticket_registry.active_tickets_count = 0;
    ticket_registry.pending_tickets_count = 0;

    Ok(())
}
