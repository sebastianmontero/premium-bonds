use anchor_lang::prelude::*;

#[account]
pub struct GlobalConfig {
    pub admin: Pubkey,
    pub jobs_account: Pubkey, // Designated crank/bot account
    pub fee_wallet: Pubkey,
}

impl GlobalConfig {
    pub const INIT_SPACE: usize = 8 + 32 + 32 + 32;
}
