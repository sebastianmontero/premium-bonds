use {
    crate::common::pda::*, anchor_lang::AccountDeserialize, litesvm::LiteSVM,
    solana_program::pubkey::Pubkey,
};

// ─── State Readers ───────────────────────────────────────────────────────────

pub fn read_global_config(svm: &LiteSVM) -> anchor::GlobalConfig {
    let (pda, _) = global_config_pda();
    let account = svm
        .get_account(&pda)
        .expect("global_config account must exist");
    anchor::GlobalConfig::try_deserialize(&mut account.data.as_slice())
        .expect("account data should deserialize as GlobalConfig")
}

pub fn read_draw_cycle(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::DrawCycle {
    let (pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let account = svm
        .get_account(&pda)
        .expect("draw_cycle account must exist");
    anchor::DrawCycle::try_deserialize(&mut account.data.as_slice())
        .expect("account data should deserialize as DrawCycle")
}

pub fn read_draw_cycle_state(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::DrawCycle {
    read_draw_cycle(svm, pool_id, cycle_id)
}

pub fn read_pool_state(svm: &LiteSVM, pool_id: u32) -> anchor::PrizePool {
    let (pda, _) = pool_pda(pool_id);
    let acct = svm.get_account(&pda).expect("pool should exist");
    *bytemuck::from_bytes::<anchor::PrizePool>(
        &acct.data[8..8 + std::mem::size_of::<anchor::PrizePool>()],
    )
}

pub fn read_payout_registry(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::PayoutRegistry {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let acc = svm
        .get_account(&pda)
        .expect("payout registry account exists");
    *bytemuck::from_bytes::<anchor::PayoutRegistry>(
        &acc.data[8..8 + std::mem::size_of::<anchor::PayoutRegistry>()],
    )
}

pub fn read_payout_winners(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> Vec<anchor::Winner> {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let acc = svm
        .get_account(&pda)
        .expect("payout registry account exists");
    let pr = *bytemuck::from_bytes::<anchor::PayoutRegistry>(
        &acc.data[8..8 + std::mem::size_of::<anchor::PayoutRegistry>()],
    );
    let winners_bytes = &acc.data[8 + std::mem::size_of::<anchor::PayoutRegistry>()..];
    let winners = bytemuck::cast_slice::<u8, anchor::Winner>(winners_bytes);
    winners[..pr.winners_count as usize].to_vec()
}

pub fn read_pending_redemption(
    svm: &LiteSVM,
    pool_id: u32,
    redemption_id: u64,
) -> anchor::PendingRedemption {
    let (pda, _) = pending_redemption_pda(pool_id, redemption_id);
    let acct = svm
        .get_account(&pda)
        .expect("pending_redemption account should exist");
    anchor::PendingRedemption::try_deserialize(&mut &acct.data[..]).unwrap()
}

pub fn read_ticket_registry(svm: &LiteSVM, address: Pubkey) -> anchor::state::TicketRegistry {
    let acc = svm
        .get_account(&address)
        .expect("ticket registry account exists");
    *bytemuck::from_bytes::<anchor::state::TicketRegistry>(
        &acc.data[8..8 + std::mem::size_of::<anchor::state::TicketRegistry>()],
    )
}

pub fn read_ticket_registry_entries(
    svm: &LiteSVM,
    address: Pubkey,
) -> Vec<anchor::state::UserEntry> {
    let acc = svm
        .get_account(&address)
        .expect("ticket registry account exists");
    let header = read_ticket_registry(svm, address);
    let entries_bytes = &acc.data[8 + std::mem::size_of::<anchor::state::TicketRegistry>()..];
    let entries = bytemuck::cast_slice::<u8, anchor::state::UserEntry>(entries_bytes);
    entries[..header.user_count as usize].to_vec()
}

pub fn read_ticket_registry_entry(
    svm: &LiteSVM,
    registry: &Pubkey,
    idx: usize,
) -> anchor::state::UserEntry {
    let acct = svm.get_account(registry).expect("registry should exist");
    anchor::utils::registry_get_entry(&acct.data, idx).expect("valid registry entry")
}

pub fn read_user_winnings(
    svm: &LiteSVM,
    pool_id: u32,
    user: &Pubkey,
) -> anchor::state::UserWinnings {
    let (pda, _) = user_winnings_pda(pool_id, user);
    let acct = svm
        .get_account(&pda)
        .expect("user winnings account should exist");
    anchor::state::UserWinnings::try_deserialize(&mut &acct.data[..]).unwrap()
}

pub fn read_user_winnings_state(
    svm: &LiteSVM,
    pool_id: u32,
    user: &Pubkey,
) -> anchor::state::UserWinnings {
    read_user_winnings(svm, pool_id, user)
}

pub fn read_registry_pending(svm: &LiteSVM, address: Pubkey) -> u32 {
    read_ticket_registry(svm, address).total_pending_tickets
}

pub fn read_registry_active(svm: &LiteSVM, address: Pubkey) -> u32 {
    read_ticket_registry(svm, address).total_active_tickets
}

pub fn read_registry_user_count(svm: &LiteSVM, address: Pubkey) -> u32 {
    read_ticket_registry(svm, address).user_count
}

pub fn read_registry_entry(svm: &LiteSVM, address: Pubkey, idx: usize) -> anchor::state::UserEntry {
    read_ticket_registry_entry(svm, &address, idx)
}

pub fn read_mock_huma_pool_assets(svm: &LiteSVM, huma_pool_state: Pubkey) -> u128 {
    let acc = svm
        .get_account(&huma_pool_state)
        .expect("Huma pool state must exist");
    u128::from_le_bytes(acc.data[30..46].try_into().expect("Slice must be 16 bytes"))
}

pub fn read_mock_huma_mode_count(svm: &LiteSVM, huma_pool_state: Pubkey) -> u32 {
    let acc = svm
        .get_account(&huma_pool_state)
        .expect("Huma pool state must exist");
    u32::from_le_bytes(acc.data[26..30].try_into().expect("Slice must be 4 bytes"))
}
