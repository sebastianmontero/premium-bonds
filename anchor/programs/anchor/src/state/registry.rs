use anchor_lang::prelude::*;

#[account(zero_copy(unsafe))]
#[repr(C)]
pub struct TicketRegistry {
    pub pool_id: u32,
    pub active_tickets_count: u32,
    pub pending_tickets_count: u32,
    pub tickets: [Pubkey; 327_680], // Massive zero-copy array
}
