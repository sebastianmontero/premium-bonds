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
    #[msg("Draw cycle is not currently awaiting random execution.")]
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
    #[msg("Burned more Kamino kTokens than mathematically permitted for this withdrawal.")]
    ExcessiveKtokensBurned,
}
