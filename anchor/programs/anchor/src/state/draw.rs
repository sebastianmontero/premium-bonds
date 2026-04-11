use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum DrawStatus { AwaitingYield, AwaitingRandomness, Complete }

#[account]
pub struct DrawCycle {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub status: DrawStatus,
    pub locked_ticket_count: u32, 
    pub randomness_seed: [u8; 32],
    pub prize_pot: u64,
}

impl DrawCycle {
    pub const INIT_SPACE: usize = 8 +  // discriminator
        4 +                            // pool_id
        4 +                            // cycle_id
        1 +                            // status (enum)
        4 +                            // locked_ticket_count
        32 +                           // randomness_seed
        8;                             // prize_pot
}

#[account]
pub struct PayoutRegistry {
    pub pool_id: u32,
    pub cycle_id: u32,
    pub winners_count: u32,
    pub payouts_completed: u32,
    // Dynamic array for phase 1
    pub winners: Vec<Winner>,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct Winner {
    pub winner_pubkey: Pubkey,
    pub amount_owed: u64,
    pub paid_out: bool,
}
