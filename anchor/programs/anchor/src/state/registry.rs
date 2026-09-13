use crate::error::PremiumBondsError;
use anchor_lang::prelude::*;

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

    /// Validates that a user entry index is strictly within current user count bounds.
    #[inline]
    pub fn validate_user_entry_index(&self, entry_index: u32) -> Result<()> {
        require!(
            entry_index < self.user_count,
            PremiumBondsError::InvalidUserEntryHint
        );
        Ok(())
    }
}

/// Zero-copy representation of a user's ticket balance in the TicketRegistry.
#[repr(C)]
#[derive(
    Copy,
    Clone,
    Debug,
    Default,
    PartialEq,
    Eq,
    AnchorSerialize,
    AnchorDeserialize,
    bytemuck::Pod,
    bytemuck::Zeroable,
)]
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

    /// Checks that the account version is supported.
    #[inline]
    pub fn check_version(&self) -> Result<()> {
        require!(
            self.version <= Self::CURRENT_VERSION,
            PremiumBondsError::UnsupportedAccountVersion
        );
        Ok(())
    }

    /// Lazily migrates this entry to the current schema version and guards against invalid versions.
    pub fn ensure_current_version(&mut self) -> Result<()> {
        self.check_version()?;
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

    /// Encapsulates cumulative active ticket calculation with overflow check for single-entry mutations.
    #[inline]
    pub fn update_cumulative(&mut self, prior_cumulative: u32) -> Result<u32> {
        let next = prior_cumulative
            .checked_add(self.active)
            .ok_or(error!(crate::error::PremiumBondsError::MathOverflow))?;
        self.cumulative_active = next;
        Ok(next)
    }
}

pub trait UserEntryBatchExt {
    /// Lazily merges pending tickets and accumulates cumulative active tickets across a contiguous slice.
    fn prepare_batch(&mut self, current_cycle_id: u32, initial_cumulative: u32) -> Result<u32>;
}

impl UserEntryBatchExt for [UserEntry] {
    fn prepare_batch(&mut self, current_cycle_id: u32, mut cumulative: u32) -> Result<u32> {
        for entry in self.iter_mut() {
            entry.lazy_merge(current_cycle_id)?;
            cumulative = cumulative
                .checked_add(entry.active)
                .ok_or(error!(crate::error::PremiumBondsError::MathOverflow))?;
            entry.cumulative_active = cumulative;
        }
        Ok(cumulative)
    }
}

/// Information about a user entry swapped into a vacated slot during swap-and-pop removal.
pub struct SwappedUserEntry {
    pub owner: Pubkey,
    pub old_index: u32,
    pub new_index: u32,
}

/// Result returned after debiting tickets from a user entry.
pub struct TicketDebitResult {
    pub remaining_bonds: u32,
    pub swapped_entry: Option<SwappedUserEntry>,
}

/// Result returned after preparing a batch of entries for a draw.
pub struct DrawBatchProgress {
    pub start: u32,
    pub end: u32,
    pub user_count: u32,
    pub final_cumulative: u32,
    pub is_complete: bool,
}

/// Zero-copy domain aggregate over the `TicketRegistry` header and its contiguous user entries.
pub struct TicketRegistryMut<'a> {
    pub header: &'a mut TicketRegistry,
    pub entries: &'a mut [UserEntry],
}

impl<'a> TicketRegistryMut<'a> {
    /// Read-only accessor for a user entry with two-tier validation.
    #[inline]
    pub fn get_entry(&self, index: u32) -> Result<&UserEntry> {
        require!(
            index < self.header.user_count,
            PremiumBondsError::InvalidUserEntryHint
        );
        let idx = index as usize;
        require!(
            idx < self.entries.len(),
            PremiumBondsError::InvalidRegistryState
        );
        Ok(&self.entries[idx])
    }

    /// Mutable accessor for a user entry with two-tier validation.
    #[inline]
    pub fn get_entry_mut(&mut self, index: u32) -> Result<&mut UserEntry> {
        require!(
            index < self.header.user_count,
            PremiumBondsError::InvalidUserEntryHint
        );
        let idx = index as usize;
        require!(
            idx < self.entries.len(),
            PremiumBondsError::InvalidRegistryState
        );
        Ok(&mut self.entries[idx])
    }

