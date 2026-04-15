use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum PoolStatus {
    Active,
    Paused,
    Closed,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct PrizeTier {
    pub basis_points: u16, // share of yield each winner in this tier receives
    pub num_winners: u32,  // number of winners in this tier
}

impl PrizeTier {
    pub fn calculate_prize(&self, prize_pot: u64) -> u64 {
        (prize_pot as u128)
            .checked_mul(self.basis_points as u128)
            .unwrap()
            .checked_div(10_000)
            .unwrap() as u64
    }
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
    pub is_frozen_for_draw: bool,
    pub current_draw_cycle_id: u32,
    pub max_withdrawal_slippage_dust: u64,
    #[max_len(10)]
    pub prize_tiers: Vec<PrizeTier>,
}

use crate::utils::calculate_percentage_fee;

impl PrizePool {
    pub fn calculate_fee(&self, yield_amount: u64) -> u64 {
        calculate_percentage_fee(yield_amount, self.fee_basis_points)
    }

    pub fn advance_cycle_end_at(&mut self, current_time: i64) {
        self.current_cycle_end_at = current_time
            .checked_add(self.stake_cycle_duration_hrs.checked_mul(3600).unwrap())
            .unwrap();
    }
}
