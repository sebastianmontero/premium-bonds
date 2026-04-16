use std::convert::TryInto;
use anchor_lang::prelude::*;
use crate::error::PremiumBondsError;

/// Calculate a percentage fee from an amount based on basis points (1 basis point = 0.01%).
/// 10,000 basis points equals 100%.
pub fn calculate_percentage_fee(amount: u64, fee_basis_points: u16) -> u64 {
    (amount as u128)
        .checked_mul(fee_basis_points as u128)
        .unwrap()
        .checked_div(10000)
        .unwrap()
        .try_into()
        .unwrap()
}

/// Derive a deterministic random ticket index from a seed and contextual inputs.
/// Uses SHA-256 hashing to produce uniform entropy scoped per tier, winner slot, and cycle.
pub fn derive_random_index(
    seed: &[u8; 32],
    tier_idx: u32,
    winner_slot: u32,
    cycle_id: u32,
    ticket_count: u32,
) -> u64 {
    let hash = solana_program::hash::hashv(&[
        seed,
        &tier_idx.to_le_bytes(),
        &winner_slot.to_le_bytes(),
        &cycle_id.to_le_bytes(),
    ])
    .to_bytes();

    let mut buf = [0u8; 8];
    buf.copy_from_slice(&hash[0..8]);
    u64::from_le_bytes(buf) % (ticket_count as u64)
}

// ─── Registry raw-byte helpers ───────────────────────────────────────────────
//
// TicketRegistry accounts store ticket Pubkeys in the raw bytes that follow the
// 24-byte header (8 discriminator + 4 pool_id + 4 capacity + 4 active + 4 pending).
// All ticket reads/writes go through these helpers so the access pattern is
// centralised and independently testable.

/// Byte offset where ticket data begins.
pub const REGISTRY_HEADER_SIZE: usize = 24;
/// Size of one ticket slot (one Pubkey).
pub const PUBKEY_SIZE: usize = 32;

/// Read the ticket pubkey at `idx` from raw account data.
pub fn registry_get_ticket(data: &[u8], idx: usize) -> Pubkey {
    let start = REGISTRY_HEADER_SIZE + idx * PUBKEY_SIZE;
    Pubkey::try_from(&data[start..start + PUBKEY_SIZE]).unwrap()
}

/// Write `key` into the ticket slot at `idx` in raw account data.
pub fn registry_set_ticket(data: &mut [u8], idx: usize, key: &Pubkey) {
    let start = REGISTRY_HEADER_SIZE + idx * PUBKEY_SIZE;
    data[start..start + PUBKEY_SIZE].copy_from_slice(key.as_ref());
}

/// Derive the maximum ticket capacity from the raw account data length.
pub fn registry_capacity_from_len(data_len: usize) -> u32 {
    ((data_len.saturating_sub(REGISTRY_HEADER_SIZE)) / PUBKEY_SIZE) as u32
}

// ─── Swap-and-pop helpers ─────────────────────────────────────────────────────
//
// These implement the O(1) registry removal algorithm used by `sell_bonds`.
// Extracting them here keeps instruction handlers thin and enables unit testing
// without deploying to a validator.

/// O(1) swap-and-pop removal from the pending region.
///
/// `pending_indices` — relative pending-region indices, must be **strictly descending**.
/// Returns the new `pending_tickets_count` after all removals.
pub fn swap_and_pop_pending(
    data: &mut [u8],
    active_count: u32,
    pending_count: u32,
    pending_indices: &[u32],
    owner: &Pubkey,
) -> Result<u32> {
    let mut new_pending = pending_count;
    let mut last_pending_idx = pending_count;
    for &idx_raw in pending_indices {
        require!(idx_raw < last_pending_idx, PremiumBondsError::InvalidIndices);
        let real_idx = (active_count + idx_raw) as usize;
        require!(
            registry_get_ticket(data, real_idx) == *owner,
            PremiumBondsError::UnauthorizedTicket
        );
        let abs_last = (active_count + new_pending - 1) as usize;
        if real_idx != abs_last {
            let last_val = registry_get_ticket(data, abs_last);
            registry_set_ticket(data, real_idx, &last_val);
        }
        registry_set_ticket(data, abs_last, &Pubkey::default());
        new_pending -= 1;
        last_pending_idx = idx_raw;
    }
    Ok(new_pending)
}

/// O(1) swap-and-pop removal from the active region.
///
/// `active_indices` — absolute active-region indices, must be **strictly descending**.
/// `pending_count` — current pending count (already updated by `swap_and_pop_pending` if called first).
/// Returns `(new_active_count, new_pending_count)` after all removals.
pub fn swap_and_pop_active(
    data: &mut [u8],
    active_count: u32,
    pending_count: u32,
    active_indices: &[u32],
    owner: &Pubkey,
) -> Result<(u32, u32)> {
    let mut new_active = active_count;
    #[allow(unused_mut)] // actually mutated in loop body
    let mut new_pending = pending_count;
    let mut last_active_idx = active_count;
    for &idx in active_indices {
        require!(idx < last_active_idx, PremiumBondsError::InvalidIndices);
        let real_idx = idx as usize;
        require!(
            registry_get_ticket(data, real_idx) == *owner,
            PremiumBondsError::UnauthorizedTicket
        );
        let tail_active = (new_active - 1) as usize;
        let abs_last = (new_active + new_pending - 1) as usize;
        // Move tail active ticket into the deleted slot
        if real_idx != tail_active {
            let tail_val = registry_get_ticket(data, tail_active);
            registry_set_ticket(data, real_idx, &tail_val);
        }
        // Shift last pending ticket into the vacated tail-active slot (keeps layout contiguous)
        if new_pending > 0 {
            let last_val = registry_get_ticket(data, abs_last);
            registry_set_ticket(data, tail_active, &last_val);
        }
        registry_set_ticket(data, abs_last, &Pubkey::default());
        new_active -= 1;
        last_active_idx = idx;
    }
    Ok((new_active, new_pending))
}
