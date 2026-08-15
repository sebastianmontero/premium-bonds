//! Integration tests for the `resize_registry` instruction.
//!
//! Run with:
//!   NO_DNA=1 cargo test --package anchor --test test_resize_registry -- --nocapture

use {
    anchor_lang::{AccountSerialize, InstructionData, Space, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::account::Account,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

// ─── Test helpers ────────────────────────────────────────────────────────────

/// Setup the basic SVM environment with the program and an initialized GlobalConfig.
/// Sets the `crank` keypair as the authorized `jobs_account`.
fn setup_resize_registry_test() -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let payer = Keypair::new();

    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _) = global_config_pda();
    (svm, crank, payer, global_config)
}


/// Helper to inject a `TicketRegistry` account directly into the SVM.
fn inject_ticket_registry_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
    size: usize,
) {
    let mut data = vec![0u8; size];
    // Anchor discriminator for TicketRegistry
    data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]);
    data[8..12].copy_from_slice(&pool_id.to_le_bytes());
    data[12..16].copy_from_slice(&capacity.to_le_bytes());
    data[16..20].copy_from_slice(&1u32.to_le_bytes()); // user_count = 1
    data[20..24].copy_from_slice(&active.to_le_bytes()); // total_active_tickets
    data[24..28].copy_from_slice(&pending.to_le_bytes()); // total_pending_tickets
    data[28..32].copy_from_slice(&0u32.to_le_bytes()); // draw_cycle_id = 0
    data[32..36].copy_from_slice(&0u32.to_le_bytes()); // draw_prepared_up_to = 0

    svm.set_account(
        address,
        Account {
            lamports: svm.minimum_balance_for_rent_exemption(size),
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Helper to inject a `PrizePool` account directly into the SVM.
fn inject_prize_pool_account(
    svm: &mut LiteSVM,
    pool_id: u32,
    ticket_registry: Pubkey,
    is_frozen_for_draw: bool,
) -> Pubkey {
    use anchor_lang::Discriminator;
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint: Pubkey::default(),
        ticket_registry,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        status: anchor::PoolStatus::Active as u8,
        total_deposited_principal: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: if is_frozen_for_draw { 1 } else { 0 },
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10],
        prize_tiers_count: 0,
        _padding: [0; 1],
        version: 1,
        _reserved: [0; 128],
    };

    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
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

/// Helper to send `resize_registry` instruction.
fn send_resize_registry_simple(
    svm: &mut LiteSVM,
    crank: &Keypair,
    payer: &Keypair,
    pool_id: u32,
    ticket_registry: Pubkey,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let accounts = anchor::accounts::ResizeRegistry {
        crank: crank.pubkey(),
        payer: payer.pubkey(),
        global_config,
        pool,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[payer, crank]).unwrap();
    svm.send_transaction(tx)
}

fn read_registry_capacity(svm: &LiteSVM, address: Pubkey) -> u32 {
    let acct = svm.get_account(&address).expect("registry should exist");
    u32::from_le_bytes(acct.data[12..16].try_into().unwrap())
}

fn write_entry_at_idx(
    svm: &mut LiteSVM,
    address: Pubkey,
    idx: usize,
    entry: &anchor::state::UserEntry,
) {
    let mut acct = svm.get_account(&address).expect("registry should exist");
    anchor::utils::registry_set_entry(&mut acct.data, idx, entry);
    svm.set_account(address, acct).unwrap();
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy Path Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_resize_registry_succeeds() {
    let (mut svm, crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    let initial_capacity = anchor::utils::registry_capacity_from_len(initial_size);

    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        initial_capacity,
        2, // 2 active
        3, // 3 pending
        initial_size,
    );

    // Write a dummy entry to verify data preservation
    let entry_owner = Keypair::new().pubkey();
    let entry = anchor::state::UserEntry {
        owner: entry_owner,
        active: 2,
        pending: 3,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: 1,
        _reserved: [0; 15],
    };
    write_entry_at_idx(&mut svm, ticket_registry, 0, &entry);

    inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    let rent_before = svm.get_account(&ticket_registry).unwrap().lamports;

    let expected_new_size = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    let expected_new_capacity = anchor::utils::registry_capacity_from_len(expected_new_size);

    // Execute the resize
    let meta = send_resize_registry_simple(&mut svm, &crank, &payer, pool_id, ticket_registry).expect("Resize should succeed");
    let event = assert_log_event::<anchor::events::RegistryResized>(&meta);
    assert_eq!(event.pool_id, pool_id);
    assert_eq!(event.admin, crank.pubkey());
    assert_eq!(event.old_capacity, initial_capacity);
    assert_eq!(event.new_capacity, expected_new_capacity);

    let registry_acct = svm.get_account(&ticket_registry).unwrap();
    assert_eq!(registry_acct.data.len(), expected_new_size);

    // Verify double-sided rent flow: registry lamports should increase by exactly the rent difference
    let rent_diff = svm.minimum_balance_for_rent_exemption(expected_new_size)
        - svm.minimum_balance_for_rent_exemption(initial_size);
    assert_eq!(registry_acct.lamports, rent_before + rent_diff);

    // Verify capacity and other header fields in zero-copy state
    let expected_new_capacity = anchor::utils::registry_capacity_from_len(expected_new_size);
    assert_eq!(
        read_registry_capacity(&svm, ticket_registry),
        expected_new_capacity
    );
    assert_eq!(read_registry_pending(&svm, ticket_registry), 3);
    assert_eq!(read_registry_active(&svm, ticket_registry), 2);

    // Verify that the written entry was preserved
    let read_entry = read_registry_entry(&svm, ticket_registry, 0);
    assert_eq!(read_entry.owner, entry_owner);
    assert_eq!(read_entry.active, 2);
    assert_eq!(read_entry.pending, 3);
}

#[test]
fn test_resize_registry_sequential_growth() {
    let (mut svm, crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    let initial_capacity = anchor::utils::registry_capacity_from_len(initial_size);

    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        initial_capacity,
        0,
        0,
        initial_size,
    );

    inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Step 1: Resize once
    let res1 = send_resize_registry_simple(&mut svm, &crank, &payer, pool_id, ticket_registry);
    assert!(res1.is_ok());

    let size_1 = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    let cap_1 = anchor::utils::registry_capacity_from_len(size_1);
    assert_eq!(
        svm.get_account(&ticket_registry).unwrap().data.len(),
        size_1
    );
    assert_eq!(read_registry_capacity(&svm, ticket_registry), cap_1);

    // Step 2: Resize again sequentially
    // Since the instruction has no arguments and the same accounts, the transaction is identical.
    // We add a dummy transfer instruction to make the transaction message and signature unique.
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let accounts = anchor::accounts::ResizeRegistry {
        crank: crank.pubkey(),
        payer: payer.pubkey(),
        global_config,
        pool,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let resize_ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let dummy_dest = Pubkey::new_unique();
    let transfer_ix =
        anchor_lang::prelude::system_instruction::transfer(&payer.pubkey(), &dummy_dest, 1);

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[resize_ix, transfer_ix], Some(&payer.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &crank]).unwrap();
    let res2 = svm.send_transaction(tx);
    assert!(res2.is_ok());

    let size_2 = size_1 + anchor::constants::REGISTRY_REALLOC_STEP;
    let cap_2 = anchor::utils::registry_capacity_from_len(size_2);
    assert_eq!(
        svm.get_account(&ticket_registry).unwrap().data.len(),
        size_2
    );
    assert_eq!(read_registry_capacity(&svm, ticket_registry), cap_2);
}

// ═══════════════════════════════════════════════════════════════════════════
// Constraint and Error Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_resize_registry_fails_unauthorized_crank() {
    let (mut svm, _crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Hacker calls the instruction as crank
    let hacker = Keypair::new();
    svm.airdrop(&hacker.pubkey(), 1_000_000_000).unwrap();

    let res = send_resize_registry_simple(&mut svm, &hacker, &payer, pool_id, ticket_registry);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("UnauthorizedCrank"));
}

#[test]
fn test_resize_registry_fails_unsigned_crank() {
    let (mut svm, crank, payer, global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    let pool = inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Build ix but mark crank as non-signer
    let mut accounts = anchor::accounts::ResizeRegistry {
        crank: crank.pubkey(),
        payer: payer.pubkey(),
        global_config,
        pool,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    for meta in accounts.iter_mut() {
        if meta.pubkey == crank.pubkey() {
            meta.is_signer = false;
        }
    }

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    let res = svm.send_transaction(tx);

    assert!(res.is_err());
}

#[test]
fn test_resize_registry_fails_unsigned_payer() {
    let (mut svm, crank, payer, global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    let pool = inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Build ix but mark payer as non-signer
    let mut accounts = anchor::accounts::ResizeRegistry {
        crank: crank.pubkey(),
        payer: payer.pubkey(),
        global_config,
        pool,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    for meta in accounts.iter_mut() {
        if meta.pubkey == payer.pubkey() {
            meta.is_signer = false;
        }
    }

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);

    assert!(res.is_err());
}

#[test]
fn test_resize_registry_fails_wrong_global_config_pda() {
    let (mut svm, crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    let pool = inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Use a completely incorrect global config PDA
    let wrong_global_config = Keypair::new().pubkey();

    let accounts = anchor::accounts::ResizeRegistry {
        crank: crank.pubkey(),
        payer: payer.pubkey(),
        global_config: wrong_global_config,
        pool,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &crank]).unwrap();
    let res = svm.send_transaction(tx);

    assert!(res.is_err());
}

#[test]
fn test_resize_registry_fails_wrong_pool_pda() {
    let (mut svm, crank, payer, global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    let _pool = inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Use incorrect pool PDA
    let wrong_pool = Keypair::new().pubkey();

    let accounts = anchor::accounts::ResizeRegistry {
        crank: crank.pubkey(),
        payer: payer.pubkey(),
        global_config,
        pool: wrong_pool,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer, &crank]).unwrap();
    let res = svm.send_transaction(tx);

    assert!(res.is_err());
}

#[test]
fn test_resize_registry_fails_pool_frozen() {
    let (mut svm, crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    // Inject frozen pool
    inject_prize_pool_account(&mut svm, pool_id, ticket_registry, true);

    let res = send_resize_registry_simple(&mut svm, &crank, &payer, pool_id, ticket_registry);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("AwaitingRandomnessFreeze"));
}

#[test]
fn test_resize_registry_fails_unauthorized_ticket() {
    let (mut svm, crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );

    // Inject pool pointing to a completely different registry address
    let other_registry = Keypair::new().pubkey();
    inject_prize_pool_account(&mut svm, pool_id, other_registry, false);

    let res = send_resize_registry_simple(&mut svm, &crank, &payer, pool_id, ticket_registry);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("UnauthorizedTicket"));
}

#[test]
fn test_resize_registry_fails_registry_at_max_size() {
    let (mut svm, crank, payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    // Set to maximum size (10 MB)
    let max_size = anchor::constants::REGISTRY_MAX_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(max_size),
        0,
        0,
        max_size,
    );
    inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    let res = send_resize_registry_simple(&mut svm, &crank, &payer, pool_id, ticket_registry);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    // Since Anchor evaluates realloc before user constraints, growing beyond 10MB
    // fails at the Solana runtime system level with InvalidRealloc rather than RegistryAtMaxSize.
    assert!(err_str.contains("RegistryAtMaxSize") || err_str.contains("InvalidRealloc"));
}

#[test]
fn test_resize_registry_fails_payer_insufficient_funds() {
    let (mut svm, crank, _payer, _global_config) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    inject_prize_pool_account(&mut svm, pool_id, ticket_registry, false);

    // Create a payer with insufficient funds (0 lamports)
    let poor_payer = Keypair::new();

    let res = send_resize_registry_simple(&mut svm, &crank, &poor_payer, pool_id, ticket_registry);
    assert!(res.is_err());
    // Should fail with rent or signature/fee verification errors
}
