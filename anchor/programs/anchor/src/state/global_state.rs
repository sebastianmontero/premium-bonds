use anchor_lang::prelude::*;

/// Global protocol configuration account.
///
/// This account holds protocol-wide parameters such as the admin key
/// and designated crank jobs bot account.
///
/// PDA seeds: [b"global_config"]
#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    /// Public key of the protocol administrator who can create pools and update configs.
    pub admin: Pubkey,
    /// Public key of the hot emergency guardian bot.
    pub guardian: Pubkey,
    /// Designated crank/bot account allowed to trigger restricted drawings and cranks.
    pub jobs_account: Pubkey,
    /// Schema version of the struct.
    pub version: u8,
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}
