use anchor_lang::error_code;

#[error_code]
pub enum PremiumBondsError {
    #[msg("The prize pool is not currently active.")]
    PoolNotActive,
    #[msg("The bond purchase amount must be a clean multiple of the bond price.")]
    InvalidBondAmount,
    #[msg("The prize pool registration capability has hit absolute capacity constraints.")]
    RegistryFull,
    #[msg("The snapshot relies on a frozen state during the drawing phase. Withdrawals/Deposits are momentarily paused.")]
    AwaitingRandomnessFreeze,
    #[msg("Trying to sell a ticket that does not belong to the signer.")]
    UnauthorizedTicket,
    #[msg("Calculation overflow occurred natively.")]
    MathOverflow,
    #[msg("Invalid indices ordering. Please provide deduplicated descending indices.")]
    InvalidIndices,
}
