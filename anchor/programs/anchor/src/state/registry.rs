use anchor_lang::prelude::*;
use crate::error::PremiumBondsError;

/// Zero-copy header for the TicketRegistry account.
/// User entries are stored in the raw bytes immediately following this struct
/// (starting at byte offset 104: 8 discriminator + 96 struct fields).
/// Access them via the helpers in `utils.rs`.
///
/// The account starts at 262,248 bytes and grows by 10,240 bytes per `resize_registry` call.
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct TicketRegistry {
    /// Pool ID this ticket registry belongs to.
    pub pool_id: u32,
    /// Current user entry capacity — derived from account data_len() at init and each resize.
    pub capacity: u32,
    /// Total number of users registered in the pool.
    pub user_count: u32,
    /// Total active tickets owned by all users (participates in current drawing).
    pub total_active_tickets: u32,
    /// Total pending tickets owned by all users (purchased during the current cycle, participates next cycle).
    pub total_pending_tickets: u32,
    /// The ID of the draw cycle currently being processed or the last completed cycle.
    pub draw_cycle_id: u32,
    /// Counter to keep track of draw preparation progress across batched crank transactions.
    pub draw_prepared_up_to: u32,
    /// Schema version of the struct.
    pub version: u8,
    /// Explicit padding to ensure 8-byte alignment for reserved space (3 bytes: 29..32).
    pub _padding: [u8; 3],
    /// Reserved space for future upgrades (64 bytes: 32..96, 96 bytes struct size total).
    pub _reserved: [u8; 64],
}

impl TicketRegistry {
    /// Current schema version of the TicketRegistry account.
    pub const CURRENT_VERSION: u8 = 1;

    /// Read-only version check to guard against unsupported account versions.
    pub fn check_version(&self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        Ok(())
    }

    /// Lazily migrates this account to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        self.check_version()?;
        if self.version < Self::CURRENT_VERSION {
            // Future schema migrations will be handled here.
            self.version = Self::CURRENT_VERSION;
        }
        Ok(())
    }

    /// Validates that the registry has remaining user slot capacity.
    /// Caller is responsible for version checks.
    #[inline]
    pub fn validate_can_add_user(&self) -> Result<()> {
        require!(
            self.user_count < self.capacity,
            PremiumBondsError::RegistryFull
        );
        Ok(())
    }

    /// Validates pre-CPI conditions for purchasing bonds.
    #[inline]
    pub fn validate_buy_bonds(&self, needs_slot: bool, bonds_to_buy: u32) -> Result<()> {
        self.check_version()?;
        if needs_slot {
            self.validate_can_add_user()?;
        }
        self.total_pending_tickets
            .checked_add(bonds_to_buy)
            .ok_or(PremiumBondsError::MathOverflow)?;
        Ok(())
    }
}

/// Zero-copy representation of a user's ticket balance in the TicketRegistry.
#[zero_copy(unsafe)]
#[repr(C)]
#[derive(Debug, Default)]
pub struct UserEntry {
    /// The owner's public key.
    pub owner: Pubkey,
    /// Number of active tickets owned (eligible for the current draw).
    pub active: u32,
    /// Number of pending tickets owned (purchased in the current cycle, merges in the next cycle).
    pub pending: u32,
    /// The draw cycle ID when pending tickets were last merged into active.
    pub merged_through_cycle: u32,
    /// Cumulative active tickets offset used for binary search draw winner resolution.
    pub cumulative_active: u32,
    /// Schema version of the struct.
    pub version: u8,
    /// Explicit padding to ensure 4-byte alignment for reserved space (3 bytes: 49..52).
    pub _padding: [u8; 3],
    /// Reserved space for future upgrades (12 bytes: 52..64, 64 bytes struct size total).
    pub _reserved: [u8; 12],
}

impl UserEntry {
    /// Current schema version of the UserEntry struct.
    pub const CURRENT_VERSION: u8 = 1;

    /// Lazily migrates this entry to the current schema version and guards against invalid versions.
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

    /// Merges any pending tickets into active tickets if they belong to a past cycle.
    ///
    /// This is called lazily on user actions (e.g. buying or selling bonds)
    /// to ensure ticket balances are up to date for the current cycle.
    pub fn lazy_merge(&mut self, current_cycle_id: u32) -> Result<()> {
        self.ensure_current_version()?;
        if self.merged_through_cycle < current_cycle_id {
            self.active = self
                .active
                .checked_add(self.pending)
                .ok_or(error!(crate::error::PremiumBondsError::MathOverflow))?;
            self.pending = 0;
            self.merged_through_cycle = current_cycle_id;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_registry(capacity: u32, user_count: u32, pending: u32) -> TicketRegistry {
        TicketRegistry {
            pool_id: 1,
            capacity,
            user_count,
            total_active_tickets: 0,
            total_pending_tickets: pending,
            draw_cycle_id: 1,
            draw_prepared_up_to: 0,
            version: TicketRegistry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 64],
        }
    }

    #[test]
    fn test_validate_can_add_user_success() {
        let reg = sample_registry(10, 9, 0);
        assert!(reg.validate_can_add_user().is_ok());
    }

    #[test]
    fn test_validate_can_add_user_full() {
        let reg = sample_registry(10, 10, 0);
        assert_eq!(
            reg.validate_can_add_user().unwrap_err(),
            PremiumBondsError::RegistryFull.into()
        );
    }

    #[test]
    fn test_validate_buy_bonds_new_user_success() {
        let reg = sample_registry(10, 9, 5);
        assert!(reg.validate_buy_bonds(true, 5).is_ok());
    }

    #[test]
    fn test_validate_buy_bonds_new_user_fails_capacity() {
        let reg = sample_registry(10, 10, 5);
        assert_eq!(
            reg.validate_buy_bonds(true, 5).unwrap_err(),
            PremiumBondsError::RegistryFull.into()
        );
    }

    #[test]
    fn test_validate_buy_bonds_existing_user_succeeds_at_capacity() {
        let reg = sample_registry(10, 10, 5);
        assert!(reg.validate_buy_bonds(false, 5).is_ok());
    }

    #[test]
    fn test_validate_buy_bonds_pending_overflow() {
        let reg = sample_registry(10, 5, u32::MAX - 2);
        assert_eq!(
            reg.validate_buy_bonds(false, 3).unwrap_err(),
            PremiumBondsError::MathOverflow.into()
        );
    }

    #[test]
    fn test_validate_buy_bonds_unsupported_version() {
        let mut reg = sample_registry(10, 5, 0);
        reg.version = TicketRegistry::CURRENT_VERSION + 1;
        assert_eq!(
            reg.validate_buy_bonds(false, 1).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );
    }
}

