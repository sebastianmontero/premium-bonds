use std::convert::TryInto;

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
