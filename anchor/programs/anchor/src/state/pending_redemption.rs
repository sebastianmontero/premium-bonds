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
///
/// Fields are grouped cohesively by domain role:
/// - Identification & PDA derivation (pool_id, redemption_id, bump)
/// - Beneficiary (user)
/// - Financial accounting (amount, pst_shares_locked)
/// - External Huma CPI lifecycle (huma_request_id, requested_at, redemption_type)
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InitPendingRedemptionParams {
    pub pool_id: u32,
    pub redemption_id: u64,
    pub bump: u8,
    pub user: Pubkey,
    pub amount: u64,
    pub pst_shares_locked: u64,
    pub huma_request_id: u128,
    pub requested_at: i64,
    pub redemption_type: RedemptionType,
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
#[repr(C)]
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
    /// Explicit padding to ensure 8-byte alignment for reserved space (offset 87..88).
    pub _padding: [u8; 1],
    /// Reserved space for future upgrades (offset 88..152, 160 bytes total account space).
    pub _reserved: [u8; 64],
}

const _: () = assert!(PendingRedemption::INIT_SPACE == 152);
const _: () = assert!(core::mem::offset_of!(PendingRedemption, _reserved) == 88);

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
            huma_request_id: params.huma_request_id,
            redemption_id: params.redemption_id,
            amount: params.amount,
            pst_shares_locked: params.pst_shares_locked,
            requested_at: params.requested_at,
            user: params.user,
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
}
