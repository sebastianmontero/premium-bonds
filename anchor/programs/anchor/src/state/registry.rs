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
    pub pool_id: u32,
    /// Current user entry capacity — derived from account data_len() at init and each resize.
    pub capacity: u32,
    pub user_count: u32,
    pub total_active_tickets: u32,
    pub total_pending_tickets: u32,
    pub draw_cycle_id: u32,
    pub draw_prepared_up_to: u32,
}

#[zero_copy(unsafe)]
#[repr(C)]
#[derive(Default)]
pub struct UserEntry {
    pub owner: Pubkey,             // 32 bytes
    pub active: u32,               // 4 bytes
    pub pending: u32,              // 4 bytes
    pub merged_through_cycle: u32, // 4 bytes — cycle ID when pending was merged
    pub cumulative_active: u32,    // 4 bytes — prefix sum built during prepare_draw
}

impl UserEntry {
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
