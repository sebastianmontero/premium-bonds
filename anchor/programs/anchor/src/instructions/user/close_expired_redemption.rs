use crate::constants::{PENDING_REDEMPTION_SEED, REDEMPTION_BATCH_SEED};
use crate::error::PremiumBondsError;
use crate::events::ExpiredRedemptionClosed;
use crate::state::{PendingRedemption, RedemptionBatch};
use anchor_lang::prelude::*;

/// Accounts required to close an abandoned/expired PendingRedemption receipt after batch closure.
///
/// ADVISORY: Users should prefer calling `claim_redemption` while the redemption batch remains open
/// to receive their USDC principal and prize yield. Closing an expired redemption receipt is intended
/// for rent reclamation when the batch is either fully expired (180+ days settled) or has already been
/// closed/swept by the protocol crank.
#[derive(Accounts)]
pub struct CloseExpiredRedemption<'info> {
    /// CHECK: The redemption owner receiving 100% of their SOL rent back.
    #[account(
        mut,
        address = pending_redemption.user @ PremiumBondsError::InvalidRedemptionOwner
    )]
    pub beneficiary: Signer<'info>,

    /// CHECK: The redemption batch PDA. Validated strictly by PDA seeds.
    /// May be closed (0 data, SystemProgram-owned) if already swept by crank,
    /// or open on-chain.
    #[account(
        seeds = [
            REDEMPTION_BATCH_SEED,
            pending_redemption.pool_id.to_le_bytes().as_ref(),
            pending_redemption.batch_id.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub batch: UncheckedAccount<'info>,

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
    let pending = &ctx.accounts.pending_redemption;

    RedemptionBatch::verify_expired_for_receipt(
        &ctx.accounts.batch.to_account_info(),
        pending,
        now,
    )?;

    let rent_reclaimed_lamports = ctx.accounts.pending_redemption.to_account_info().lamports();
    let pool_id = pending.pool_id;
    let batch_id = pending.batch_id;
    let redemption_id = pending.redemption_id;
    let beneficiary = ctx.accounts.beneficiary.key();
    let expired_principal = pending.amount;
    let redemption_type = pending.redemption_type;

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
