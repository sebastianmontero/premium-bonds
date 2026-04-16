use anchor_lang::prelude::*;

/// Zero-copy header for the TicketRegistry account.
/// Ticket pubkeys are stored in the raw bytes immediately following this struct
/// (starting at byte offset 24: 8 discriminator + 16 struct fields).
/// Access them via the helpers in `utils.rs` (registry_get_ticket / registry_set_ticket).
///
/// The account starts at 128 KB and grows by 10 KB per `resize_registry` crank call.
#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct TicketRegistry {
    pub pool_id: u32,
    /// Current ticket slot capacity — derived from account data_len() at init and each resize.
    pub capacity: u32,
    pub active_tickets_count: u32,
    pub pending_tickets_count: u32,
}