    /// Credits tickets to a new or existing user slot.
    /// Used by `buy_bonds` (as_active = false) and `reinvest_winnings` (as_active = true).
    pub fn credit_tickets(
        &mut self,
        slot_hint: Option<u32>,
        owner: Pubkey,
        bonds: u32,
        as_active: bool,
    ) -> Result<(u32, u32)> {
        self.header.ensure_current_version()?;
        let current_cycle = self.header.draw_cycle_id;

        if let Some(user_idx) = slot_hint {
            // Existing user slot top-up
            let total = {
                let user_count = self.header.user_count;
                require!(
                    user_idx < user_count,
                    PremiumBondsError::InvalidUserEntryHint
                );
                let idx = user_idx as usize;
                require!(
                    idx < self.entries.len(),
                    PremiumBondsError::InvalidRegistryState
                );
                let entry = &mut self.entries[idx];
                require!(entry.owner == owner, PremiumBondsError::InvalidUserEntryHint);
                entry.lazy_merge(current_cycle)?;

                if as_active {
                    entry.active = entry
                        .active
                        .checked_add(bonds)
                        .ok_or(PremiumBondsError::MathOverflow)?;
                } else {
                    entry.pending = entry
                        .pending
                        .checked_add(bonds)
                        .ok_or(PremiumBondsError::MathOverflow)?;
                }
                entry
                    .active
                    .checked_add(entry.pending)
                    .ok_or(PremiumBondsError::MathOverflow)?
            };

            if as_active {
                self.header.total_active_tickets = self
                    .header
                    .total_active_tickets
                    .checked_add(bonds)
                    .ok_or(PremiumBondsError::MathOverflow)?;
            } else {
                self.header.total_pending_tickets = self
                    .header
                    .total_pending_tickets
                    .checked_add(bonds)
                    .ok_or(PremiumBondsError::MathOverflow)?;
            }
            Ok((user_idx, total))
        } else {
            // New user slot allocation
            require!(
                self.header.user_count < self.header.capacity,
                PremiumBondsError::RegistryFull
            );
            let user_idx = self.header.user_count;
            let idx_usize = user_idx as usize;
            require!(
                idx_usize < self.entries.len(),
                PremiumBondsError::InvalidRegistryState
            );

            self.header.user_count = self
                .header
                .user_count
                .checked_add(1)
                .ok_or(PremiumBondsError::MathOverflow)?;

            if as_active {
                self.header.total_active_tickets = self
                    .header
                    .total_active_tickets
                    .checked_add(bonds)
                    .ok_or(PremiumBondsError::MathOverflow)?;
            } else {
                self.header.total_pending_tickets = self
                    .header
                    .total_pending_tickets
                    .checked_add(bonds)
                    .ok_or(PremiumBondsError::MathOverflow)?;
            }

            self.entries[idx_usize] = UserEntry {
                owner,
                active: if as_active { bonds } else { 0 },
                pending: if as_active { 0 } else { bonds },
                merged_through_cycle: current_cycle,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            };
            Ok((user_idx, bonds))
        }
    }

