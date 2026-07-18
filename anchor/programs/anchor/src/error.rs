use anchor_lang::error_code;

#[error_code]
pub enum PremiumBondsError {
    #[msg("The prize pool is not currently active.")]
    PoolNotActive,
    #[msg("The current stake cycle has not yet ended.")]
    CycleNotEnded,
    #[msg("Invalid bond quanitity.")]
    InvalidBondQuantity,
    #[msg("Invalid collateral amount.")]
    InvalidCollateralAmount,
    #[msg("The prize pool registration capability has hit absolute capacity constraints.")]
    RegistryFull,
    #[msg("The registry account is too small. Client must pre-allocate at least REGISTRY_INITIAL_SIZE bytes.")]
    RegistryTooSmall,
    #[msg("The registry account has reached Solana's 10 MB maximum size.")]
    RegistryAtMaxSize,
    #[msg("The snapshot relies on a frozen state during the drawing phase. Withdrawals/Deposits are momentarily paused.")]
    AwaitingRandomnessFreeze,
    #[msg("Trying to sell a ticket that does not belong to the signer.")]
    UnauthorizedTicket,
    #[msg("Trying to claim a prize that has already been claimed.")]
    AlreadyClaimed,
    #[msg("Calculation overflow occurred natively.")]
    MathOverflow,
    #[msg("Invalid indices ordering. Please provide deduplicated descending indices.")]
    InvalidIndices,
    #[msg("Only the designated Switchboard Jobs Account can execute this crank.")]
    UnauthorizedCrank,
    #[msg("Invalid prize tier configuration.")]
    InvalidPrizeTierConfig,
    #[msg("Prize tiers have not been configured for this pool.")]
    PrizeTiersNotConfigured,
    #[msg("Total basis points across all tiers must equal exactly 10,000 (100%).")]
    BasisPointsMustEqual10000,
    #[msg("The draw cycle is in an invalid phase for this operation")]
    InvalidDrawStatus,
    #[msg("The draw cycle has an invalid locked count or prize pot.")]
    InvalidDrawState,
    #[msg("Unauthorized admin.")]
    UnauthorizedAdmin,
    #[msg("Bond price must be greater than 0.")]
    InvalidBondPrice,
    #[msg("Stake cycle duration must be greater than 0 hours.")]
    InvalidStakeCycleDuration,
    #[msg("The maximum number of tickets per transaction was exceeded.")]
    MaxTicketsPerBuyExceeded,
    #[msg("Huma redemption has not been settled yet.")]
    HumaRedemptionNotSettled,
    #[msg("This pending redemption does not belong to the signer.")]
    InvalidRedemptionOwner,
    #[msg("Insufficient accrued fee balance for withdrawal.")]
    InsufficientFeeBalance,
    #[msg("No unclaimed non-reinvested winnings to claim.")]
    NoWinningsToClaim,
    #[msg("Fee basis points must be less than or equal to 10,000 (100%).")]
    InvalidFeeConfig,
    #[msg("The mode mint does not match the pool's mode mint.")]
    InvalidModeMint,
    #[msg("The provided randomness account is invalid or does not belong to Switchboard.")]
    InvalidRandomnessAccount,
    #[msg("The randomness request has not yet been resolved by the oracle network.")]
    RandomnessNotResolved,
    #[msg("The randomness request is stale or was committed before the harvest freeze.")]
    StaleRandomnessRequest,
    #[msg(
        "The randomness account cannot be re-locked because the current one is not yet expired."
    )]
    RandomnessNotExpired,
    #[msg("Invalid registry user entry hint provided")]
    InvalidUserEntryHint,
    #[msg("Insufficient pending tickets for this transaction")]
    InsufficientPendingTickets,
    #[msg("Insufficient active tickets for this transaction")]
    InsufficientActiveTickets,
    #[msg("The prize pool must be frozen for draw preparation")]
    PoolNotFrozen,
    #[msg("Required remaining account for swapped user's UserWinnings is missing")]
    MissingSwappedUserWinnings,
}
