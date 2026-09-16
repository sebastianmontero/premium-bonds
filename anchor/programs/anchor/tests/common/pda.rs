use {
    crate::common::constants::*, anchor_lang::solana_program::bpf_loader_upgradeable,
    solana_program::pubkey::Pubkey,
};

// ─── PDA helpers ─────────────────────────────────────────────────────────────

pub fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

pub fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

pub fn pool_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

pub fn pool_pst_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_PST_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

pub fn user_winnings_pda(pool_id: u32, user: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            USER_WINNINGS_SEED,
            pool_id.to_le_bytes().as_ref(),
            user.as_ref(),
        ],
        &anchor::id(),
    )
}

pub fn pending_redemption_pda(pool_id: u32, redemption_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PENDING_REDEMPTION_SEED,
            pool_id.to_le_bytes().as_ref(),
            redemption_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

pub fn draw_cycle_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            DRAW_CYCLE_SEED,
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

pub fn payout_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PAYOUT_SEED,
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

pub fn huma_program_id() -> Pubkey {
    anchor::constants::HUMA_PROGRAM_ID
}

pub fn huma_pool_authority_pda(pool_state: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[HUMA_POOL_AUTHORITY_SEED, pool_state.as_ref()],
        &huma_program_id(),
    )
}

pub fn event_authority_pda() -> Pubkey {
    let (event_authority, _) = Pubkey::find_program_address(&[b"__event_authority"], &anchor::id());
    event_authority
}

pub fn program_data_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[anchor::id().as_ref()], &bpf_loader_upgradeable::id())
}

pub fn find_off_canonical_bump(seeds: &[&[u8]], program_id: &Pubkey) -> (Pubkey, u8) {
    let (_canonical_pda, canonical_bump) = Pubkey::find_program_address(seeds, program_id);
    assert!(
        canonical_bump > 0,
        "Canonical bump must be > 0 to find off-canonical PDA"
    );
    (0..canonical_bump)
        .rev()
        .find_map(|bump| {
            let mut full_seeds = seeds.to_vec();
            let bump_arr = [bump];
            full_seeds.push(&bump_arr);
            Pubkey::create_program_address(&full_seeds, program_id)
                .ok()
                .map(|pda| (pda, bump))
        })
        .expect("Failed to find valid off-canonical bump")
}