    /// Debits tickets from an existing user, performing lazy merge, balance deduction,
    /// and atomic swap-and-pop if the user fully exits.
    pub fn debit_tickets(
        &mut self,
        user_entry_idx: u32,
        expected_owner: Pubkey,
        active_to_sell: u32,
        pending_to_sell: u32,
    ) -> Result<TicketDebitResult> {
        self.header.ensure_current_version()?;
        let current_cycle = self.header.draw_cycle_id;
        let last_entry_idx = self
            .header
            .user_count
            .checked_sub(1)
            .ok_or(PremiumBondsError::InvalidUserEntryHint)?;

        let (will_exit, remaining_bonds) = {
            let user_count = self.header.user_count;
            require!(
                user_entry_idx < user_count,
                PremiumBondsError::InvalidUserEntryHint
            );
            let idx = user_entry_idx as usize;
            require!(
                idx < self.entries.len(),
                PremiumBondsError::InvalidRegistryState
            );
            let entry = &mut self.entries[idx];
            require!(
                entry.owner == expected_owner,
                PremiumBondsError::InvalidUserEntryHint
            );
            entry.lazy_merge(current_cycle)?;

            require!(
                entry.active >= active_to_sell,
                PremiumBondsError::InsufficientActiveTickets
            );
            require!(
                entry.pending >= pending_to_sell,
                PremiumBondsError::InsufficientPendingTickets
            );

            entry.active = entry
                .active
                .checked_sub(active_to_sell)
                .ok_or(PremiumBondsError::MathOverflow)?;
            entry.pending = entry
                .pending
                .checked_sub(pending_to_sell)
                .ok_or(PremiumBondsError::MathOverflow)?;

            let remaining = entry
                .active
                .checked_add(entry.pending)
                .ok_or(PremiumBondsError::MathOverflow)?;
            (entry.active == 0 && entry.pending == 0, remaining)
        };

        // Update global counters
        self.header.total_active_tickets = self
            .header
            .total_active_tickets
            .checked_sub(active_to_sell)
            .ok_or(PremiumBondsError::MathOverflow)?;
        self.header.total_pending_tickets = self
            .header
            .total_pending_tickets
            .checked_sub(pending_to_sell)
            .ok_or(PremiumBondsError::MathOverflow)?;

        if !will_exit {
            return Ok(TicketDebitResult {
                remaining_bonds,
                swapped_entry: None,
            });
        }

        // Handle swap-and-pop removal
        let mut swapped_entry = None;
        if user_entry_idx != last_entry_idx {
            let last_idx = last_entry_idx as usize;
            require!(
                last_idx < self.entries.len(),
                PremiumBondsError::InvalidRegistryState
            );
            let last_entry = self.entries[last_idx];
            swapped_entry = Some(SwappedUserEntry {
                owner: last_entry.owner,
                old_index: last_entry_idx,
                new_index: user_entry_idx,
            });
            self.entries[user_entry_idx as usize] = last_entry;
        }

        self.entries[last_entry_idx as usize] = UserEntry::default();
        self.header.user_count = self
            .header
            .user_count
            .checked_sub(1)
            .ok_or(PremiumBondsError::MathOverflow)?;

        Ok(TicketDebitResult {
            remaining_bonds: 0,
            swapped_entry,
        })
    }

