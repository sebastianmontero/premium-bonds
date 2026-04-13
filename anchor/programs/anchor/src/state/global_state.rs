use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub jobs_account: Pubkey, // Designated crank/bot account
    pub fee_wallet: Pubkey,
}
