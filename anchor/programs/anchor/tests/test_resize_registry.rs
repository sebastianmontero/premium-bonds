//! Integration tests for the `resize_registry` instruction.

use {
    anchor_lang::error::ErrorCode,
    anchor_lang::prelude::Pubkey,
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

// ─── Test helpers ────────────────────────────────────────────────────────────

/// Setup the basic SVM environment with the program and an initialized payer.
fn setup_resize_registry_test() -> (LiteSVM, Keypair) {
    let payer = Keypair::new();
    let svm = setup_svm_with_authority(&payer);
    (svm, payer)
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
    let entry = UserEntryTestBuilder::entry(Keypair::new().pubkey(), active, pending);
    inject_registry_with_state_and_size(
        svm,
        address,
        pool_id,
        capacity,
        0,
        0,
        &[entry],
        Some(size),
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy Path Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_resize_registry_succeeds() {
    let (mut svm, payer) = setup_resize_registry_test();
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
    let entry = UserEntryTestBuilder::entry(entry_owner, 2, 3);
    write_registry_entry(&mut svm, ticket_registry, 0, &entry);

    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let rent_before = svm.get_account(&ticket_registry).unwrap().lamports;

    let expected_new_size = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    let expected_new_capacity = anchor::utils::registry_capacity_from_len(expected_new_size);

    // Execute the resize
    let meta = ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey())
        .send(&mut svm, &payer)
        .expect("Resize should succeed");
    let event = assert_log_event::<anchor::events::RegistryResized>(&meta);
    assert_eq!(event.pool_id, pool_id);
    assert_eq!(event.caller, payer.pubkey());
    assert_eq!(event.old_capacity, initial_capacity);
    assert_eq!(event.new_capacity, expected_new_capacity);

    let registry_acct = svm.get_account(&ticket_registry).unwrap();
    assert_eq!(registry_acct.data.len(), expected_new_size);

    // Verify double-sided rent flow: registry lamports should increase by exactly the rent difference
    let rent_diff = svm.minimum_balance_for_rent_exemption(expected_new_size)
        - svm.minimum_balance_for_rent_exemption(initial_size);
    assert_eq!(registry_acct.lamports, rent_before + rent_diff);

    // Verify capacity and other header fields in zero-copy state
    assert_eq!(
        read_ticket_registry(&svm, ticket_registry).capacity,
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
    let (mut svm, payer) = setup_resize_registry_test();
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

    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    // Step 1: Resize once
    let res1 =
        ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).send(&mut svm, &payer);
    assert!(res1.is_ok(), "First resize should succeed: {:?}", res1);

    let size_1 = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    let cap_1 = anchor::utils::registry_capacity_from_len(size_1);
    assert_eq!(
        svm.get_account(&ticket_registry).unwrap().data.len(),
        size_1
    );
    assert_eq!(read_ticket_registry(&svm, ticket_registry).capacity, cap_1);

    // Step 2: Resize again sequentially
    let resize_ix = ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).build_ix();
    let dummy_dest = Pubkey::new_unique();
    let transfer_ix =
        anchor_lang::prelude::system_instruction::transfer(&payer.pubkey(), &dummy_dest, 1);

    let res2 = send_txs(&mut svm, &payer, &[], &[resize_ix, transfer_ix]);
    assert!(res2.is_ok(), "Second resize should succeed: {:?}", res2);

    let size_2 = size_1 + anchor::constants::REGISTRY_REALLOC_STEP;
    let cap_2 = anchor::utils::registry_capacity_from_len(size_2);
    assert_eq!(
        svm.get_account(&ticket_registry).unwrap().data.len(),
        size_2
    );
    assert_eq!(read_ticket_registry(&svm, ticket_registry).capacity, cap_2);
}

#[test]
fn test_resize_registry_permissionless_any_caller() {
    let (mut svm, _) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    // Any arbitrary user / third-party keypair can initiate and fund the resize
    let random_caller = Keypair::new();
    svm.airdrop(&random_caller.pubkey(), 10_000_000_000)
        .unwrap();

    let meta = ResizeRegistryBuilder::new(pool_id, ticket_registry, random_caller.pubkey())
        .send(&mut svm, &random_caller)
        .expect("Permissionless resize by arbitrary caller should succeed");

    let event = assert_log_event::<anchor::events::RegistryResized>(&meta);
    assert_eq!(event.pool_id, pool_id);
    assert_eq!(event.caller, random_caller.pubkey());
    assert_eq!(event.old_capacity, initial_capacity);
    assert_eq!(
        event.new_capacity,
        anchor::utils::registry_capacity_from_len(
            initial_size + anchor::constants::REGISTRY_REALLOC_STEP
        )
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Constraint and Error Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_resize_registry_fails_unsigned_payer() {
    let (mut svm, payer) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let ix = ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).build_ix();
    assert_signer_required_dynamic(&mut svm, ix, &payer.pubkey(), "resize_registry");
}

#[test]
fn test_resize_registry_fails_wrong_pool_pda() {
    let (mut svm, payer) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    // Use incorrect pool PDA
    let wrong_pool = Keypair::new().pubkey();

    let res = ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey())
        .with_pool(wrong_pool)
        .send(&mut svm, &payer);

    assert_anchor_error(res, ErrorCode::AccountOwnedByWrongProgram);
}

#[test]
fn test_resize_registry_fails_pool_frozen() {
    let (mut svm, payer) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_frozen(true)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let res =
        ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).send(&mut svm, &payer);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

#[test]
fn test_resize_registry_fails_unauthorized_ticket() {
    let (mut svm, payer) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(other_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let res =
        ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).send(&mut svm, &payer);
    assert_anchor_error(res, ErrorCode::ConstraintHasOne);
}

#[test]
fn test_resize_registry_fails_registry_at_max_size() {
    let (mut svm, payer) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let res =
        ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).send(&mut svm, &payer);
    // Since Anchor evaluates realloc before user constraints, growing beyond 10MB
    // fails at the Solana runtime system level with InvalidRealloc rather than RegistryAtMaxSize.
    assert_error_contains(res, &["RegistryAtMaxSize", "InvalidRealloc"]);
}

