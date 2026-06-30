use anchor_lang::prelude::*;

/// Tracks an in-flight Huma Finance redemption request.
///
/// Created when a user sells bonds or claims a prize (or admin withdraws fees).
/// The user must call `claim_redemption` after Huma settles the request to
/// receive the underlying USDC.
///
/// PDA seeds: [b"pending_redemption", pool_id.to_le_bytes(), redemption_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
pub struct PendingRedemption {
    /// The pool this redemption belongs to.
    pub pool_id: u32,
    /// Unique sequential ID assigned from PrizePool.next_redemption_id.
    pub redemption_id: u64,
    /// The beneficiary who will receive the USDC on disburse.
    pub user: Pubkey,
    /// USDC amount owed to the user once Huma settles.
    pub amount: u64,
    /// Number of $PST shares locked in the Huma redemption request.
    pub pst_shares_locked: u64,
    /// Unix timestamp when the redemption was requested.
    pub requested_at: i64,
    /// The corresponding Huma request ID in the pool redemption queue.
    pub huma_request_id: u128,
    /// PDA bump seed.
    pub bump: u8,
}
