use crate::constants::{
    PENDING_REDEMPTION_SEED, POOL_VAULT_SEED, PRIZE_POOL_SEED, REDEMPTION_BATCH_SEED,
};
use crate::error::PremiumBondsError;
use crate::events::RedemptionClaimed;
use crate::state::{PendingRedemption, PrizePool, RedemptionBatch};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    transfer_checked, Mint, TokenAccount, TokenInterface, TransferChecked,
};

/// Accounts required for a caller/crank or user to claim a settled batch redemption.
#[derive(Accounts)]
pub struct ClaimRedemption<'info> {
    /// The caller/crank executing the claim transaction (pays transaction fee).
    #[account(mut)]
    pub caller: Signer<'info>,

    /// CHECK: The redemption beneficiary receiving the claimed USDC and PDA rent refund.
    /// Validated strictly against pending_redemption.user.
    #[account(
        mut,
        address = pending_redemption.user @ PremiumBondsError::InvalidRedemptionOwner
    )]
    pub beneficiary: UncheckedAccount<'info>,

    /// The prize pool state account.
    #[account(
        mut,
        seeds = [PRIZE_POOL_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump = pool.load()?.vault_authority_bump,
    )]
    pub pool: AccountLoader<'info, PrizePool>,

    /// The settled redemption batch containing the pro-rata funds.
    #[account(
        mut,
        seeds = [
            REDEMPTION_BATCH_SEED,
            pool.load()?.pool_id.to_le_bytes().as_ref(),
            batch.batch_id.to_le_bytes().as_ref()
        ],
        bump = batch.bump,
        constraint = batch.pool_id == pool.load()?.pool_id @ PremiumBondsError::MismatchedPoolId,
        constraint = batch.batch_id == pending_redemption.batch_id @ PremiumBondsError::MismatchedBatchId,
    )]
    pub batch: Box<Account<'info, RedemptionBatch>>,

    /// The PendingRedemption PDA representing the withdrawal receipt.
    /// Closes and refunds its rent directly to `beneficiary` upon successful completion.
    #[account(
        mut,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pending_redemption.pool_id.to_le_bytes().as_ref(),
            pending_redemption.redemption_id.to_le_bytes().as_ref()
        ],
        bump = pending_redemption.bump,
        constraint = pending_redemption.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        constraint = pending_redemption.pool_id == pool.load()?.pool_id @ PremiumBondsError::MismatchedPoolId,
        close = beneficiary
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    /// The underlying token mint (e.g. USDC).
    #[account(
        address = pool.load()?.token_mint,
        mint::token_program = token_program
    )]
    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    /// The pool's underlying token vault (holds disbursed USDC from Huma program).
    #[account(
        mut,
        seeds = [POOL_VAULT_SEED, pool.load()?.pool_id.to_le_bytes().as_ref()],
        bump,
        token::mint = token_mint,
        token::token_program = token_program
    )]
    pub pool_vault_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The beneficiary's underlying token account (receives the claimed USDC).
    #[account(
        mut,
        token::mint = token_mint,
        token::authority = beneficiary,
        token::token_program = token_program
    )]
    pub beneficiary_token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    /// The SPL Token program interface for underlying tokens.
    pub token_program: Interface<'info, TokenInterface>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,
    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Claims settled USDC pro-rata from a completed redemption batch.
///
/// Flow:
/// 1. Calculate and record claim against `batch` (enforces Settled, calculates pro-rata payout).
/// 2. If payout > 0, transfer payout from pool vault to beneficiary.
/// 3. Decrement pool.total_pending_redemptions.
/// 4. PendingRedemption PDA closes automatically via `close = beneficiary`.
pub fn handle(ctx: Context<ClaimRedemption>) -> Result<()> {
    let (pool_id_bytes, authority_bump, pool_id) = {
        let pool = ctx.accounts.pool.load()?;
        pool.check_version()?;
        require!(
            pool.status != (crate::state::PoolStatus::Paused as u8),
            PremiumBondsError::PoolPaused
        );
        let id = pool.pool_id;
        (id.to_le_bytes(), pool.vault_authority_bump, id)
    };

    let (principal_amount, redemption_id, batch_id, requested_at, redemption_type) = {
        let p = &mut ctx.accounts.pending_redemption;
        p.ensure_current_version()?;
        (
            p.amount,
            p.redemption_id,
            p.batch_id,
            p.requested_at,
            p.redemption_type,
        )
    };

    // Pro-rata claim calculation & mutation on batch
    let payout = ctx.accounts.batch.claim(principal_amount)?;

    // Zero out amount on pending receipt to prevent re-entrancy
    ctx.accounts.pending_redemption.clear_amount();

    // Decrement pool liabilities
    ctx.accounts
        .pool
        .load_mut()?
        .complete_pending_redemption(principal_amount)?;

    // Transfer payout if > 0
    if payout > 0 {
        require!(
            ctx.accounts.pool_vault_account.amount >= payout,
            PremiumBondsError::InsufficientVaultBalance
        );

        let signer_seeds: &[&[&[u8]]] =
            &[&[PRIZE_POOL_SEED, pool_id_bytes.as_ref(), &[authority_bump]]];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.pool_vault_account.to_account_info(),
            mint: ctx.accounts.token_mint.to_account_info(),
            to: ctx.accounts.beneficiary_token_account.to_account_info(),
            authority: ctx.accounts.pool.to_account_info(),
        };
        transfer_checked(
            CpiContext::new_with_signer(ctx.accounts.token_program.key(), cpi_accounts, signer_seeds),
            payout,
            ctx.accounts.token_mint.decimals,
        )?;
    }

    #[cfg(feature = "debug-logs")]
    msg!(
        "ClaimRedemption: caller={}, beneficiary={}, principal={}, payout={}, batch_id={}, redemption_id={}",
        ctx.accounts.caller.key(),
        ctx.accounts.beneficiary.key(),
        principal_amount,
        payout,
        batch_id,
        redemption_id,
    );

    emit_cpi!(RedemptionClaimed {
        caller: ctx.accounts.caller.key(),
        user: ctx.accounts.beneficiary.key(),
        pool_id,
        batch_id,
        amount: payout,
        redemption_id,
        redemption_type,
        requested_at,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
