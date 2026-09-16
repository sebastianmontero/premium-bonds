use {
    solana_program::pubkey::Pubkey,
    solana_sdk::signature::{Keypair, Signer},
};

/// Pre-computed deterministic nonces mapping seed[0..4] to winner ticket indices 0..29
/// with tier_idx=0, winner_slot=0, cycle_id=0, and ticket_count=30.
pub const DETERMINISTIC_WINNER_NONCES: [u32; 30] = [
    21, 29, 24, 62, 13, 97, 19, 2, 33, 11, // Indices 0..9 -> User 1
    55, 37, 15, 48, 22, 46, 9, 104, 39, 0, // Indices 10..19 -> User 3 (User 2 skipped!)
    6, 20, 1, 3, 56, 23, 31, 35, 12, 4, // Indices 20..29 -> User 3
];

pub const DETERMINISTIC_NONCES_0_TO_29: [u32; 30] = DETERMINISTIC_WINNER_NONCES;

pub fn deterministic_seed_for_index(target_index: usize) -> [u8; 32] {
    let mut seed = [0u8; 32];
    seed[0..4].copy_from_slice(&DETERMINISTIC_WINNER_NONCES[target_index].to_le_bytes());
    seed
}

pub fn create_test_ticket_owners(count: usize) -> Vec<Pubkey> {
    (0..count).map(|_| Keypair::new().pubkey()).collect()
}