    /// Prepares a contiguous batch of entries for winner selection.
    pub fn prepare_draw_batch(&mut self, batch_size: u32) -> Result<DrawBatchProgress> {
        self.header.ensure_current_version()?;
        let merge_cycle_id = self.header.draw_cycle_id.saturating_sub(1);
        let start = self.header.draw_prepared_up_to;
        let user_count = self.header.user_count;
        require!(start < user_count, PremiumBondsError::InvalidDrawState);

        let end = start.saturating_add(batch_size).min(user_count);
        let cumulative = if start == 0 {
            0
        } else {
            let prev_idx = (start - 1) as usize;
            require!(
                prev_idx < self.entries.len(),
                PremiumBondsError::InvalidRegistryState
            );
            self.entries[prev_idx].cumulative_active
        };

        let count = (end - start) as usize;
        let mut final_cumulative = cumulative;
        if count > 0 {
            let start_usize = start as usize;
            let end_usize = end as usize;
            require!(
                end_usize <= self.entries.len(),
                PremiumBondsError::InvalidRegistryState
            );
            let entries_slice = &mut self.entries[start_usize..end_usize];
            final_cumulative = entries_slice.prepare_batch(merge_cycle_id, cumulative)?;
        }

        self.header.draw_prepared_up_to = end;
        Ok(DrawBatchProgress {
            start,
            end,
            user_count,
            final_cumulative,
            is_complete: end >= user_count,
        })
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

    #[test]
    fn test_validate_user_entry_index_success() {
        let reg = sample_registry(10, 5, 0);
        assert!(reg.validate_user_entry_index(0).is_ok());
        assert!(reg.validate_user_entry_index(4).is_ok());
    }

    #[test]
    fn test_validate_user_entry_index_out_of_bounds() {
        let reg = sample_registry(10, 5, 0);
        assert_eq!(
            reg.validate_user_entry_index(5).unwrap_err(),
            PremiumBondsError::InvalidUserEntryHint.into()
        );
        assert_eq!(
            reg.validate_user_entry_index(10).unwrap_err(),
            PremiumBondsError::InvalidUserEntryHint.into()
        );
    }

    #[test]
    fn test_validate_user_entry_index_empty_registry() {
        let reg = sample_registry(10, 0, 0);
        assert_eq!(
            reg.validate_user_entry_index(0).unwrap_err(),
            PremiumBondsError::InvalidUserEntryHint.into()
        );
    }

    #[test]
    fn test_user_entry_batch_prepare_batch() {
        let mut entries = [
            UserEntry {
                owner: Pubkey::new_from_array([1; 32]),
                active: 10,
                pending: 5,
                merged_through_cycle: 0,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry {
                owner: Pubkey::new_from_array([2; 32]),
                active: 20,
                pending: 10,
                merged_through_cycle: 0,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
        ];

        let final_cumulative = entries.prepare_batch(1, 100).unwrap();
        assert_eq!(final_cumulative, 100 + 15 + 30);
        assert_eq!(entries[0].active, 15);
        assert_eq!(entries[0].pending, 0);
        assert_eq!(entries[0].cumulative_active, 115);
        assert_eq!(entries[1].active, 30);
        assert_eq!(entries[1].pending, 0);
        assert_eq!(entries[1].cumulative_active, 145);
    }

    #[test]
    fn test_user_entry_batch_overflow() {
        let mut entries = [
            UserEntry {
                owner: Pubkey::new_from_array([1; 32]),
                active: u32::MAX - 5,
                pending: 0,
                merged_through_cycle: 1,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry {
                owner: Pubkey::new_from_array([2; 32]),
                active: 10,
                pending: 0,
                merged_through_cycle: 1,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
        ];

        let err = entries.prepare_batch(1, 0).unwrap_err();
        assert_eq!(err, PremiumBondsError::MathOverflow.into());
    }

    #[test]
    fn test_ticket_registry_mut_credit_new_and_existing() {
        let mut header = sample_registry(5, 0, 0);
        let mut entries = vec![UserEntry::default(); 5];
        let owner_a = Pubkey::new_from_array([1; 32]);
        let owner_b = Pubkey::new_from_array([2; 32]);

        let mut reg_view = TicketRegistryMut {
            header: &mut header,
            entries: &mut entries,
        };

        // 1. Credit new user A as pending (buy_bonds style)
        let (idx_a, total_a) = reg_view.credit_tickets(None, owner_a, 10, false).unwrap();
        assert_eq!(idx_a, 0);
        assert_eq!(total_a, 10);
        assert_eq!(reg_view.header.user_count, 1);
        assert_eq!(reg_view.header.total_pending_tickets, 10);
        assert_eq!(reg_view.entries[0].pending, 10);
        assert_eq!(reg_view.entries[0].active, 0);

        // 2. Credit new user B as active (reinvest_winnings style)
        let (idx_b, total_b) = reg_view.credit_tickets(None, owner_b, 5, true).unwrap();
        assert_eq!(idx_b, 1);
        assert_eq!(total_b, 5);
        assert_eq!(reg_view.header.user_count, 2);
        assert_eq!(reg_view.header.total_active_tickets, 5);
        assert_eq!(reg_view.entries[1].active, 5);
        assert_eq!(reg_view.entries[1].pending, 0);

        // 3. Top-up existing user A with more pending
        let (idx_a_topup, total_a_topup) = reg_view.credit_tickets(Some(0), owner_a, 15, false).unwrap();
        assert_eq!(idx_a_topup, 0);
        assert_eq!(total_a_topup, 25);
        assert_eq!(reg_view.header.user_count, 2);
        assert_eq!(reg_view.header.total_pending_tickets, 25);
    }

    #[test]
    fn test_ticket_registry_mut_debit_partial_and_exit_swap_pop() {
        let mut header = sample_registry(5, 3, 0);
        header.total_active_tickets = 60;
        let owner_0 = Pubkey::new_from_array([1; 32]);
        let owner_1 = Pubkey::new_from_array([2; 32]);
        let owner_2 = Pubkey::new_from_array([3; 32]);

        let mut entries = vec![
            UserEntry {
                owner: owner_0,
                active: 10,
                pending: 0,
                merged_through_cycle: 1,
                cumulative_active: 10,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry {
                owner: owner_1,
                active: 20,
                pending: 0,
                merged_through_cycle: 1,
                cumulative_active: 30,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry {
                owner: owner_2,
                active: 30,
                pending: 0,
                merged_through_cycle: 1,
                cumulative_active: 60,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry::default(),
            UserEntry::default(),
        ];

        let mut reg_view = TicketRegistryMut {
            header: &mut header,
            entries: &mut entries,
        };

        // 1. Partial debit on user 1
        let res = reg_view.debit_tickets(1, owner_1, 5, 0).unwrap();
        assert_eq!(res.remaining_bonds, 15);
        assert!(res.swapped_entry.is_none());
        assert_eq!(reg_view.header.user_count, 3);
        assert_eq!(reg_view.header.total_active_tickets, 55);

        // 2. Full exit on user 0 (should swap last entry idx 2 into idx 0)
        let res_exit = reg_view.debit_tickets(0, owner_0, 10, 0).unwrap();
        assert_eq!(res_exit.remaining_bonds, 0);
        assert_eq!(reg_view.header.user_count, 2);
        assert_eq!(reg_view.header.total_active_tickets, 45);

        let swapped = res_exit.swapped_entry.unwrap();
        assert_eq!(swapped.owner, owner_2);
        assert_eq!(swapped.old_index, 2);
        assert_eq!(swapped.new_index, 0);

        // Verify index 0 now holds owner_2's entry, and index 2 is zeroed
        assert_eq!(reg_view.entries[0].owner, owner_2);
        assert_eq!(reg_view.entries[0].active, 30);
        assert_eq!(reg_view.entries[2].owner, Pubkey::default());
    }

    #[test]
    fn test_ticket_registry_mut_prepare_draw_batch() {
        let mut header = sample_registry(5, 3, 0);
        header.draw_cycle_id = 2; // entries merged_through_cycle = 1, so prepare_batch will merge past pending
        let mut entries = vec![
            UserEntry {
                owner: Pubkey::new_from_array([1; 32]),
                active: 10,
                pending: 5,
                merged_through_cycle: 0,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry {
                owner: Pubkey::new_from_array([2; 32]),
                active: 20,
                pending: 0,
                merged_through_cycle: 0,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry {
                owner: Pubkey::new_from_array([3; 32]),
                active: 30,
                pending: 10,
                merged_through_cycle: 0,
                cumulative_active: 0,
                version: UserEntry::CURRENT_VERSION,
                _padding: [0; 3],
                _reserved: [0; 12],
            },
            UserEntry::default(),
            UserEntry::default(),
        ];

        let mut reg_view = TicketRegistryMut {
            header: &mut header,
            entries: &mut entries,
        };

        // Batch 1: first 2 entries
        let progress1 = reg_view.prepare_draw_batch(2).unwrap();
        assert_eq!(progress1.start, 0);
        assert_eq!(progress1.end, 2);
        assert_eq!(progress1.final_cumulative, 35); // 15 (entry 0) + 20 (entry 1)
        assert!(!progress1.is_complete);
        assert_eq!(reg_view.header.draw_prepared_up_to, 2);

        // Batch 2: remaining 1 entry
        let progress2 = reg_view.prepare_draw_batch(2).unwrap();
        assert_eq!(progress2.start, 2);
        assert_eq!(progress2.end, 3);
        assert_eq!(progress2.final_cumulative, 75); // 35 + 40 (entry 2)
        assert!(progress2.is_complete);
        assert_eq!(reg_view.header.draw_prepared_up_to, 3);
    }
}
