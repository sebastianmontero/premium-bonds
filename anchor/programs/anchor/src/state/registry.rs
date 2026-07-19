use anchor_lang::prelude::*;

/// Zero-copy header for the TicketRegistry account.
/// User entries are stored in the raw bytes immediately following this struct
/// (starting at byte offset 36: 8 discriminator + 28 struct fields).
/// Access them via the helpers in `utils.rs`.
///
/// The account starts at 196,644 bytes and grows by 10,080 bytes per `resize_registry` crank call.
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
}

/// Zero-copy representation of a user's ticket balance in the TicketRegistry.
#[zero_copy(unsafe)]
#[repr(C)]
#[derive(Default)]
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
}

impl UserEntry {
    /// Merges any pending tickets into active tickets if they belong to a past cycle.
    ///
    /// This is called lazily on user actions (e.g. buying or selling bonds)
    /// to ensure ticket balances are up to date for the current cycle.
    pub fn lazy_merge(&mut self, current_cycle_id: u32) -> Result<()> {
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
