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
    /// Whether this was the final batch of reinvestments for this winner.
    pub is_final_batch: bool,
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
    /// Unix timestamp of the claim.
    pub timestamp: i64,
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
    /// Unix timestamp of the disbursement.
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
    /// Unix timestamp of the draw completion.
    pub timestamp: i64,
}
