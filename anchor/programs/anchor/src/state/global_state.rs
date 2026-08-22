use anchor_lang::prelude::*;
use crate::error::PremiumBondsError;

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

impl GlobalConfig {
    /// Current schema version of the GlobalConfig account.
    pub const CURRENT_VERSION: u8 = 1;

    /// Initializes a new GlobalConfig account with default version and zeroed reserved space.
    pub fn init(&mut self, admin: Pubkey, guardian: Pubkey, jobs_account: Pubkey) {
        self.admin = admin;
        self.guardian = guardian;
        self.jobs_account = jobs_account;
        self.version = Self::CURRENT_VERSION;
        self._reserved = [0; 64];
    }

    /// Lazily migrates this account to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        if self.version < Self::CURRENT_VERSION {
            // Future schema migrations will be handled here.
            self.version = Self::CURRENT_VERSION;
        }
        Ok(())
    }
}
