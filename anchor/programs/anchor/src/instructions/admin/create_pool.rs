use crate::constants::{
    DISCRIMINATOR, GLOBAL_CONFIG_SEED, POOL_PST_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED,
    REGISTRY_INITIAL_SIZE,
};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PoolStatus, PrizePool, TicketRegistry};
use crate::utils::registry_capacity_from_len;
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
    pub global_config: Box<Account<'info, GlobalConfig>>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = DISCRIMINATOR + PrizePool::INIT_SPACE,
        seeds = [PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: Box<Account<'info, PrizePool>>,

    #[account(zero)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    #[account(
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The Huma $PST mint for Classic mode.
    #[account(
        mint::token_program = pst_token_program
    )]
    pub pst_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = admin,
        seeds = [POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::authority = pool,
        token::token_program = token_program,
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool's $PST vault — holds all yield-bearing tokens from Huma deposits.
    #[account(
        init,
        payer = admin,
        seeds = [POOL_PST_SEED, pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = pst_mint,
        token::authority = pool,
        token::token_program = pst_token_program,
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    #[account(
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub fee_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    pub system_program: Program<'info, System>,
    pub token_program: Interface<'info, TokenInterface>,
    pub pst_token_program: Interface<'info, TokenInterface>,
}

pub fn handle(
    ctx: Context<CreatePool>,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
) -> Result<()> {
    require!(bond_price > 0, PremiumBondsError::InvalidBondPrice);
    require!(
        stake_cycle_duration_hrs > 0,
        PremiumBondsError::InvalidStakeCycleDuration
    );

    let pool = &mut ctx.accounts.pool;
    pool.vault_authority_bump = ctx.bumps.pool;
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
    pool.prize_tiers = vec![];
    pool.next_redemption_id = 0;
    pool.total_fees_accrued = 0;
    pool.total_fees_withdrawn = 0;

    let clock = Clock::get()?;
    pool.advance_cycle_end_at(clock.unix_timestamp);

    let initial_len = ctx.accounts.ticket_registry.to_account_info().data_len();
    require!(
        initial_len >= REGISTRY_INITIAL_SIZE,
        PremiumBondsError::RegistryTooSmall
    );

    let mut ticket_registry = ctx.accounts.ticket_registry.load_init()?;
    ticket_registry.pool_id = pool_id;
    ticket_registry.capacity = registry_capacity_from_len(initial_len);
    ticket_registry.active_tickets_count = 0;
    ticket_registry.pending_tickets_count = 0;

    Ok(())
}
