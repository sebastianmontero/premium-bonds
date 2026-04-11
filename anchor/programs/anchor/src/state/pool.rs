use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PoolStatus {
    Active,
    Paused,
    Closed,
}

#[account]
pub struct PrizePool {
    pub vault_authority_bump: u8,
    pub pool_id: u32,
    pub token_mint: Pubkey,
    pub ticket_registry: Pubkey, // Pointer to the massive zero-copy registry
    pub bond_price: u64,
    pub stake_cycle_duration_hrs: i64,
    pub fee_basis_points: u16,
    pub status: PoolStatus,           
    pub total_deposited_principal: u64, 
    pub current_cycle_end_at: i64,
}

impl PrizePool {
    pub const INIT_SPACE: usize = 8 +  // discriminator
        1 +                            // vault_authority_bump
        4 +                            // pool_id
        32 +                           // token_mint
        32 +                           // ticket_registry pointer
        8 +                            // bond_price
        8 +                            // stake_cycle_duration_hrs
        2 +                            // fee_basis_points
        1 +                            // status (enum)
        8 +                            // total_deposited_principal
        8;                             // current_cycle_end_at
}
