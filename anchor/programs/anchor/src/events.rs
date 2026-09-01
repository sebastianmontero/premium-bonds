use crate::state::PrizeTier;
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
    /// Pool's total deposited principal after this purchase.
    pub new_total_deposited_principal: u64,
    /// User's total bonds after this purchase (active + pending).
    pub user_total_bonds: u32,
    /// Unix timestamp of the purchase.
    pub timestamp: i64,
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
    /// Number of $PST shares locked in the Huma redemption request.
    pub pst_shares: u64,
    /// The corresponding Huma request ID in the pool redemption queue.
    pub huma_request_id: u128,
    /// Pool's total deposited principal after this sale.
    pub new_total_deposited_principal: u64,
    /// User's remaining bonds after this sale (active + pending), or 0 if exited.
    pub user_remaining_bonds: u32,
    /// Unix timestamp of the sale.
    pub timestamp: i64,
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
    /// Unix timestamp of the reinvestment.
    pub timestamp: i64,
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
    /// Number of $PST shares locked in the Huma redemption request.
    pub pst_shares: u64,
    /// The corresponding Huma request ID in the pool redemption queue.
    pub huma_request_id: u128,
    /// Unix timestamp of the claim request.
    pub timestamp: i64,
}

/// Emitted when a user claims a settled redemption (receives USDC) and closes PendingRedemption.
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
    /// Origin type of the redemption (0 = BondSale, 1 = PrizeClaim, 2 = FeeWithdrawal).
    pub redemption_type: u8,
    /// $PST shares that were locked in the original redemption request.
    pub pst_shares_locked: u64,
    /// The corresponding Huma request ID in the pool redemption queue.
    pub huma_request_id: u128,
    /// Unix timestamp when the redemption was originally requested.
    pub requested_at: i64,
    /// Unix timestamp when this claim was executed.
    pub timestamp: i64,
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
    /// Actual total amount distributed to winners in this draw (excluding dust).
    pub total_distributed: u64,
    /// Pool's lifetime cumulative prizes distributed across all completed draws.
    pub total_prizes_distributed: u64,
    /// Unix timestamp when the draw was completed.
    pub timestamp: i64,
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
    /// Unix timestamp when the draw was skipped.
    pub timestamp: i64,
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
    /// Unix timestamp when the force unlock was executed.
    pub timestamp: i64,
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
    pub max_yield_basis_points: u16,
    pub payout_timelock_seconds: u32,
    pub tiers_count: u8,
    pub total_winners: u32,
    pub timestamp: i64,
}

/// Emitted when a Huma lender is initialized for a pool.
#[event]
pub struct HumaLenderInitialized {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub timestamp: i64,
}

/// Emitted when global configuration is initialized for the first time.
#[event]
pub struct GlobalConfigInitialized {
    pub admin: Pubkey,
    pub guardian: Pubkey,
    pub jobs_account: Pubkey,
    pub timestamp: i64,
}

/// Emitted when global configuration is updated (old → new values for audit trail).
#[event]
pub struct GlobalConfigUpdated {
    /// The admin authority who performed the change.
    pub authority: Pubkey,
    pub old_admin: Pubkey,
    pub new_admin: Pubkey,
    pub old_guardian: Pubkey,
    pub new_guardian: Pubkey,
    pub old_jobs_account: Pubkey,
    pub new_jobs_account: Pubkey,
    pub timestamp: i64,
}

/// Emitted when pool configuration is updated.
#[event]
pub struct PoolConfigUpdated {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub old_fee_basis_points: u16,
    pub new_fee_basis_points: u16,
    pub old_bond_price: u64,
    pub new_bond_price: u64,
    pub old_fee_wallet: Pubkey,
    pub new_fee_wallet: Pubkey,
    pub old_min_yield_threshold: u64,
    pub new_min_yield_threshold: u64,
    pub old_stake_cycle_duration_hrs: i64,
    pub new_stake_cycle_duration_hrs: i64,
    pub old_max_yield_basis_points: u16,
    pub new_max_yield_basis_points: u16,
    pub old_payout_timelock_seconds: u32,
    pub new_payout_timelock_seconds: u32,
    pub timestamp: i64,
}

/// Emitted when a pool's administrative lifecycle status is changed (pause, unpause, close).
#[event]
pub struct PoolStatusChanged {
    pub pool_id: u32,
    pub previous_status: u8,
    pub new_status: u8,
    pub authority: Pubkey,
    pub timestamp: i64,
}

/// Emitted when the on-chain solvency circuit breaker trips due to venue deficit.
#[event]
pub struct EmergencyInsolvencyDetected {
    pub pool_id: u32,
    pub current_value: u64,
    pub book_value: u64,
    pub deficit: u64,
    pub timestamp: i64,
}

/// Emitted when single-cycle yield breaches the configured velocity ceiling.
#[event]
pub struct YieldVelocityBreached {
    pub pool_id: u32,
    pub yield_generated: u64,
    pub max_allowed_yield: u64,
    pub timestamp: i64,
}

/// Emitted when a completed draw is voided and rolled back by an administrator.
#[event]
pub struct DrawVoided {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub admin: Pubkey,
    pub prizes_reversed: u64,
    pub fees_reversed: u64,
    pub timestamp: i64,
}

/// Emitted when prize tiers are updated for a pool.
#[event]
pub struct PrizeTiersUpdated {
    pub pool_id: u32,
    pub admin: Pubkey,
    pub old_tiers_count: u8,
    pub old_total_winners: u32,
    pub new_tiers_count: u8,
    pub new_total_winners: u32,
    pub tiers: Vec<PrizeTier>,
    pub timestamp: i64,
}

/// Emitted when a pool's ticket registry is resized.
#[event]
pub struct RegistryResized {
    pub pool_id: u32,
    pub caller: Pubkey,
    pub old_capacity: u32,
    pub new_capacity: u32,
    pub timestamp: i64,
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
    pub timestamp: i64,
}

/// Emitted when expired randomness is rebound for a pool.
#[event]
pub struct RandomnessRebound {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub old_randomness_account: Pubkey,
    pub new_randomness_account: Pubkey,
    pub harvest_slot: u64,
    pub timestamp: i64,
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
    pub huma_request_id: u128,
    pub timestamp: i64,
}

/// Emitted when a batch of draw preparation entries is processed.
#[event]
pub struct DrawPreparationProgress {
    /// Pool ID for the draw being prepared.
    pub pool_id: u32,
    /// Draw cycle ID being prepared.
    pub cycle_id: u32,
    /// Starting index of this batch (inclusive).
    pub batch_start: u32,
    /// Ending index of this batch (exclusive).
    pub batch_end: u32,
    /// Total user count requiring preparation.
    pub user_count: u32,
    /// Whether this batch completed the full preparation.
    pub is_complete: bool,
    /// Unix timestamp when this preparation progress was recorded.
    pub timestamp: i64,
}

