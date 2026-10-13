use crate::error::PremiumBondsError;
use anchor_lang::prelude::*;

/// Global protocol configuration account.
///
/// This account holds protocol-wide parameters such as the admin key
/// and designated crank jobs bot account.
///
/// PDA seeds: [b"global_config"]
#[account]
#[derive(InitSpace)]
#[repr(C)]
pub struct GlobalConfig {
    /// Public key of the protocol administrator who can create pools and update configs.
    pub admin: Pubkey,
    /// Public key of the hot emergency guardian bot.
    pub guardian: Pubkey,
    /// Designated crank/bot account allowed to trigger restricted drawings and cranks.
    pub jobs_account: Pubkey,
    /// Nominated pending admin awaiting role acceptance via two-step transfer.
    pub pending_admin: Pubkey,
    /// Schema version of the struct.
    pub version: u8,
    /// Explicit padding to maintain 8-byte alignment for _reserved.
    pub _padding: [u8; 7],
    /// Reserved space for future upgrades.
    pub _reserved: [u8; 64],
}

const _: () = assert!(std::mem::size_of::<GlobalConfig>() == 200);
const _: () = assert!(GlobalConfig::INIT_SPACE == 200);
const _: () = assert!(core::mem::offset_of!(GlobalConfig, _reserved) == 136);

crate::impl_versioned!(GlobalConfig, 1);

impl GlobalConfig {
    pub fn validate_admin(admin: &Pubkey) -> Result<()> {
        require!(*admin != Pubkey::default(), PremiumBondsError::InvalidAdminAddress);
        Ok(())
    }

    pub fn validate_guardian(guardian: &Pubkey) -> Result<()> {
        require!(*guardian != Pubkey::default(), PremiumBondsError::InvalidGuardianAddress);
        Ok(())
    }

    pub fn validate_jobs_account(jobs_account: &Pubkey) -> Result<()> {
        require!(*jobs_account != Pubkey::default(), PremiumBondsError::InvalidJobsAccountAddress);
        Ok(())
    }

    /// Initializes a new GlobalConfig account, enforcing role integrity invariants internally.
    pub fn init(&mut self, admin: Pubkey, guardian: Pubkey, jobs_account: Pubkey) -> Result<()> {
        Self::validate_admin(&admin)?;
        Self::validate_guardian(&guardian)?;
        Self::validate_jobs_account(&jobs_account)?;

        self.admin = admin;
        self.guardian = guardian;
        self.jobs_account = jobs_account;
        self.pending_admin = Pubkey::default();
        self.version = Self::CURRENT_VERSION;
        self._padding = [0; 7];
        self._reserved = [0; 64];
        Ok(())
    }

    pub fn set_guardian(&mut self, guardian: Pubkey) -> Result<()> {
        Self::validate_guardian(&guardian)?;
        self.guardian = guardian;
        Ok(())
    }

    pub fn set_jobs_account(&mut self, jobs_account: Pubkey) -> Result<()> {
        Self::validate_jobs_account(&jobs_account)?;
        self.jobs_account = jobs_account;
        Ok(())
    }
}
