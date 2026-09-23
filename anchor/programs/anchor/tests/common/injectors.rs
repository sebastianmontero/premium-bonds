use {
    crate::common::{constants::*, pda::*},
    anchor_lang::{AccountSerialize, AnchorSerialize, Discriminator, Space},
    anchor_spl::token::spl_token::state::{Account as SplAccount, Mint as SplMint},
    litesvm::LiteSVM,
    solana_program::{program_pack::Pack, pubkey::Pubkey},
    solana_sdk::account::Account,
};

// ─── Zero Account & Byte Writers ─────────────────────────────────────────────

pub fn inject_zero_account(svm: &mut LiteSVM, address: Pubkey, size: usize) {
    let rent = svm.minimum_balance_for_rent_exemption(size);
    svm.set_account(
        address,
        Account {
            lamports: rent,
            data: vec![0u8; size],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn write_registry_entry(
    svm: &mut LiteSVM,
    address: Pubkey,
    idx: usize,
    entry: &anchor::state::UserEntry,
) {
    let mut acc = svm
        .get_account(&address)
        .expect("Ticket registry account must exist");
    anchor::utils::registry_set_entry(&mut acc.data, idx, entry);
    svm.set_account(address, acc)
        .expect("Failed to write registry entry to LiteSVM");
}

// ─── Token & Mint Injectors ──────────────────────────────────────────────────

pub fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    inject_mint_with_supply(svm, address, decimals, 0);
}

pub fn inject_mint_with_supply(svm: &mut LiteSVM, address: Pubkey, decimals: u8, supply: u64) {
    let mint_state = SplMint {
        mint_authority: solana_program::program_option::COption::None,
        supply,
        decimals,
        is_initialized: true,
        freeze_authority: solana_program::program_option::COption::None,
    };
    let mut data = vec![0u8; SplMint::get_packed_len()];
    Pack::pack_into_slice(&mint_state, &mut data);

    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_mint_with_authority_and_supply(
    svm: &mut LiteSVM,
    address: Pubkey,
    authority: Pubkey,
    decimals: u8,
    supply: u64,
) {
    let mint_state = SplMint {
        mint_authority: solana_program::program_option::COption::Some(authority),
        supply,
        decimals,
        is_initialized: true,
        freeze_authority: solana_program::program_option::COption::None,
    };
    let mut data = vec![0u8; SplMint::get_packed_len()];
    Pack::pack_into_slice(&mint_state, &mut data);

    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_token_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let token_state = SplAccount {
        mint,
        owner,
        amount,
        delegate: solana_program::program_option::COption::None,
        state: anchor_spl::token::spl_token::state::AccountState::Initialized,
        is_native: solana_program::program_option::COption::None,
        delegated_amount: 0,
        close_authority: solana_program::program_option::COption::None,
    };
    let mut data = vec![0u8; SplAccount::get_packed_len()];
    Pack::pack_into_slice(&token_state, &mut data);

    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ─── Protocol Account Injectors ──────────────────────────────────────────────

pub fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
) -> Pubkey {
    inject_pool_with_huma_state(
        svm,
        pool_id,
        token_mint,
        ticket_registry,
        status,
        is_frozen,
        Pubkey::default(),
    )
}

pub fn inject_pool_with_huma_state(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
    huma_pool_state: Pubkey,
) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry,
        fee_wallet: Pubkey::default(),
        huma_pool_state,
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: status as u8,
        total_deposited_principal: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        current_cycle_end_at: i64::MAX,
        is_frozen_for_draw: if is_frozen { 1 } else { 0 },
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier {
            num_winners: 0,
            basis_points: 0,
            _padding: [0, 0],
        }; 10],
        prize_tiers_count: 0,
        _padding: [0; 3],
        version: anchor::PrizePool::CURRENT_VERSION,
        _reserved: [0; 128],
    };

    let mut data = vec![];
    data.extend_from_slice(anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));

    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    pda
}

pub fn default_draw_cycle(
    pool_id: u32,
    cycle_id: u32,
    status: anchor::DrawStatus,
) -> anchor::DrawCycle {
    let now = 1_700_000_000;
    anchor::DrawCycle {
        prize_pot: 100_000_000,
        cycle_fee_collected: 0,
        harvest_slot: 100,
        initiated_at: now,
        completed_at: match status {
            anchor::DrawStatus::Complete
            | anchor::DrawStatus::Skipped
            | anchor::DrawStatus::ForceUnlocked
            | anchor::DrawStatus::Voided
            | anchor::DrawStatus::HaltedInsolvent
            | anchor::DrawStatus::HaltedYieldSpike => now,
            _ => 0,
        },
        randomness_account: Pubkey::default(),
        pool_id,
        cycle_id,
        locked_ticket_count: 100,
        status,
        version: anchor::DrawCycle::CURRENT_VERSION,
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    }
}

