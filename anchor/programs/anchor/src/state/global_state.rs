use anchor_lang::prelude::*;

/// Global protocol configuration account.
///
/// This account holds protocol-wide parameters such as the admin key,
/// designated crank jobs bot account, and buy limits.
///
/// PDA seeds: [b"global_config"]
#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    /// Public key of the protocol administrator who can create pools and update configs.
    pub admin: Pubkey,
    /// Designated crank/bot account allowed to trigger restricted drawings and cranks.
    pub jobs_account: Pubkey,
    /// Maximum number of bonds/tickets a user can buy in a single transaction.
    pub max_tickets_per_buy: u32,
    /// Schema version of the struct.
    pub version: u8,
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}
