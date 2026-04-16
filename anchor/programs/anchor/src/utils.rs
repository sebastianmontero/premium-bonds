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

// ─── Unit Tests ──────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── Helpers ──────────────────────────────────────────────────────────────

    /// Build a zeroed registry buffer big enough to hold `capacity` ticket slots.
    fn make_data(capacity: usize) -> Vec<u8> {
        vec![0u8; REGISTRY_HEADER_SIZE + capacity * PUBKEY_SIZE]
    }

    /// Construct a deterministic non-default Pubkey from a seed byte.
    fn pk(seed: u8) -> Pubkey {
        Pubkey::new_from_array([seed; 32])
    }

    // ── calculate_percentage_fee ─────────────────────────────────────────────

    #[test]
    fn fee_zero_amount() {
        assert_eq!(calculate_percentage_fee(0, 500), 0);
    }

    #[test]
    fn fee_zero_bps() {
        assert_eq!(calculate_percentage_fee(1_000_000, 0), 0);
    }

    #[test]
    fn fee_full_100_percent() {
        // 10 000 bps == 100 %
        assert_eq!(calculate_percentage_fee(500, 10_000), 500);
    }

    #[test]
    fn fee_50_percent() {
        assert_eq!(calculate_percentage_fee(1_000, 5_000), 500);
    }

    #[test]
    fn fee_1_bps_rounds_down() {
        // 1 bps of 9_999 → 9_999 / 10_000 = 0 (integer truncation)
        assert_eq!(calculate_percentage_fee(9_999, 1), 0);
        // 1 bps of 10_000 → 1
        assert_eq!(calculate_percentage_fee(10_000, 1), 1);
    }

    #[test]
    fn fee_typical_protocol_fee() {
        // 250 bps (2.5%) of 1_000_000 lamports → 25_000
        assert_eq!(calculate_percentage_fee(1_000_000, 250), 25_000);
    }

    #[test]
    fn fee_large_amount() {
        // ensure no overflow for a large but realistic bond amount
        let amount: u64 = 1_000_000_000_000; // 1 trillion lamports
        let fee = calculate_percentage_fee(amount, 100); // 1 %
        assert_eq!(fee, 10_000_000_000);
    }

    #[test]
    fn fee_max_u64_with_1_bps() {
        // (u64::MAX as u128) * 1 / 10_000 must fit back in u64
        let amount = u64::MAX / 10_000; // keeps result within u64
        let fee = calculate_percentage_fee(amount, 1);
        assert_eq!(fee, amount / 10_000);
    }

    // ── derive_random_index ──────────────────────────────────────────────────

    const SEED_A: [u8; 32] = [1u8; 32];
    const SEED_B: [u8; 32] = [2u8; 32];

    #[test]
    fn random_index_in_range() {
        let ticket_count = 100u32;
        let idx = derive_random_index(&SEED_A, 0, 0, 0, ticket_count);
        assert!(idx < ticket_count as u64);
    }

    #[test]
    fn random_index_deterministic() {
        let a = derive_random_index(&SEED_A, 1, 2, 3, 50);
        let b = derive_random_index(&SEED_A, 1, 2, 3, 50);
        assert_eq!(a, b);
    }

    #[test]
    fn random_index_single_ticket() {
        // With ticket_count == 1 the only valid index is 0
        for tier in 0..5 {
            assert_eq!(derive_random_index(&SEED_A, tier, 10, 99, 1), 0);
        }
    }

    #[test]
    fn random_index_different_seeds_differ() {
        // Very unlikely (but not guaranteed) to collide over this many inputs
        let count = 1000u32;
        let a = derive_random_index(&SEED_A, 0, 0, 0, count);
        let b = derive_random_index(&SEED_B, 0, 0, 0, count);
        // Seeds differ → result should differ (statistically near-certain)
        assert_ne!(a, b);
    }

    #[test]
    fn random_index_different_tiers_differ() {
        let count = 10_000u32;
        let a = derive_random_index(&SEED_A, 0, 0, 0, count);
        let b = derive_random_index(&SEED_A, 1, 0, 0, count);
        assert_ne!(a, b);
    }

    #[test]
    fn random_index_different_winner_slots_differ() {
        let count = 10_000u32;
        let a = derive_random_index(&SEED_A, 0, 0, 0, count);
        let b = derive_random_index(&SEED_A, 0, 1, 0, count);
        assert_ne!(a, b);
    }

    #[test]
    fn random_index_different_cycles_differ() {
        let count = 10_000u32;
        let a = derive_random_index(&SEED_A, 0, 0, 1, count);
        let b = derive_random_index(&SEED_A, 0, 0, 2, count);
        assert_ne!(a, b);
    }

    // ── registry_capacity_from_len ───────────────────────────────────────────

    #[test]
    fn capacity_from_exact_header() {
        // No room for any tickets
        assert_eq!(registry_capacity_from_len(REGISTRY_HEADER_SIZE), 0);
    }

    #[test]
    fn capacity_from_zero() {
        // saturating_sub prevents underflow
        assert_eq!(registry_capacity_from_len(0), 0);
    }

    #[test]
    fn capacity_from_partial_slot() {
        // Bytes that don't form a full Pubkey are truncated
        let partial = REGISTRY_HEADER_SIZE + PUBKEY_SIZE - 1;
        assert_eq!(registry_capacity_from_len(partial), 0);
    }

    #[test]
    fn capacity_from_one_slot() {
        assert_eq!(registry_capacity_from_len(REGISTRY_HEADER_SIZE + PUBKEY_SIZE), 1);
    }

    #[test]
    fn capacity_from_many_slots() {
        let n = 500usize;
        assert_eq!(
            registry_capacity_from_len(REGISTRY_HEADER_SIZE + n * PUBKEY_SIZE),
            n as u32
        );
    }

    // ── registry_get_ticket / registry_set_ticket ────────────────────────────

    #[test]
    fn get_ticket_default_is_zero() {
        let data = make_data(5);
        assert_eq!(registry_get_ticket(&data, 0), Pubkey::default());
        assert_eq!(registry_get_ticket(&data, 4), Pubkey::default());
    }

    #[test]
    fn set_and_get_ticket_roundtrip() {
        let mut data = make_data(3);
        let key = pk(0xAB);
        registry_set_ticket(&mut data, 0, &key);
        assert_eq!(registry_get_ticket(&data, 0), key);
    }

    #[test]
    fn set_and_get_multiple_slots_independent() {
        let mut data = make_data(5);
        let keys: Vec<Pubkey> = (0u8..5).map(pk).collect();
        for (i, k) in keys.iter().enumerate() {
            registry_set_ticket(&mut data, i, k);
        }
        for (i, k) in keys.iter().enumerate() {
            assert_eq!(registry_get_ticket(&data, i), *k);
        }
    }

    #[test]
    fn set_overwrites_previous_value() {
        let mut data = make_data(2);
        registry_set_ticket(&mut data, 0, &pk(1));
        registry_set_ticket(&mut data, 0, &pk(2));
        assert_eq!(registry_get_ticket(&data, 0), pk(2));
    }

    #[test]
    fn slots_do_not_overlap() {
        let mut data = make_data(2);
        registry_set_ticket(&mut data, 0, &pk(0xAA));
        registry_set_ticket(&mut data, 1, &pk(0xBB));
        assert_eq!(registry_get_ticket(&data, 0), pk(0xAA));
        assert_eq!(registry_get_ticket(&data, 1), pk(0xBB));
    }

    // ── swap_and_pop_pending ─────────────────────────────────────────────────
    //
    // Registry layout used in these tests:
    //   slot 0..active_count  → active tickets
    //   slot active_count..   → pending tickets

    fn build_registry(active: &[Pubkey], pending: &[Pubkey]) -> Vec<u8> {
        let total = active.len() + pending.len();
        let mut data = make_data(total);
        for (i, k) in active.iter().enumerate() {
            registry_set_ticket(&mut data, i, k);
        }
        for (i, k) in pending.iter().enumerate() {
            registry_set_ticket(&mut data, active.len() + i, k);
        }
        data
    }

    #[test]
    fn pending_remove_only_ticket() {
        let owner = pk(0x01);
        let active_count = 0u32;
        let pending_count = 1u32;
        let mut data = build_registry(&[], &[owner]);

        let result = swap_and_pop_pending(&mut data, active_count, pending_count, &[0], &owner);
        assert_eq!(result.unwrap(), 0);
        // The slot must be zeroed out
        assert_eq!(registry_get_ticket(&data, 0), Pubkey::default());
    }

    #[test]
    fn pending_remove_last_index_no_swap() {
        // Removing the last element requires no swap
        let owner = pk(0x01);
        let other = pk(0x02);
        let active: &[Pubkey] = &[];
        let pending = [other, owner]; // idx 0 = other, idx 1 = owner
        let mut data = build_registry(active, &pending);

        let result = swap_and_pop_pending(&mut data, 0, 2, &[1], &owner);
        assert_eq!(result.unwrap(), 1);
        // idx 0 should be unchanged (other)
        assert_eq!(registry_get_ticket(&data, 0), other);
        // idx 1 should be cleared
        assert_eq!(registry_get_ticket(&data, 1), Pubkey::default());
    }

    #[test]
    fn pending_remove_first_swaps_with_tail() {
        // Removing the first pending elem: tail takes its place
        let owner = pk(0x01);
        let tail = pk(0x99);
        let mut data = build_registry(&[], &[owner, tail]);

        let result = swap_and_pop_pending(&mut data, 0, 2, &[0], &owner);
        assert_eq!(result.unwrap(), 1);
        // The tail moves to slot 0
        assert_eq!(registry_get_ticket(&data, 0), tail);
        // Slot 1 is cleared
        assert_eq!(registry_get_ticket(&data, 1), Pubkey::default());
    }

    #[test]
    fn pending_remove_multiple_descending() {
        let owner = pk(0x01);
        let other1 = pk(0x10);
        let _other2 = pk(0x20);
        // pending region: [owner, other1, owner] relative indices 0,1,2
        let mut data = build_registry(&[], &[owner, other1, owner]);

        // Remove indices 2 and 0 (strictly descending)
        let result = swap_and_pop_pending(&mut data, 0, 3, &[2, 0], &owner);
        assert_eq!(result.unwrap(), 1);
        // only other1 should remain
        assert_eq!(registry_get_ticket(&data, 0), other1);
    }

    #[test]
    fn pending_remove_with_active_offset() {
        // Ensure active_count shifts are applied
        let active_key = pk(0xAA);
        let owner = pk(0x01);
        let active = [active_key, active_key]; // 2 active slots
        let pending = [owner];
        let mut data = build_registry(&active, &pending);

        // pending slot 0 = absolute slot 2
        let result = swap_and_pop_pending(&mut data, 2, 1, &[0], &owner);
        assert_eq!(result.unwrap(), 0);
        // Active slots must be intact
        assert_eq!(registry_get_ticket(&data, 0), active_key);
        assert_eq!(registry_get_ticket(&data, 1), active_key);
    }

    #[test]
    fn pending_error_non_descending_indices() {
        let owner = pk(0x01);
        let mut data = build_registry(&[], &[owner, owner, owner]);
        // [0, 2] is ascending → must error
        let result = swap_and_pop_pending(&mut data, 0, 3, &[0, 2], &owner);
        assert!(result.is_err());
    }

    #[test]
    fn pending_error_duplicate_indices() {
        let owner = pk(0x01);
        let mut data = build_registry(&[], &[owner, owner]);
        // [1, 1] is not strictly descending → error
        let result = swap_and_pop_pending(&mut data, 0, 2, &[1, 1], &owner);
        assert!(result.is_err());
    }

    #[test]
    fn pending_error_wrong_owner() {
        let owner = pk(0x01);
        let other = pk(0x02);
        let mut data = build_registry(&[], &[other]); // slot belongs to `other`
        let result = swap_and_pop_pending(&mut data, 0, 1, &[0], &owner);
        assert!(result.is_err());
    }

    // ── swap_and_pop_active ──────────────────────────────────────────────────

    #[test]
    fn active_remove_only_ticket_no_pending() {
        let owner = pk(0x01);
        let mut data = build_registry(&[owner], &[]);

        let (new_active, new_pending) =
            swap_and_pop_active(&mut data, 1, 0, &[0], &owner).unwrap();
        assert_eq!(new_active, 0);
        assert_eq!(new_pending, 0);
        assert_eq!(registry_get_ticket(&data, 0), Pubkey::default());
    }

    #[test]
    fn active_remove_last_no_swap() {
        // Two actives; remove the last one (no swap needed within active region)
        let a0 = pk(0x10);
        let a1 = pk(0x01); // owner
        let mut data = build_registry(&[a0, a1], &[]);

        let (new_active, new_pending) =
            swap_and_pop_active(&mut data, 2, 0, &[1], &a1).unwrap();
        assert_eq!(new_active, 1);
        assert_eq!(new_pending, 0);
        assert_eq!(registry_get_ticket(&data, 0), a0);
        assert_eq!(registry_get_ticket(&data, 1), Pubkey::default());
    }

    #[test]
    fn active_remove_first_swaps_with_tail_active() {
        let owner = pk(0x01);
        let tail_active = pk(0x99);
        let mut data = build_registry(&[owner, tail_active], &[]);

        let (new_active, new_pending) =
            swap_and_pop_active(&mut data, 2, 0, &[0], &owner).unwrap();
        assert_eq!(new_active, 1);
        assert_eq!(new_pending, 0);
        // tail_active moves into slot 0
        assert_eq!(registry_get_ticket(&data, 0), tail_active);
        assert_eq!(registry_get_ticket(&data, 1), Pubkey::default());
    }

    #[test]
    fn active_remove_shifts_last_pending_into_tail_active() {
        // Layout: [active_owner, active_other | pending_last]
        // Remove active[0]; the tail active (slot 1) fills slot 0,
        // then the last pending (slot 2) fills the vacated slot 1.
        let owner = pk(0x01);
        let active_other = pk(0x02);
        let pending_last = pk(0x03);
        let mut data = build_registry(&[owner, active_other], &[pending_last]);

        let (new_active, new_pending) =
            swap_and_pop_active(&mut data, 2, 1, &[0], &owner).unwrap();
        assert_eq!(new_active, 1);
        assert_eq!(new_pending, 1);
        // active_other moved to slot 0
        assert_eq!(registry_get_ticket(&data, 0), active_other);
        // pending_last promoted to tail-active slot (slot 1)
        assert_eq!(registry_get_ticket(&data, 1), pending_last);
        // original pending slot (slot 2) cleared
        assert_eq!(registry_get_ticket(&data, 2), Pubkey::default());
    }

    #[test]
    fn active_remove_multiple_descending() {
        // Three active tickets all owned by `owner`; remove indices 2 and 0
        let owner = pk(0x01);
        let middle = pk(0x02);
        let mut data = build_registry(&[owner, middle, owner], &[]);

        let (new_active, new_pending) =
            swap_and_pop_active(&mut data, 3, 0, &[2, 0], &owner).unwrap();
        assert_eq!(new_active, 1);
        assert_eq!(new_pending, 0);
        // Only `middle` should remain at slot 0
        assert_eq!(registry_get_ticket(&data, 0), middle);
    }

    #[test]
    fn active_error_non_descending_indices() {
        let owner = pk(0x01);
        let mut data = build_registry(&[owner, owner, owner], &[]);
        // Ascending → error
        let result = swap_and_pop_active(&mut data, 3, 0, &[0, 2], &owner);
        assert!(result.is_err());
    }

    #[test]
    fn active_error_duplicate_indices() {
        let owner = pk(0x01);
        let mut data = build_registry(&[owner, owner], &[]);
        let result = swap_and_pop_active(&mut data, 2, 0, &[1, 1], &owner);
        assert!(result.is_err());
    }

    #[test]
    fn active_error_wrong_owner() {
        let owner = pk(0x01);
        let other = pk(0x02);
        let mut data = build_registry(&[other], &[]); // slot belongs to `other`
        let result = swap_and_pop_active(&mut data, 1, 0, &[0], &owner);
        assert!(result.is_err());
    }

    #[test]
    fn active_remove_all_with_pending_preserves_pending_count() {
        // Remove all 2 active tickets; pending count should stay at 3
        let owner = pk(0x01);
        let p0 = pk(0xA0);
        let p1 = pk(0xB0);
        let p2 = pk(0xC0);
        let mut data = build_registry(&[owner, owner], &[p0, p1, p2]);

        let (new_active, new_pending) =
            swap_and_pop_active(&mut data, 2, 3, &[1, 0], &owner).unwrap();
        assert_eq!(new_active, 0);
        assert_eq!(new_pending, 3);
    }
}
