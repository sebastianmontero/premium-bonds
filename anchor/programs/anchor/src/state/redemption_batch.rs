use anchor_lang::prelude::*;
use crate::error::PremiumBondsError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq, InitSpace)]
#[repr(u8)]
pub enum RedemptionBatchStatus {
    /// Batch is currently open and accepting redemptions from bond sales, prizes, and fee withdrawals.
    Accumulating,
    /// Batch has been submitted to Huma via add_redemption_request and is waiting in Huma's queue.
    Submitted,
    /// Huma has settled the queue and funds have been disbursed into the pool vault. Payout rate is locked.
    Settled,
}

#[account]
#[derive(InitSpace)]
#[repr(C)]
pub struct RedemptionBatch {
    // 16-byte alignment
    /// The sequential Huma queue request ID assigned upon submission (0 if accumulating).
    pub huma_request_id: u128,              // 16 bytes (offset 0..16)

    // 8-byte alignment
    /// Sequential ID of this redemption batch.
    pub batch_id: u64,                      // 8 bytes (offset 16..24)
    /// Total nominal USDC principal requested in this batch.
    pub total_principal_requested: u64,     // 8 bytes (offset 24..32)
    /// Total $PST shares locked in this batch upon submission to Huma.
    pub total_pst_shares_locked: u64,       // 8 bytes (offset 32..40)
    /// Actual USDC lamports disbursed by Huma for this batch upon settlement.
    pub settled_usdc_received: u64,         // 8 bytes (offset 40..48)
    /// Cumulative principal claimed by users so far.
    pub claimed_principal: u64,             // 8 bytes (offset 48..56)
    /// Unix timestamp when the batch was created.
    pub created_at: i64,                    // 8 bytes (offset 56..64)
    /// Unix timestamp when the batch was submitted to Huma (0 if accumulating).
    pub submitted_at: i64,                  // 8 bytes (offset 64..72)
    /// Unix timestamp when the batch was settled from Huma (0 if in-flight).
    pub settled_at: i64,                    // 8 bytes (offset 72..80)

    // 4-byte alignment
    /// The pool ID this batch belongs to.
    pub pool_id: u32,                       // 4 bytes (offset 80..84)

    // 1-byte alignment & padding
    /// Lifecycle status of this batch.
    pub status: RedemptionBatchStatus,      // 1 byte  (offset 84..85)
    /// PDA bump seed.
    pub bump: u8,                           // 1 byte  (offset 85..86)
    /// Explicit padding to maintain 8-byte alignment for _reserved.
    pub _padding: [u8; 2],                  // 2 bytes (offset 86..88)

    // Upgrade buffer (72 bytes ensures total struct size == 160 bytes, cleanly divisible by 16)
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 72],                // 72 bytes (offset 88..160)
}

const _: () = assert!(std::mem::size_of::<RedemptionBatch>() == 160);
const _: () = assert!(std::mem::align_of::<RedemptionBatch>() == 8 || std::mem::align_of::<RedemptionBatch>() == 16);
const _: () = assert!(core::mem::offset_of!(RedemptionBatch, _reserved) == 88);

impl RedemptionBatch {
    pub fn init_accumulating(&mut self, pool_id: u32, batch_id: u64, bump: u8, created_at: i64) {
        self.huma_request_id = 0;
        self.batch_id = batch_id;
        self.total_principal_requested = 0;
        self.total_pst_shares_locked = 0;
        self.settled_usdc_received = 0;
        self.claimed_principal = 0;
        self.created_at = created_at;
        self.submitted_at = 0;
        self.settled_at = 0;
        self.pool_id = pool_id;
        self.status = RedemptionBatchStatus::Accumulating;
        self.bump = bump;
        self._padding = [0; 2];
        self._reserved = [0; 72];
    }

    pub fn accumulate(&mut self, principal_amount: u64) -> Result<()> {
        require!(self.status == RedemptionBatchStatus::Accumulating, PremiumBondsError::InvalidBatchStatus);
        self.total_principal_requested = self.total_principal_requested
            .checked_add(principal_amount)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(())
    }

    pub fn submit(&mut self, huma_request_id: u128, pst_shares: u64, timestamp: i64) -> Result<()> {
        require!(self.status == RedemptionBatchStatus::Accumulating, PremiumBondsError::InvalidBatchStatus);
        require!(self.total_principal_requested > 0, PremiumBondsError::EmptyRedemptionBatch);
        self.huma_request_id = huma_request_id;
        self.total_pst_shares_locked = pst_shares;
        self.submitted_at = timestamp;
        self.status = RedemptionBatchStatus::Submitted;
        Ok(())
    }

    pub fn settle(&mut self, usdc_received: u64, timestamp: i64) -> Result<()> {
        require!(self.status == RedemptionBatchStatus::Submitted, PremiumBondsError::InvalidBatchStatus);
        self.settled_usdc_received = usdc_received;
        self.settled_at = timestamp;
        self.status = RedemptionBatchStatus::Settled;
        Ok(())
    }

    pub fn calculate_payout(&self, principal_amount: u64) -> Result<u64> {
        require!(self.status == RedemptionBatchStatus::Settled, PremiumBondsError::RedemptionBatchNotSettled);
        let payout = (principal_amount as u128)
            .checked_mul(self.settled_usdc_received as u128)
            .ok_or(PremiumBondsError::MathOverflow)?
            .checked_div(self.total_principal_requested as u128)
            .ok_or(PremiumBondsError::MathOverflow)?;
        payout.try_into().map_err(|_| PremiumBondsError::MathOverflow.into())
    }

    pub fn claim(&mut self, principal_amount: u64) -> Result<u64> {
        let payout = self.calculate_payout(principal_amount)?;
        self.claimed_principal = self.claimed_principal
            .checked_add(principal_amount)
            .ok_or(PremiumBondsError::MathOverflow)?;
        require!(self.claimed_principal <= self.total_principal_requested, PremiumBondsError::BatchOverclaimed);
        Ok(payout)
    }

    #[inline]
    pub fn is_fully_claimed(&self) -> bool {
        self.status == RedemptionBatchStatus::Settled && self.claimed_principal >= self.total_principal_requested
    }

    #[inline]
    pub fn is_expired(&self, current_timestamp: i64) -> bool {
        self.status == RedemptionBatchStatus::Settled
            && current_timestamp >= self.settled_at.saturating_add(crate::constants::BATCH_CLAIM_EXPIRY_SECONDS)
    }

    #[inline]
    pub fn can_close(&self, current_timestamp: i64) -> bool {
        self.is_fully_claimed() || self.is_expired(current_timestamp)
    }

    #[inline]
    pub fn unclaimed_principal(&self) -> u64 {
        self.total_principal_requested.saturating_sub(self.claimed_principal)
    }

    pub fn calculate_unclaimed_payout(&self) -> Result<u64> {
        self.calculate_payout(self.unclaimed_principal())
    }
}