#[test]
fn test_resize_registry_fails_payer_insufficient_funds() {
    let (mut svm, _payer) = setup_resize_registry_test();
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
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    // Create a payer with insufficient funds (0 lamports)
    let poor_payer = Keypair::new();

    let res = ResizeRegistryBuilder::new(pool_id, ticket_registry, poor_payer.pubkey())
        .send(&mut svm, &poor_payer);
    assert_error_contains(res, &["AccountNotFound", "InsufficientFunds"]);
}

#[test]
fn test_resize_registry_to_exact_max_capacity() {
    let (mut svm, payer) = setup_resize_registry_test();
    let pool_id = 1;

    let ticket_registry = Keypair::new().pubkey();
    // Start at exactly the maximum resizeable size given Anchor's post-realloc constraint check
    let initial_size =
        anchor::constants::REGISTRY_MAX_SIZE - 2 * anchor::constants::REGISTRY_REALLOC_STEP;
    inject_ticket_registry_account(
        &mut svm,
        ticket_registry,
        pool_id,
        anchor::utils::registry_capacity_from_len(initial_size),
        0,
        0,
        initial_size,
    );
    PrizePoolTestBuilder::new(pool_id)
        .with_ticket_registry(ticket_registry)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    // This resize should grow by REGISTRY_REALLOC_STEP successfully
    let expected_new_size = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    let res =
        ResizeRegistryBuilder::new(pool_id, ticket_registry, payer.pubkey()).send(&mut svm, &payer);
    assert!(res.is_ok(), "Resize should succeed: {:?}", res);

    let reg_acc = svm.get_account(&ticket_registry).unwrap();
    assert_eq!(reg_acc.data.len(), expected_new_size);

    // Verify capacity was correctly updated in the header
    let header_capacity = read_ticket_registry(&svm, ticket_registry).capacity;
    assert_eq!(
        header_capacity,
        anchor::utils::registry_capacity_from_len(expected_new_size)
    );
}
