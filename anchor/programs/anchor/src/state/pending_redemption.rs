use anchor_lang::prelude::*;

/// Describes the origin of a pending redemption request.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum RedemptionType {
    /// Originated from a user selling bonds (principal redemption).
    BondSale,
    /// Originated from a user claiming non-reinvested prize winnings.
    PrizeClaim,
    /// Originated from an admin withdrawing protocol fees.
    FeeWithdrawal,
}

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
    /// The corresponding Huma request ID in the pool redemption queue.
    pub huma_request_id: u128,
    /// Unique sequential ID assigned from PrizePool.next_redemption_id.
    pub redemption_id: u64,
    /// USDC amount owed to the user once Huma settles.
    pub amount: u64,
    /// Number of $PST shares locked in the Huma redemption request.
    pub pst_shares_locked: u64,
    /// Unix timestamp when the redemption was requested.
    pub requested_at: i64,
    /// The beneficiary who will receive the USDC on disburse.
    pub user: Pubkey,
    /// The pool this redemption belongs to.
    pub pool_id: u32,
    /// PDA bump seed.
    pub bump: u8,
    /// Schema version of the struct.
    pub version: u8,
    /// Origin/type of redemption (BondSale, PrizeClaim, FeeWithdrawal).
    pub redemption_type: RedemptionType,
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}
