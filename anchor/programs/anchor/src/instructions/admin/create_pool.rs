use crate::constants::{
    DISCRIMINATOR, GLOBAL_CONFIG_SEED, POOL_PST_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED,
    REGISTRY_INITIAL_SIZE,
};
use crate::error::PremiumBondsError;
use crate::state::{GlobalConfig, PoolStatus, PrizePool, TicketRegistry};
use crate::utils::registry_capacity_from_len;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts required to initialize a new prize pool.
#[derive(Accounts)]
#[instruction(pool_id: u32)]
pub struct CreatePool<'info> {
    /// The global configuration state, used to verify the admin signature.
    ///
    /// PDA seeds: `[GLOBAL_CONFIG_SEED]` (i.e., `b"global_config"`).
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        has_one = admin @ PremiumBondsError::UnauthorizedAdmin
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The admin authority creator of the pool, who pays for the pool creation.
    #[account(mut)]
    pub admin: Signer<'info>,

    /// The prize pool state account to initialize.
    ///
    /// PDA seeds: `[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()]` (i.e., `b"prize_pool"` + pool_id).
    #[account(
        init,
        payer = admin,
        space = 8 + std::mem::size_of::<PrizePool>(),
        seeds = [PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        bump
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The zero-initialized ticket registry account that will hold user raffle entries.
    /// Must be pre-allocated by the client with sufficient space.
    #[account(zero)]
    pub ticket_registry: AccountLoader<'info, TicketRegistry>,

    /// The underlying token mint (e.g. USDC) used for bond purchases.
    #[account(
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The Huma yield-bearing $PST token mint representing deposits.
    #[account(
        mint::token_program = pst_token_program
    )]
    pub pst_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The pool's underlying token vault holding intermediate deposits.
    ///
    /// PDA seeds: `[POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_vault"` + pool_id).
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

    /// The pool's $PST token vault holding the Huma yield-bearing shares.
    ///
    /// PDA seeds: `[POOL_PST_SEED, pool_id.to_le_bytes().as_ref()]` (i.e., `b"pool_pst"` + pool_id).
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

    /// The token account designated to receive protocol fees.
    #[account(
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub fee_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Solana System Program.
    pub system_program: Program<'info, System>,

    /// Token program for the underlying mint.
    pub token_program: Interface<'info, TokenInterface>,

    /// Token program for the Huma $PST mint.
    pub pst_token_program: Interface<'info, TokenInterface>,
}

/// Creates and initializes a new prize pool, setting up its configurations,
/// vault accounts, and initializing the ticket registry.
///
/// # Parameters
/// * `ctx` - The context of the create pool instruction.
/// * `pool_id` - A unique identifier for the pool.
/// * `bond_price` - The price of a single bond/ticket in underlying tokens.
/// * `stake_cycle_duration_hrs` - The duration of each staking/draw cycle in hours.
/// * `fee_basis_points` - Protocol fee rate in basis points (e.g., 50 = 0.5%).
/// * `min_yield_threshold` - Minimum yield required (in base units) to execute a draw cycle.
pub fn handle(
    ctx: Context<CreatePool>,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
    min_yield_threshold: u64,
) -> Result<()> {
    require!(bond_price > 0, PremiumBondsError::InvalidBondPrice);
    require!(
        stake_cycle_duration_hrs > 0,
        PremiumBondsError::InvalidStakeCycleDuration
    );
    require!(
        fee_basis_points <= 10000,
        PremiumBondsError::InvalidFeeConfig
    );

    let mut pool = ctx.accounts.pool.load_init()?;
    pool.vault_authority_bump = ctx.bumps.pool;
    pool.pool_id = pool_id;
    pool.token_mint = ctx.accounts.token_mint.key();
    pool.ticket_registry = ctx.accounts.ticket_registry.key();
    pool.fee_wallet = ctx.accounts.fee_wallet.key();
    pool.bond_price = bond_price;
    pool.stake_cycle_duration_hrs = stake_cycle_duration_hrs;
    pool.fee_basis_points = fee_basis_points;
    pool.min_yield_threshold = min_yield_threshold;
    pool.status = PoolStatus::Active as u8;
    pool.total_deposited_principal = 0;
    pool.is_frozen_for_draw = 0;
    pool.current_draw_cycle_id = 0;
    pool.prize_tiers_count = 0;
    pool._padding = [0; 1];
    pool.prize_tiers = [crate::state::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0; 2] }; 10];
    pool.next_redemption_id = 0;
    pool.total_fees_accrued = 0;
    pool.total_fees_withdrawn = 0;
    pool.total_prizes_allocated = 0;
    pool.total_pending_redemptions = 0;
    pool.version = 1;

    let clock = Clock::get()?;
    pool.advance_cycle_end_at(clock.unix_timestamp)?;

    let initial_len = ctx.accounts.ticket_registry.to_account_info().data_len();
    require!(
        initial_len >= REGISTRY_INITIAL_SIZE,
        PremiumBondsError::RegistryTooSmall
    );

    let mut ticket_registry = ctx.accounts.ticket_registry.load_init()?;
    ticket_registry.pool_id = pool_id;
    ticket_registry.capacity = registry_capacity_from_len(initial_len);
    ticket_registry.user_count = 0;
    ticket_registry.total_active_tickets = 0;
    ticket_registry.total_pending_tickets = 0;
    ticket_registry.draw_cycle_id = 0;
    ticket_registry.draw_prepared_up_to = 0;
    ticket_registry.version = 1;

    Ok(())
}
