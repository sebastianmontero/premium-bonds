use crate::constants::{
    DISCRIMINATOR, GLOBAL_CONFIG_SEED, POOL_KTOKENS_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PoolStatus, PrizePool, TicketRegistry};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CreatePool<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR + PrizePool::INIT_SPACE,
        seeds = [PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Account<'info, PrizePool>,

    /// Client MUST create this massive 10.4MB account upfront via SystemProgram.
    /// It avoids the 10KB CPI limit for initializing PDAs. We just bind it here.
    #[account(zero)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        mint::token_program = token_program
    )]
    pub token_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = ktokens_token_program
    )]
    pub reserve_collateral_mint: InterfaceAccount<'info, Mint>,

    #[account(
        init,
        payer = admin,
        seeds = [POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub pool_vault_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = admin,
        seeds = [POOL_KTOKENS_SEED, pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = reserve_collateral_mint,
        token::authority = pool,
        token::token_program = ktokens_token_program,
    )]
    pub pool_ktokens_vault: InterfaceAccount<'info, TokenAccount>,

    #[account(
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub fee_wallet: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub ktokens_token_program: Interface<'info, TokenInterface>,
}

pub fn handle(
    ctx: Context<CreatePool>,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
    max_withdrawal_slippage_dust: u64,
) -> Result<()> {
    require!(bond_price > 0, PremiumBondsError::InvalidBondPrice);
    require!(
        stake_cycle_duration_hrs > 0,
        PremiumBondsError::InvalidStakeCycleDuration
    );

    let pool = &mut ctx.accounts.pool;
    pool.vault_authority_bump = ctx.bumps.pool; // Since PDA is seeds, we use its bump as a generic vault authority
    pool.pool_id = pool_id;
    pool.token_mint = ctx.accounts.token_mint.key();
    pool.ticket_registry = ctx.accounts.ticket_registry.key();
    pool.fee_wallet = ctx.accounts.fee_wallet.key();
    pool.bond_price = bond_price;
    pool.stake_cycle_duration_hrs = stake_cycle_duration_hrs;
    pool.fee_basis_points = fee_basis_points;
    pool.status = PoolStatus::Active;
    pool.total_deposited_principal = 0;
    pool.total_fees_collected = 0;
    pool.is_frozen_for_draw = false;
    pool.current_draw_cycle_id = 0;
    pool.max_withdrawal_slippage_dust = max_withdrawal_slippage_dust;
    pool.prize_tiers = vec![];

    let clock = Clock::get()?;
    pool.advance_cycle_end_at(clock.unix_timestamp);

    let mut ticket_registry = ctx.accounts.ticket_registry.load_init()?;
    ticket_registry.pool_id = pool_id;
    ticket_registry.active_tickets_count = 0;
    ticket_registry.pending_tickets_count = 0;

    Ok(())
}
