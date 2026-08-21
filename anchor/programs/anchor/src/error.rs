use anchor_lang::error_code;

#[error_code]
pub enum PremiumBondsError {
    /// The prize pool is not currently active.
    #[msg("The prize pool is not currently active.")]
    PoolNotActive,
    /// Invalid pool status value.
    #[msg("Invalid pool status value.")]
    InvalidPoolStatus,
    /// The current stake cycle has not yet ended.
    #[msg("The current stake cycle has not yet ended.")]
    CycleNotEnded,
    /// Invalid bond quantity.
    #[msg("Invalid bond quantity.")]
    InvalidBondQuantity,
    /// The prize pool registration capability has hit absolute capacity constraints.
    #[msg("The prize pool registration capability has hit absolute capacity constraints.")]
    RegistryFull,
    /// The registry account is too small. Client must pre-allocate at least REGISTRY_INITIAL_SIZE bytes.
    #[msg("The registry account is too small. Client must pre-allocate at least REGISTRY_INITIAL_SIZE bytes.")]
    RegistryTooSmall,
    /// The registry account has reached Solana's 10 MB maximum size.
    #[msg("The registry account has reached Solana's 10 MB maximum size.")]
    RegistryAtMaxSize,
    /// The snapshot relies on a frozen state during the drawing phase. Withdrawals/Deposits are momentarily paused.
    #[msg("The snapshot relies on a frozen state during the drawing phase. Withdrawals/Deposits are momentarily paused.")]
    AwaitingRandomnessFreeze,
    /// The ticket does not belong to the user.
    #[msg("The ticket does not belong to the user.")]
    UnauthorizedTicket,
    /// Trying to claim a prize that has already been claimed.
    #[msg("Trying to claim a prize that has already been claimed.")]
    AlreadyClaimed,
    /// Calculation overflow occurred natively.
    #[msg("Calculation overflow occurred natively.")]
    MathOverflow,
    /// Winner index is out of bounds.
    #[msg("Winner index is out of bounds.")]
    InvalidWinnerIndex,
    /// Only the designated Switchboard Jobs Account can execute this crank.
    #[msg("Only the designated Switchboard Jobs Account can execute this crank.")]
    UnauthorizedCrank,
    /// Invalid prize tier configuration.
    #[msg("Invalid prize tier configuration.")]
    InvalidPrizeTierConfig,
    /// Prize tiers have not been configured for this pool.
    #[msg("Prize tiers have not been configured for this pool.")]
    PrizeTiersNotConfigured,
    /// Total basis points across all tiers must equal exactly 10,000 (100%).
    #[msg("Total basis points across all tiers must equal exactly 10,000 (100%).")]
    BasisPointsMustEqual10000,
    /// The draw cycle is in an invalid phase for this operation.
    #[msg("The draw cycle is in an invalid phase for this operation")]
    InvalidDrawStatus,
    /// The draw cycle has an invalid locked count or prize pot.
    #[msg("The draw cycle has an invalid locked count or prize pot.")]
    InvalidDrawState,
    /// Unauthorized admin.
    #[msg("Unauthorized admin.")]
    UnauthorizedAdmin,
    /// Bond price must be greater than 0.
    #[msg("Bond price must be greater than 0.")]
    InvalidBondPrice,
    /// Stake cycle duration must be greater than 0 hours.
    #[msg("Stake cycle duration must be greater than 0 hours.")]
    InvalidStakeCycleDuration,
    /// Huma redemption has not been settled yet.
    #[msg("Huma redemption has not been settled yet.")]
    HumaRedemptionNotSettled,
    /// Beneficiary does not match the pending redemption owner.
    #[msg("Beneficiary does not match pending redemption owner.")]
    InvalidRedemptionOwner,
    /// Insufficient accrued fee balance for withdrawal.
    #[msg("Insufficient accrued fee balance for withdrawal.")]
    InsufficientFeeBalance,
    /// No unclaimed non-reinvested winnings to claim.
    #[msg("No unclaimed non-reinvested winnings to claim.")]
    NoWinningsToClaim,
    /// Fee basis points must be less than or equal to 10,000 (100%).
    #[msg("Fee basis points must be less than or equal to 10,000 (100%).")]
    InvalidFeeConfig,
    /// Max yield basis points must be less than or equal to 10,000 (100%).
    #[msg("Max yield basis points must be less than or equal to 10,000 (100%).")]
    InvalidMaxYieldBasisPoints,
    /// Payout timelock delay must not exceed 86,400 seconds (24 hours).
    #[msg("Payout timelock delay must not exceed 86,400 seconds (24 hours).")]
    InvalidPayoutTimelock,
    /// The mode mint does not match the pool's mode mint.
    #[msg("The mode mint does not match the pool's mode mint.")]
    InvalidModeMint,
    /// The provided randomness account is invalid or does not belong to Switchboard.
    #[msg("The provided randomness account is invalid or does not belong to Switchboard.")]
    InvalidRandomnessAccount,
    /// The randomness request has not yet been resolved by the oracle network.
    #[msg("The randomness request has not yet been resolved by the oracle network.")]
    RandomnessNotResolved,
    /// The randomness request is stale or was committed before the harvest freeze.
    #[msg("The randomness request is stale or was committed before the harvest freeze.")]
    StaleRandomnessRequest,
    /// The randomness account cannot be re-locked because the current one is not yet expired.
    #[msg(
        "The randomness account cannot be re-locked because the current one is not yet expired."
    )]
    RandomnessNotExpired,
    /// Invalid registry user entry hint provided.
    #[msg("Invalid registry user entry hint provided")]
    InvalidUserEntryHint,
    /// Insufficient pending tickets for this transaction.
    #[msg("Insufficient pending tickets for this transaction")]
    InsufficientPendingTickets,
    /// Insufficient active tickets for this transaction.
    #[msg("Insufficient active tickets for this transaction")]
    InsufficientActiveTickets,
    /// The prize pool must be frozen for draw preparation.
    #[msg("The prize pool must be frozen for draw preparation")]
    PoolNotFrozen,
    /// Required remaining account for swapped user's UserWinnings is missing.
    #[msg("Required remaining account for swapped user's UserWinnings is missing")]
    MissingSwappedUserWinnings,
    /// The provided fee wallet account is invalid or does not match the pool configuration.
    #[msg("The provided fee wallet account is invalid or does not match the pool configuration")]
    InvalidFeeWallet,
    /// Cannot modify bond price while pool has active deposits, pending redemptions, or allocated prizes.
    #[msg("Cannot modify bond price while pool has active deposits, pending redemptions, or allocated prizes.")]
    CannotModifyBondPriceWithActiveDeposits,
    /// The prize pool is paused due to an emergency or circuit breaker event.
    #[msg("The prize pool is paused.")]
    PoolPaused,
    /// The prize pool is closed permanently.
    #[msg("The prize pool is closed permanently.")]
    PoolClosed,
    /// This draw has been voided by the protocol administrator.
    #[msg("This draw has been voided.")]
    DrawVoided,
    /// This draw has already been voided.
    #[msg("This draw has already been voided.")]
    DrawAlreadyVoided,
    /// Winner payouts have already begun processing; draw cannot be voided.
    #[msg("Winner payouts have already begun processing.")]
    PayoutsAlreadyStarted,
    /// Payout settlement timelock is active. Please wait for the timelock window to elapse.
    #[msg("Payout settlement timelock is active.")]
    PayoutTimelockActive,
    /// Protocol fees from this cycle were already withdrawn; draw cannot be voided.
    #[msg("Protocol fees from this cycle were already withdrawn.")]
    FeesAlreadyWithdrawn,
    /// Yield generated in a single cycle exceeded the configured velocity ceiling.
    #[msg("Yield velocity limit exceeded.")]
    YieldVelocityExceeded,
    /// Yield venue balance dropped below deposited book value.
    #[msg("Yield venue is insolvent.")]
    YieldVenueInsolvent,
    /// Caller is not authorized for this operation.
    #[msg("Unauthorized signer.")]
    Unauthorized,
    /// Winner account does not match the payout registry entry.
    #[msg("Winner account does not match the payout registry entry.")]
    WinnerMismatch,
}
