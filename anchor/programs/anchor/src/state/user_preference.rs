use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct UserPreference {
    pub pool_id: u32,
    pub user: Pubkey,
    pub auto_reinvest: bool,
}
