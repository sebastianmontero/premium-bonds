use anchor_lang::prelude::*;

/// Emitted when a user purchases bonds.
#[event]
pub struct BondsPurchased {
    /// Public key of the user who purchased bonds.
    pub user: Pubkey,
    /// Pool ID where the bonds were purchased.
    pub pool_id: u32,
    /// Number of bonds purchased.
    pub bonds: u32,
    /// Amount of USDC deposited (in base units).
    pub amount: u64,
}

/// Emitted when a user sells bonds and initiates an async redemption.
#[event]
pub struct BondsSold {
    /// Public key of the user who sold bonds.
    pub user: Pubkey,
    /// Pool ID where the bonds were sold.
    pub pool_id: u32,
    /// Number of bonds sold.
    pub bonds: u32,
    /// Principal amount of USDC owed to the user (in base units).
    pub principal: u64,
    /// Unique identifier of the pending redemption account created.
    pub redemption_id: u64,
}

/// Emitted when a winner's prize is reinvested into new bonds by the crank.
#[event]
pub struct WinningsReinvested {
    /// Public key of the winner.
    pub winner: Pubkey,
    /// Pool ID where the reinvestment took place.
    pub pool_id: u32,
    /// Cycle ID when the drawing occurred.
    pub cycle_id: u32,
    /// Number of new bonds purchased via reinvestment.
    pub bonds_bought: u32,
    /// Amount of USDC reinvested (in base units).
    pub amount_reinvested: u64,
    /// Whether this was the final batch of reinvestments for this winner.
    pub is_final_batch: bool,
}

/// Emitted when a user claims non-reinvested winnings (initiates async redemption).
#[event]
pub struct WinningsClaimed {
    /// Public key of the user claiming winnings.
    pub user: Pubkey,
    /// Pool ID from which the winnings were claimed.
    pub pool_id: u32,
    /// Amount of USDC winnings claimed (in base units).
    pub amount: u64,
    /// Unique identifier of the pending redemption account created.
    pub redemption_id: u64,
}

/// Emitted when a user claims a settled redemption (receives USDC).
#[event]
pub struct RedemptionClaimed {
    /// Public key of the user receiving the disbursed USDC.
    pub user: Pubkey,
    /// Pool ID this redemption belongs to.
    pub pool_id: u32,
    /// Amount of USDC disbursed (in base units).
    pub amount: u64,
    /// Unique identifier of the redeemed pending redemption.
    pub redemption_id: u64,
}

/// Emitted when a draw cycle is completed and winners are picked.
#[event]
pub struct DrawCompleted {
    /// Pool ID where the draw occurred.
    pub pool_id: u32,
    /// Draw cycle ID that was completed.
    pub cycle_id: u32,
    /// Total prize pot (in base units) generated during the cycle.
    pub prize_pot: u64,
    /// Total number of winners selected for the cycle.
    pub winners_count: u32,
}

/// Emitted when a draw cycle is skipped (due to insufficient yield or zero active tickets).
#[event]
pub struct DrawSkipped {
    /// Pool ID where the draw was skipped.
    pub pool_id: u32,
    /// Draw cycle ID that was skipped.
    pub cycle_id: u32,
    /// Yield generated in base units.
    pub raw_yield: u64,
    /// Pool's minimum yield threshold.
    pub threshold: u64,
}

/// Emitted when an admin force unlocks a stuck draw cycle.
#[event]
pub struct DrawForceUnlocked {
    /// Pool ID where the draw was force unlocked.
    pub pool_id: u32,
    /// Draw cycle ID that was force unlocked.
    pub cycle_id: u32,
    /// Public key of the admin who executed the force unlock.
    pub admin: Pubkey,
    /// Prize pot amount (in base units) that was reversed during unlock.
    pub prize_pot: u64,
    /// Protocol cycle fee amount (in base units) that was reversed during unlock.
    pub cycle_fee_collected: u64,
}

/// Emitted when a new pool is created by an admin.
#[event]
pub struct PoolCreated {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub token_mint: Pubkey,
    pub pst_mint: Pubkey,
    pub fee_wallet: Pubkey,
    pub ticket_registry: Pubkey,
    pub bond_price: u64,
    pub stake_cycle_duration_hrs: i64,
    pub fee_basis_points: u16,
    pub min_yield_threshold: u64,
}

/// Emitted when a Huma lender is initialized for a pool.
#[event]
pub struct HumaLenderInitialized {
    pub pool_id: u32,
    pub admin: Pubkey,
}

/// Emitted when global configuration is updated.
#[event]
pub struct GlobalConfigUpdated {
    pub admin: Pubkey,
    pub jobs_account: Pubkey,
}

/// Emitted when pool configuration is updated.
#[event]
pub struct PoolConfigUpdated {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub fee_basis_points: u16,
    pub bond_price: u64,
    pub fee_wallet: Pubkey,
    pub min_yield_threshold: u64,
}

/// Emitted when prize tiers are updated for a pool.
#[event]
pub struct PrizeTiersUpdated {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub tiers_count: u8,
    pub total_winners: u32,
}

/// Emitted when a pool's ticket registry is resized.
#[event]
pub struct RegistryResized {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub old_capacity: u32,
    pub new_capacity: u32,
}

/// Emitted when yield is harvested and committed for a cycle.
#[event]
pub struct YieldHarvested {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub raw_yield: u64,
    pub fee: u64,
    pub prize_pot: u64,
    pub locked_ticket_count: u32,
    pub randomness_account: Pubkey,
}

/// Emitted when expired randomness is rebound for a pool.
#[event]
pub struct RandomnessRebound {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub old_randomness_account: Pubkey,
    pub new_randomness_account: Pubkey,
    pub harvest_slot: u64,
}

/// Emitted when fees are withdrawn by an admin.
#[event]
pub struct FeesWithdrawn {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub fee_wallet: Pubkey,
    pub amount: u64,
    pub pst_shares: u64,
    pub redemption_id: u64,
}
