use anchor_lang::prelude::*;

/// Emitted when a user purchases bonds.
#[event]
pub struct BondsPurchased {
    pub user: Pubkey,
    pub pool_id: u32,
    pub bonds: u32,
    pub amount: u64,
    pub timestamp: i64,
}

/// Emitted when a user sells bonds and initiates an async redemption.
#[event]
pub struct BondsSold {
    pub user: Pubkey,
    pub pool_id: u32,
    pub bonds: u32,
    pub principal: u64,
    pub redemption_id: u64,
    pub timestamp: i64,
}

/// Emitted when a winner's prize is reinvested into new bonds by the crank.
#[event]
pub struct WinningsReinvested {
    pub winner: Pubkey,
    pub pool_id: u32,
    pub cycle_id: u32,
    pub bonds_bought: u32,
    pub amount_reinvested: u64,
    pub is_final_batch: bool,
    pub timestamp: i64,
}

/// Emitted when a user claims non-reinvested winnings (initiates async redemption).
#[event]
pub struct WinningsClaimed {
    pub user: Pubkey,
    pub pool_id: u32,
    pub amount: u64,
    pub redemption_id: u64,
    pub timestamp: i64,
}

/// Emitted when a user claims a settled redemption (receives USDC).
#[event]
pub struct RedemptionClaimed {
    pub user: Pubkey,
    pub pool_id: u32,
    pub amount: u64,
    pub redemption_id: u64,
    pub timestamp: i64,
}

/// Emitted when a draw cycle is completed and winners are picked.
#[event]
pub struct DrawCompleted {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub prize_pot: u64,
    pub winners_count: u32,
    pub timestamp: i64,
}
