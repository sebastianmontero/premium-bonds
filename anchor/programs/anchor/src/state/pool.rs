use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum PoolStatus {
    Active,
    Paused,
    Closed,
}

#[account]
#[derive(InitSpace)]
pub struct PrizePool {
    pub vault_authority_bump: u8,
    pub pool_id: u32,
    pub token_mint: Pubkey,
    pub ticket_registry: Pubkey, // Pointer to the massive zero-copy registry
    pub fee_wallet: Pubkey,
    pub bond_price: u64,
    pub stake_cycle_duration_hrs: i64,
    pub fee_basis_points: u16,
    pub status: PoolStatus,           
    pub total_deposited_principal: u64, 
    pub total_fees_collected: u64,
    pub current_cycle_end_at: i64,
}

use crate::utils::calculate_percentage_fee;

impl PrizePool {
    pub fn calculate_fee(&self, yield_amount: u64) -> u64 {
        calculate_percentage_fee(yield_amount, self.fee_basis_points)
    }
}
