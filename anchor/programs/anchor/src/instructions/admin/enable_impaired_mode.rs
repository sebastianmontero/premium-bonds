use crate::constants::{GLOBAL_CONFIG_SEED, IMPAIRMENT_TIMELOCK_SECONDS, POOL_PST_SEED, PRIZE_POOL_SEED};
use crate::error::PremiumBondsError;
use crate::events::PoolImpairedModeEnabled;
use crate::huma;
use crate::state::{GlobalConfig, PrizePool};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

/// Accounts required to transition an insolvent paused pool into Impaired workout mode.
#[derive(Accounts)]
pub struct EnableImpairedMode<'info> {
    /// Caller: either admin (immediate workout transition) or permissionless keeper (after 90-day workout timelock).
    pub caller: Signer<'info>,

    /// The global configuration state.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account to transition into Impaired mode.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// Pool's $PST vault holding Huma shares.
    #[account(
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The Huma mode token mint ($PST token mint).
    #[account(
        address = pool_pst_vault.mint @ PremiumBondsError::InvalidModeMint,
        mint::token_program = pst_token_program
    )]
    pub pst_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Validated against HUMA_PROGRAM_ID and pinned to pool.huma_pool_state.
    #[account(
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID @ PremiumBondsError::InvalidHumaPoolState,
        constraint = huma_pool_state.key() == pool.load()?.huma_pool_state @ PremiumBondsError::InvalidHumaPoolState
    )]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// Token interface for $PST mint/vault.
    pub pst_token_program: Interface<'info, TokenInterface>,

    /// CHECK: Event authority PDA.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Transitions an insolvent paused pool into Impaired workout mode.
///
/// Guards:
/// 1. Pool must be paused.
/// 2. If caller != admin, current_timestamp >= pool.paused_at + 90 days.
/// 3. Pool must actually be insolvent against book liabilities: current_value + dynamic_tolerance < book_value.
///
/// State mutation:
/// Subordinates and erases junior liabilities (unwithdrawn fees & allocated prizes),
/// freezes draws, and sets pool.status = PoolStatus::Impaired.
pub fn handle(ctx: Context<EnableImpairedMode>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;

    let pst_supply = ctx.accounts.pst_mint.supply;
    let pool_pst_vault_amount = ctx.accounts.pool_pst_vault.amount;
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let current_value = huma::pst_shares_to_usdc(pool_pst_vault_amount, pst_supply, total_assets)?;

    let mut pool = ctx.accounts.pool.load_mut()?;
    pool.ensure_current_version()?;

    require!(pool.is_paused(), PremiumBondsError::PoolNotPaused);

    // Timelock guard for non-admin callers
    let is_admin = ctx.accounts.caller.key() == ctx.accounts.global_config.admin;
    if !is_admin {
        let unlock_timestamp = pool.paused_at.saturating_add(IMPAIRMENT_TIMELOCK_SECONDS);
        require!(now >= unlock_timestamp, PremiumBondsError::ImpairmentTimelockActive);
    }

    // Verify pool is genuinely insolvent against book value
    let book_value = pool.calculate_book_value()?;
    let tolerance = pool.calculate_solvency_tolerance(book_value)?;
    require!(
        current_value.saturating_add(tolerance) < book_value,
        PremiumBondsError::CannotImpairSolventPool
    );

    // Execute transition to Impaired
    pool.transition_to_impaired()?;

    #[cfg(feature = "debug-logs")]
    msg!(
        "EnableImpairedMode: pool_id={}, caller={}, deposited_principal={}, accumulating_redemptions={}",
        pool.pool_id,
        ctx.accounts.caller.key(),
        pool.total_deposited_principal,
        pool.total_accumulating_redemptions,
    );

    emit_cpi!(PoolImpairedModeEnabled {
        pool_id: pool.pool_id,
        authority: ctx.accounts.caller.key(),
        total_deposited_principal: pool.total_deposited_principal,
        total_accumulating_redemptions: pool.total_accumulating_redemptions,
        timestamp: now,
    });

    Ok(())
}
