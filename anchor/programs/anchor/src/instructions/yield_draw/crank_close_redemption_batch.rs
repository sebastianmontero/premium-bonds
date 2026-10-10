use crate::constants::{
    GLOBAL_CONFIG_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED, REDEMPTION_BATCH_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::RedemptionBatchClosed;
use crate::state::{GlobalConfig, PrizePool, RedemptionBatch};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Accounts required for the crank to close a fully-claimed or 180-day expired redemption batch.
#[derive(Accounts)]
pub struct CrankCloseRedemptionBatch<'info> {
    /// The crank bot or admin executing the close and receiving the SOL rent refund.
    #[account(
        mut,
        constraint = (crank.key() == global_config.jobs_account || crank.key() == global_config.admin) @ PremiumBondsError::UnauthorizedCrank
    )]
    pub crank: Signer<'info>,

    /// The global configuration state, verifying crank authorization.
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump,
        constraint = global_config.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
    )]
    pub global_config: Box<Account<'info, GlobalConfig>>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The redemption batch account to close.
    #[account(
        mut,
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            batch.batch_id.to_le_bytes().as_ref()
        ],
        bump = batch.bump,
        constraint = batch.pool_id == pool.load()?.pool_id @ PremiumBondsError::MismatchedPoolId,
        close = crank
    )]
    pub batch: Box<Account<'info, RedemptionBatch>>,

    /// The underlying token mint (e.g. USDC).
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The pool's underlying token vault holding intermediate deposits.
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The fee wallet receiving swept abandoned USDC funds if batch expired.
    #[account(
        mut,
        token::mint = token_mint,
        token::token_program = token_program,
        constraint = fee_wallet.key() == pool.load()?.fee_wallet @ PremiumBondsError::InvalidFeeWallet
    )]
    pub fee_wallet: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The SPL Token program interface for underlying tokens.
    pub token_program: Interface<'info, TokenInterface>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Closes a redemption batch if it is fully claimed OR after the 180-day dormancy window.
///
/// If expired with unclaimed funds, sweeps the unclaimed pro-rata USDC to `fee_wallet`
/// and decrements pool liabilities. Rent SOL is 100% refunded to the crank bot.
pub fn handle(ctx: Context<CrankCloseRedemptionBatch>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(ctx.accounts.batch.can_close(now), PremiumBondsError::BatchNotFullyClaimed);

    let batch_id = ctx.accounts.batch.batch_id;
    let rent_reclaimed = ctx.accounts.batch.to_account_info().lamports();

    let (pool_id_bytes, authority_bump, pool_id) = {
        let pool = ctx.accounts.pool.load()?;
        (pool.pool_id.to_le_bytes(), pool.vault_authority_bump, pool.pool_id)
    };

    let unclaimed_principal = ctx.accounts.batch.unclaimed_principal();
    let mut unclaimed_usdc = 0;

    if unclaimed_principal > 0 {
        unclaimed_usdc = ctx.accounts.batch.calculate_unclaimed_payout()?;
        if unclaimed_usdc > 0 {
            let signer_seeds: &[&[&[u8]]] =
                &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

            let cpi_accounts = TransferChecked {
                from: ctx.accounts.pool_vault_account.to_account_info(),
                mint: ctx.accounts.token_mint.to_account_info(),
                to: ctx.accounts.fee_wallet.to_account_info(),
                authority: ctx.accounts.pool.to_account_info(),
            };
            transfer_checked(
                CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
                unclaimed_usdc,
                ctx.accounts.token_mint.decimals,
            )?;
        }

        // Decrement pool liabilities for abandoned principal
        ctx.accounts
            .pool
            .load_mut()?
            .complete_pending_redemption(unclaimed_principal)?;
    }

    #[cfg(feature = "debug-logs")]
    msg!(
        "CrankCloseRedemptionBatch: pool_id={}, batch_id={}, rent_reclaimed={}, unclaimed_principal={}, unclaimed_usdc={}",
        pool_id,
        batch_id,
        rent_reclaimed,
        unclaimed_principal,
        unclaimed_usdc,
    );

    emit_cpi!(RedemptionBatchClosed {
        pool_id,
        batch_id,
        caller: ctx.accounts.crank.key(),
        rent_reclaimed,
        unclaimed_principal_swept: unclaimed_principal,
        unclaimed_usdc_swept: unclaimed_usdc,
        timestamp: now,
    });

    // Account data closed and rent refunded to crank via `close = crank` constraint
    Ok(())
}
