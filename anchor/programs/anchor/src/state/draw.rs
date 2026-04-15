use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, InitSpace)]
pub enum DrawStatus { AwaitingYield, AwaitingRandomness, Complete }

#[account]
#[derive(InitSpace)]
pub struct DrawCycle {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub status: DrawStatus,
    pub locked_ticket_count: u32, 
    pub randomness_seed: [u8; 32],
    pub prize_pot: u64,
    pub cycle_fee_collected: u64,
}

#[account]
#[derive(InitSpace)]
pub struct PayoutRegistry {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub winners_count: u32,
    pub payouts_completed: u32,
    #[max_len(50)]
    pub winners: Vec<Winner>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, InitSpace)]
pub struct Winner {
    pub winner_pubkey: Pubkey,
    pub amount_owed: u64,
    pub paid_out: bool,
    pub tier_index: u8,
}