pub fn inject_draw_cycle(
    svm: &mut LiteSVM,
    pool_id: u32,
    cycle_id: u32,
    draw_cycle: &anchor::DrawCycle,
) -> Pubkey {
    let (pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let mut d = vec![];
    draw_cycle.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::DrawCycle::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

pub fn inject_huma_pool_state(svm: &mut LiteSVM, address: Pubkey) {
    inject_huma_pool_state_with_assets(svm, address, 0);
}

pub fn inject_huma_pool_state_with_assets(svm: &mut LiteSVM, address: Pubkey, total_assets: u128) {
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
    huma_pool_state_data[30..46].copy_from_slice(&total_assets.to_le_bytes()); // assets field
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: huma_pool_state_data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_dummy_huma_account(svm: &mut LiteSVM, address: Pubkey) {
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 100],
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_mock_randomness_account(svm: &mut LiteSVM, address: Pubkey) {
    inject_randomness_account_data(svm, address, 0, 0, [0u8; 32]);
}

pub fn inject_randomness_account_data(
    svm: &mut LiteSVM,
    address: Pubkey,
    seed_slot: u64,
    reveal_slot: u64,
    value: [u8; 32],
) {
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);
    inject_randomness_account_data_with_owner(
        svm,
        address,
        seed_slot,
        reveal_slot,
        value,
        owner_pubkey,
    );
}

pub fn inject_randomness_account_data_with_owner(
    svm: &mut LiteSVM,
    address: Pubkey,
    seed_slot: u64,
    reveal_slot: u64,
    value: [u8; 32],
    owner: Pubkey,
) {
    let mut data = vec![0u8; anchor::constants::SWITCHBOARD_RANDOMNESS_MIN_DATA_LEN];
    data[0..8].copy_from_slice(&anchor::constants::SWITCHBOARD_RANDOMNESS_DISCRIMINATOR);
    let mut randomness_data: switchboard_on_demand::accounts::RandomnessAccountData =
        bytemuck::Zeroable::zeroed();
    randomness_data.authority = solana_program_v2::pubkey::Pubkey::default();
    randomness_data.queue = solana_program_v2::pubkey::Pubkey::default();
    randomness_data.seed_slothash = [0u8; 32];
    randomness_data.seed_slot = seed_slot;
    randomness_data.oracle = solana_program_v2::pubkey::Pubkey::default();
    randomness_data.reveal_slot = reveal_slot;
    randomness_data.value = value;

    let bytes: &[u8] = bytemuck::bytes_of(&randomness_data);
    data[8..8 + bytes.len()].copy_from_slice(bytes);

    let account = Account {
        lamports: 1_000_000_000,
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    };
    svm.set_account(address, account).unwrap();
}


pub fn inject_current_slot_randomness(svm: &mut LiteSVM, address: Pubkey, value: [u8; 32]) {
    let clock: solana_sdk::clock::Clock = svm.get_sysvar();
    inject_randomness_account_data(svm, address, clock.slot, clock.slot, value);
}

pub fn inject_payout_registry(
    svm: &mut LiteSVM,
    pool_id: u32,
    cycle_id: u32,
    winners: Vec<anchor::Winner>,
    payouts_completed: u32,
    status: anchor::PayoutRegistryStatus,
) -> Pubkey {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let count = winners.len();

    let pr = anchor::PayoutRegistry {
        pool_id,
        cycle_id,
        winners_count: count as u32,
        payouts_completed,
        revealed_at: 1_700_000_000,
        status: status as u8,
        version: anchor::PayoutRegistry::CURRENT_VERSION,
        _padding: [0; 6],
        _reserved: [0; 64],
    };

    let mut d = vec![];
    d.extend_from_slice(anchor::PayoutRegistry::DISCRIMINATOR);
    d.extend_from_slice(bytemuck::bytes_of(&pr));
    d.extend_from_slice(bytemuck::cast_slice(&winners));

    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

pub fn inject_lender_state(svm: &mut LiteSVM, address: Pubkey, amount: u64) {
    let mut data = vec![0u8; 16];
    data[8..16].copy_from_slice(&amount.to_le_bytes());
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_pending_redemption(
    svm: &mut LiteSVM,
    pool_id: u32,
    redemption_id: u64,
    user: Pubkey,
    amount: u64,
    pst_shares_locked: u64,
) -> Pubkey {
    let (pda, bump) = pending_redemption_pda(pool_id, redemption_id);
    inject_pending_redemption_with_params(
        svm,
        anchor::state::InitPendingRedemptionParams {
            pool_id,
            redemption_id,
            bump,
            user,
            amount,
            pst_shares_locked,
            huma_request_id: 0,
            requested_at: 0,
            redemption_type: anchor::state::RedemptionType::BondSale,
        },
    )
}

pub fn inject_pending_redemption_with_params(
    svm: &mut LiteSVM,
    params: anchor::state::InitPendingRedemptionParams,
) -> Pubkey {
    let (pda, _) = pending_redemption_pda(params.pool_id, params.redemption_id);
    let pending = anchor::state::PendingRedemption::new(params);
    let mut data = vec![];
    data.extend_from_slice(anchor::state::PendingRedemption::DISCRIMINATOR);
    pending.serialize(&mut data).unwrap();
    data.resize(8 + anchor::state::PendingRedemption::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

pub fn inject_user_winnings_with_index(
    svm: &mut LiteSVM,
    pool_id: u32,
    user: Pubkey,
    unclaimed: u64,
    total_claimed: u64,
    total_reinvested: u64,
    registry_entry_index: u32,
) {
    let (pda, bump) = user_winnings_pda(pool_id, &user);
    let uw = anchor::state::UserWinnings {
        pool_id,
        user,
        unclaimed_non_reinvested_winnings: unclaimed,
        total_claimed,
        total_reinvested,
        registry_entry_index,
        bump,
        version: anchor::state::UserWinnings::CURRENT_VERSION,
        _reserved: [0; 64],
    };
    let mut d = vec![];
    uw.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::state::UserWinnings::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_user_winnings(
    svm: &mut LiteSVM,
    pool_id: u32,
    user: Pubkey,
    unclaimed: u64,
    total_claimed: u64,
    total_reinvested: u64,
) {
    inject_user_winnings_with_index(
        svm,
        pool_id,
        user,
        unclaimed,
        total_claimed,
        total_reinvested,
        u32::MAX,
    );
}

pub fn inject_registry(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
) {
    inject_registry_with_tickets(svm, address, pool_id, capacity, active, pending, &[]);
}

pub fn inject_registry_with_state(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    draw_cycle_id: u32,
    draw_prepared_up_to: u32,
    entries: &[anchor::state::UserEntry],
) {
    inject_registry_with_state_and_size(
        svm,
        address,
        pool_id,
        capacity,
        draw_cycle_id,
        draw_prepared_up_to,
        entries,
        None,
    );
}

pub fn inject_registry_with_state_and_size(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    draw_cycle_id: u32,
    draw_prepared_up_to: u32,
    entries: &[anchor::state::UserEntry],
    custom_size: Option<usize>,
) {
    let user_count = entries.len() as u32;
    let mut total_active: u32 = 0;
    let mut total_pending: u32 = 0;
    for e in entries {
        total_active = total_active.wrapping_add(e.active);
        total_pending = total_pending.wrapping_add(e.pending);
    }

    let header = anchor::state::TicketRegistry {
        pool_id,
        capacity,
        user_count,
        total_active_tickets: total_active,
        total_pending_tickets: total_pending,
        draw_cycle_id,
        draw_prepared_up_to,
        version: anchor::state::TicketRegistry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 64],
    };

    let min_size = 8
        + std::mem::size_of::<anchor::state::TicketRegistry>()
        + (capacity as usize) * std::mem::size_of::<anchor::state::UserEntry>();
    let total_size = custom_size.unwrap_or(min_size);

    let mut data = vec![0u8; total_size];
    data[0..8].copy_from_slice(anchor::state::TicketRegistry::DISCRIMINATOR);
    data[8..104].copy_from_slice(bytemuck::bytes_of(&header));

    for (i, entry) in entries.iter().enumerate() {
        anchor::utils::registry_set_entry(&mut data, i, entry);
    }

    let rent_lamports = solana_sdk::rent::Rent::default().minimum_balance(total_size);
    svm.set_account(
        address,
        Account {
            lamports: rent_lamports,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

pub fn inject_registry_with_entries(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    entries: &[anchor::state::UserEntry],
) {
    inject_registry_with_state(svm, address, pool_id, capacity, 0, 0, entries);
}

pub fn inject_registry_with_tickets(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
    tickets: &[Pubkey],
) {
    let mut entries = Vec::new();
    for (idx, &owner) in tickets.iter().enumerate() {
        entries.push(anchor::state::UserEntry {
            owner,
            active: 1,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: (idx + 1) as u32,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        });
    }
    if tickets.is_empty() && (active > 0 || pending > 0) {
        entries.push(anchor::state::UserEntry {
            owner: Pubkey::new_unique(),
            active,
            pending,
            merged_through_cycle: 0,
            cumulative_active: active,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        });
    }
    let user_count = entries.len() as u32;
    inject_registry_with_state(svm, address, pool_id, capacity, 0, user_count, &entries);
}
