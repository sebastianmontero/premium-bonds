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

impl TryFrom<u8> for RedemptionType {
    type Error = crate::error::PremiumBondsError;
    fn try_from(value: u8) -> std::result::Result<Self, Self::Error> {
        match value {
            0 => Ok(Self::BondSale),
            1 => Ok(Self::PrizeClaim),
            2 => Ok(Self::FeeWithdrawal),
            _ => Err(crate::error::PremiumBondsError::InvalidRedemptionType),
        }
    }
}

/// Parameter object for initializing a new PendingRedemption account.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InitPendingRedemptionParams {
    pub pool_id: u32,
    pub redemption_id: u64,
    pub batch_id: u64,
    pub bump: u8,
    pub user: Pubkey,
    pub amount: u64,
    pub requested_at: i64,
    pub redemption_type: RedemptionType,
}

/// Tracks an asynchronous batch redemption claim receipt.
///
/// Created when a user sells bonds or claims a prize (or admin withdraws fees).
/// The user must call `claim_redemption` after the batch settles to receive the underlying USDC.
///
/// PDA seeds: [b"pending_redemption", pool_id.to_le_bytes(), redemption_id.to_le_bytes()]
#[account]
#[derive(InitSpace)]
#[repr(C)]
pub struct PendingRedemption {
    pub user: Pubkey,                     // 32 bytes (offset 0..32)
    pub batch_id: u64,                    // 8 bytes  (offset 32..40)
    pub redemption_id: u64,               // 8 bytes  (offset 40..48)
    pub amount: u64,                      // 8 bytes  (offset 48..56)
    pub requested_at: i64,                // 8 bytes  (offset 56..64)
    pub pool_id: u32,                     // 4 bytes  (offset 64..68)
    pub bump: u8,                         // 1 byte   (offset 68..69)
    pub version: u8,                      // 1 byte   (offset 69..70)
    pub redemption_type: RedemptionType,  // 1 byte   (offset 70..71)
    pub _padding: [u8; 1],                // 1 byte   (offset 71..72)
    pub _reserved: [u8; 64],              // 64 bytes (offset 72..136)
}

const _: () = assert!(std::mem::size_of::<PendingRedemption>() == 136);
const _: () = assert!(std::mem::align_of::<PendingRedemption>() == 8);
const _: () = assert!(PendingRedemption::INIT_SPACE == 136);
const _: () = assert!(core::mem::offset_of!(PendingRedemption, _reserved) == 72);

impl From<InitPendingRedemptionParams> for PendingRedemption {
    fn from(params: InitPendingRedemptionParams) -> Self {
        Self::new(params)
    }
}

impl PendingRedemption {
    /// Current schema version of the PendingRedemption account.
    pub const CURRENT_VERSION: u8 = 1;

    /// Checks that the account version is supported.
    #[inline]
    pub fn check_version(&self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            crate::error::PremiumBondsError::UnsupportedAccountVersion
        );
        Ok(())
    }

    /// Lazily migrates this account to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        self.check_version()?;
        if self.version < Self::CURRENT_VERSION {
            // Future schema migrations will be handled here.
            self.version = Self::CURRENT_VERSION;
        }
        Ok(())
    }

    /// Constructs a new PendingRedemption struct from initialization parameters.
    pub fn new(params: InitPendingRedemptionParams) -> Self {
        Self {
            user: params.user,
            batch_id: params.batch_id,
            redemption_id: params.redemption_id,
            amount: params.amount,
            requested_at: params.requested_at,
            pool_id: params.pool_id,
            bump: params.bump,
            version: Self::CURRENT_VERSION,
            redemption_type: params.redemption_type,
            _padding: [0; 1],
            _reserved: [0; 64],
        }
    }

    /// Initializes this account in-place from parameter object.
    #[inline]
    pub fn init(&mut self, params: InitPendingRedemptionParams) {
        *self = params.into();
    }

    /// Zeroes out the owed amount to guard against CPI re-entrancy before token transfer.
    pub fn clear_amount(&mut self) {
        self.amount = 0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::PremiumBondsError;
    use anchor_lang::{AnchorDeserialize, AnchorSerialize};

    #[test]
    fn test_redemption_type_try_from_all_variants() {
        assert_eq!(
            RedemptionType::try_from(0).unwrap(),
            RedemptionType::BondSale
        );
        assert_eq!(
            RedemptionType::try_from(1).unwrap(),
            RedemptionType::PrizeClaim
        );
        assert_eq!(
            RedemptionType::try_from(2).unwrap(),
            RedemptionType::FeeWithdrawal
        );
        assert!(matches!(
            RedemptionType::try_from(3).unwrap_err(),
            PremiumBondsError::InvalidRedemptionType
        ));
        assert!(matches!(
            RedemptionType::try_from(255).unwrap_err(),
            PremiumBondsError::InvalidRedemptionType
        ));
    }

    #[test]
    fn test_redemption_type_serialization_roundtrip() {
        for variant in [
            RedemptionType::BondSale,
            RedemptionType::PrizeClaim,
            RedemptionType::FeeWithdrawal,
        ] {
            let mut encoded = Vec::new();
            variant
                .serialize(&mut encoded)
                .expect("serialization must succeed");
            let mut slice = encoded.as_slice();
            let decoded =
                RedemptionType::deserialize(&mut slice).expect("deserialization must succeed");
            assert_eq!(variant, decoded);
        }
    }
}
