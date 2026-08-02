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
    #[msg("Invalid bond quanitity.")]
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
    /// Trying to sell a ticket that does not belong to the signer.
    #[msg("Trying to sell a ticket that does not belong to the signer.")]
    UnauthorizedTicket,
    /// Trying to claim a prize that has already been claimed.
    #[msg("Trying to claim a prize that has already been claimed.")]
    AlreadyClaimed,
    /// Calculation overflow occurred natively.
    #[msg("Calculation overflow occurred natively.")]
    MathOverflow,
    /// Invalid indices ordering. Please provide deduplicated descending indices.
    #[msg("Invalid indices ordering. Please provide deduplicated descending indices.")]
    InvalidIndices,
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
    /// The maximum number of tickets per transaction was exceeded.
    #[msg("The maximum number of tickets per transaction was exceeded.")]
    MaxTicketsPerBuyExceeded,
    /// Huma redemption has not been settled yet.
    #[msg("Huma redemption has not been settled yet.")]
    HumaRedemptionNotSettled,
    /// This pending redemption does not belong to the signer.
    #[msg("This pending redemption does not belong to the signer.")]
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
}
