use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub jobs_account: Pubkey, // Designated crank/bot account
    pub max_tickets_per_buy: u32,
}
