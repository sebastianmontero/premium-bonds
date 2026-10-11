use crate::constants::{BATCH_CLAIM_EXPIRY_SECONDS, PENDING_REDEMPTION_SEED};
use crate::error::PremiumBondsError;
use crate::events::ExpiredRedemptionClosed;
use crate::state::PendingRedemption;
use anchor_lang::prelude::*;

/// Accounts required to close an abandoned/expired PendingRedemption receipt after batch closure.
#[derive(Accounts)]
pub struct CloseExpiredRedemption<'info> {
    /// CHECK: The redemption owner receiving 100% of their SOL rent back.
    #[account(
        mut,
        address = pending_redemption.user @ PremiumBondsError::InvalidRedemptionOwner
    )]
    pub beneficiary: Signer<'info>,

    /// The expired PendingRedemption PDA to close.
    #[account(
        mut,
        seeds = [
            PENDING_REDEMPTION_SEED,
            pending_redemption.pool_id.to_le_bytes().as_ref(),
            pending_redemption.redemption_id.to_le_bytes().as_ref()
        ],
        bump = pending_redemption.bump,
        constraint = pending_redemption.check_version().is_ok() @ PremiumBondsError::UnsupportedAccountVersion,
        close = beneficiary
    )]
    pub pending_redemption: Box<Account<'info, PendingRedemption>>,

    /// The Solana System Program.
    pub system_program: Program<'info, System>,

    /// CHECK: The event authority PDA for CPI event emission.
    #[account(seeds = [b"__event_authority"], bump)]
    pub event_authority: UncheckedAccount<'info>,

    /// The YieldBonds program itself.
    pub program: Program<'info, crate::program::Anchor>,
}

/// Allows a user to close an expired PendingRedemption whose batch was already swept and closed after 180 days.
pub fn handle(ctx: Context<CloseExpiredRedemption>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let requested_at = ctx.accounts.pending_redemption.requested_at;
    let expiry_threshold = requested_at.saturating_add(BATCH_CLAIM_EXPIRY_SECONDS);

    require!(now >= expiry_threshold, PremiumBondsError::BatchNotFullyClaimed);

    let rent_reclaimed_lamports = ctx.accounts.pending_redemption.to_account_info().lamports();
    let pool_id = ctx.accounts.pending_redemption.pool_id;
    let batch_id = ctx.accounts.pending_redemption.batch_id;
    let redemption_id = ctx.accounts.pending_redemption.redemption_id;
    let beneficiary = ctx.accounts.beneficiary.key();
    let expired_principal = ctx.accounts.pending_redemption.amount;
    let redemption_type = ctx.accounts.pending_redemption.redemption_type;

    #[cfg(feature = "debug-logs")]
    msg!(
        "CloseExpiredRedemption: beneficiary={}, redemption_id={}, rent_reclaimed={}",
        beneficiary,
        redemption_id,
        rent_reclaimed_lamports,
    );

    emit_cpi!(ExpiredRedemptionClosed {
        pool_id,
        batch_id,
        redemption_id,
        beneficiary,
        expired_principal,
        redemption_type,
        rent_reclaimed_lamports,
        timestamp: now,
    });

    // Zero out amount to prevent re-entrancy before Anchor closes account
    ctx.accounts.pending_redemption.clear_amount();

    // Account closed and rent refunded to beneficiary via `close = beneficiary`
    Ok(())
}
