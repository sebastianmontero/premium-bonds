use crate::constants::{
    POOL_PST_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::PoolRecapitalized;
use crate::huma;
use crate::state::PrizePool;
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Accounts required for a sponsor to recapitalize a paused insolvent pool.
#[derive(Accounts)]
pub struct RecapitalizePool<'info> {
    /// Sponsor depositing USDC to cure venue deficit and recapitalize the pool.
    #[account(mut)]
    pub sponsor: Signer<'info>,

    /// The prize pool state account to recapitalize.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// Sponsor's token account providing USDC.
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = sponsor,
        token::token_program = token_program
    )]
    pub sponsor_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The underlying USDC mint.
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// Pool vault account intermediate for deposit.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Pool PST vault receiving newly minted PST shares from deposit.
    #[account(
        mut,
        seeds = [POOL_PST_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::token_program = pst_token_program
    )]
    pub pool_pst_vault: Box<InterfaceAccount<'info, TokenAccount>>,

    // ── Huma Finance CPI Accounts ───────────────────────────────────────────
    /// CHECK: Validated against HUMA_PROGRAM_ID.
    #[account(address = crate::constants::HUMA_PROGRAM_ID)]
    pub huma_program: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program during CPI.
    pub huma_config: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program during CPI.
    pub huma_pool_config: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program owner and pinned to pool.huma_pool_state.
    #[account(
        mut,
        constraint = huma_pool_state.owner == &crate::constants::HUMA_PROGRAM_ID @ PremiumBondsError::InvalidHumaPoolState,
        constraint = huma_pool_state.key() == pool.load()?.huma_pool_state @ PremiumBondsError::InvalidHumaPoolState
    )]
    pub huma_pool_state: UncheckedAccount<'info>,

    /// CHECK: Validated by Huma program during CPI.
    pub huma_mode_config: UncheckedAccount<'info>,

    /// The Huma mode token mint ($PST token mint).
    #[account(
        mut,
        address = pool_pst_vault.mint @ PremiumBondsError::InvalidModeMint,
        mint::token_program = pst_token_program
    )]
    pub huma_mode_mint: Box<InterfaceAccount<'info, Mint>>,

    /// CHECK: Huma pool authority PDA.
    pub huma_pool_authority: UncheckedAccount<'info>,

    /// CHECK: Huma pool underlying token vault.
    #[account(mut)]
    pub huma_pool_underlying_token: UncheckedAccount<'info>,

    /// Token interface for USDC.
    pub token_program: Interface<'info, TokenInterface>,

    /// Token interface for $PST mint/vault.
    pub pst_token_program: Interface<'info, TokenInterface>,

    /// CHECK: Event authority PDA.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Injects capital into a paused pool's PST position without creating liabilities.
///
/// If this recapitalization cures the deficit (pool becomes solvent), the pool is unpaused.
pub fn handle(ctx: Context<RecapitalizePool>, amount: u64) -> Result<()> {
    require!(amount > 0, PremiumBondsError::InvalidRecapitalizeAmount);

    let (pool_id, pool_id_bytes, authority_bump) = {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;
        require!(pool.is_paused(), PremiumBondsError::PoolNotPaused);
        (pool.pool_id, pool.pool_id.to_le_bytes(), pool.vault_authority_bump)
    };

    // 1. Transfer USDC from sponsor to pool_vault_account
    transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.sponsor_token_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.pool_vault_account.to_account_info(),
                authority: ctx.accounts.sponsor.to_account_info(),
            },
        ),
        amount,
        ctx.accounts.token_mint.decimals,
    )?;

    // 2. Deposit USDC into Huma via pool PDA
    let signer_seeds: &[&[&[u8]]] =
        &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

    let initial_pst_amount = ctx.accounts.pool_pst_vault.amount;

    huma::deposit(
        ctx.accounts.huma_program.to_account_info(),
        ctx.accounts.pool.to_account_info(),
        ctx.accounts.huma_config.to_account_info(),
        ctx.accounts.huma_pool_config.to_account_info(),
        ctx.accounts.huma_pool_state.to_account_info(),
        ctx.accounts.huma_mode_config.to_account_info(),
        ctx.accounts.huma_mode_mint.to_account_info(),
        ctx.accounts.huma_pool_authority.to_account_info(),
        ctx.accounts.token_mint.to_account_info(),
        ctx.accounts.huma_pool_underlying_token.to_account_info(),
        ctx.accounts.pool_vault_account.to_account_info(),
        ctx.accounts.pool_pst_vault.to_account_info(),
        ctx.accounts.token_program.to_account_info(),
        ctx.accounts.pst_token_program.to_account_info(),
        amount,
        signer_seeds,
    )?;

    ctx.accounts.pool_pst_vault.reload()?;
    let new_pst_amount = ctx.accounts.pool_pst_vault.amount;
    let pst_shares_minted = new_pst_amount.saturating_sub(initial_pst_amount);
    require!(pst_shares_minted > 0, PremiumBondsError::ZeroSharesMinted);

    // 3. Check live solvency: if deficit cured, unpause pool
    let total_assets = huma::read_mode_assets(&ctx.accounts.huma_pool_state.to_account_info())?;
    let pst_supply = ctx.accounts.huma_mode_mint.supply;
    let current_value = huma::pst_shares_to_usdc(new_pst_amount, pst_supply, total_assets)?;

    let mut is_unpaused = false;
    {
        let mut pool = ctx.accounts.pool.load_mut()?;
        pool.ensure_current_version()?;
        if pool.is_solvent(current_value)? {
            pool.unpause()?;
            is_unpaused = true;
        }
    }

    let clock = Clock::get()?;

    #[cfg(feature = "debug-logs")]
    msg!(
        "RecapitalizePool: pool_id={}, sponsor={}, amount={}, pst_shares={}, unpaused={}",
        pool_id,
        ctx.accounts.sponsor.key(),
        amount,
        pst_shares_minted,
        is_unpaused,
    );

    emit_cpi!(PoolRecapitalized {
        pool_id,
        sponsor: ctx.accounts.sponsor.key(),
        amount,
        pst_shares_minted,
        is_unpaused,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
