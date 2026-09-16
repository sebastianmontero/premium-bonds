//! Integration tests for the `admin_void_payout_registry` instruction.
//!
//! Verifies:
//! 1. Successful voiding with exact subtraction of winner prizes (accounting for dust).
//! 2. Reversion of protocol fees.
//! 3. Rejection when payouts have already started (payouts_completed > 0).
//! 4. Rejection when draw is already voided.
//! 5. Rejection when protocol fees were already withdrawn.
//! 6. Rejection by unauthorized non-admin callers.

use {
    anchor::error::PremiumBondsError, anchor_lang::error::ErrorCode,
    anchor_lang::AccountDeserialize, litesvm::LiteSVM, solana_keypair::Keypair,
    solana_program::pubkey::Pubkey, solana_signer::Signer,
};

mod common;
use common::*;

#[test]
fn test_admin_void_payout_registry_success() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    let winner_amount = 49_999;
    let cycle_fee = 5_000;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 99_998, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(100_000)
        .with_cycle_fee(cycle_fee)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), winner_amount, 0);
    let winner2 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), winner_amount, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1, winner2],
        0, // 0 completed
        anchor::PayoutRegistryStatus::Active,
    );

    // Execute void
    let meta = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id)
        .expect("admin_void_payout_registry should succeed");

    let event = assert_cpi_event::<anchor::events::DrawVoided>(&meta);
    assert_eq!(event.pool_id, pool_id, "DrawVoided pool_id mismatch");
    assert_eq!(event.cycle_id, cycle_id, "DrawVoided cycle_id mismatch");
    assert_eq!(event.admin, admin.pubkey(), "DrawVoided admin mismatch");
    assert_eq!(
        event.prizes_reversed, 99_998,
        "DrawVoided prizes_reversed mismatch"
    );
    assert_eq!(
        event.fees_reversed, cycle_fee,
        "DrawVoided fees_reversed mismatch"
    );

    // Verify Pool accounting
    let pool = read_pool_state(&svm, pool_id);
    assert_eq!(
        pool.total_prizes_allocated, 0,
        "Prizes allocated should be rolled back to 0"
    );
    assert_eq!(
        pool.total_fees_accrued, 0,
        "Fees accrued should be rolled back to 0"
    );

    // Verify PayoutRegistry status
    let pr = read_payout_registry(&svm, pool_id, cycle_id);
    assert_eq!(
        pr.status,
        anchor::PayoutRegistryStatus::Voided as u8,
        "PayoutRegistry status must be Voided"
    );

    // Verify DrawCycle status
    let (dc_pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let dc_acc = svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Voided,
        "DrawCycle status must be Voided"
    );
    assert!(
        dc.completed_at > 0,
        "DrawCycle completed_at must be positive"
    );
}

#[test]
fn test_admin_void_fails_if_payouts_already_started() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(50_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let mut winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);
    winner1.processed = 1; // Already processed

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        1, // payouts_completed = 1
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::PayoutsAlreadyStarted);
}

#[test]
fn test_admin_void_fails_if_fees_already_withdrawn() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_fees_withdrawn(5_000) // All fees withdrawn!
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(50_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::FeesAlreadyWithdrawn);
}

#[test]
fn test_unauthorized_user_cannot_void_draw() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(50_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &attacker, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_admin_void_fails_if_pool_is_closed() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    send_close_pool(&mut svm, &admin, pool_id).expect("Close pool should succeed");

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(50_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::PoolClosed);
}

#[test]
fn test_multi_cycle_allocated_prizes_and_void_recovery() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let _ = PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    // Cycle 2 completes: adds 75_000 USDC
    mutate_pool_state(&mut svm, pool_id, |pool| {
        pool.total_prizes_allocated += 75_000;
        pool.total_fees_accrued += 7_500;
    });

    DrawCycleTestBuilder::new(pool_id, 2)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(75_000)
        .with_cycle_fee(7_500)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner_c2 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 75_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        2,
        vec![winner_c2],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    // Check pre-void state (total_prizes_allocated = 125_000)
    let pool = read_pool_state(&svm, pool_id);
    assert_eq!(
        pool.total_prizes_allocated, 125_000,
        "total_prizes_allocated pre-void mismatch"
    );

    // Admin voids Cycle 2 (reverses 75_000)
    send_admin_void_payout_registry(&mut svm, &admin, pool_id, 2)
        .expect("Voiding cycle 2 should succeed");

    // Check post-void state: rolled back to 50_000
    let pool_post_void = read_pool_state(&svm, pool_id);
    assert_eq!(
        pool_post_void.total_prizes_allocated, 50_000,
        "total_prizes_allocated post-void mismatch"
    );
    assert_eq!(
        pool_post_void.total_fees_accrued, 5_000,
        "total_fees_accrued post-void mismatch"
    );

    // Cycle 3 completes: adds 100_000 USDC
    mutate_pool_state(&mut svm, pool_id, |pool| {
        pool.total_prizes_allocated += 100_000;
        pool.total_fees_accrued += 10_000;
    });

    DrawCycleTestBuilder::new(pool_id, 3)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(100_000)
        .with_cycle_fee(10_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    // Check final state: total_prizes_allocated = 150_000
    let pool_final = read_pool_state(&svm, pool_id);
    assert_eq!(
        pool_final.total_prizes_allocated, 150_000,
        "total_prizes_allocated final mismatch"
    );
    assert_eq!(
        pool_final.total_fees_accrued, 15_000,
        "total_fees_accrued final mismatch"
    );
}

#[test]
fn test_admin_void_payout_registry_fails_invalid_event_authority() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    let _ = PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 100_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(100_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 100_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let fake_event_authority = Keypair::new().pubkey();

    let res = AdminVoidPayoutRegistryBuilder::new(admin.pubkey(), pool_id, cycle_id)
        .with_event_authority(fake_event_authority)
        .send(&mut svm, &admin);

    assert_anchor_error(res, ErrorCode::ConstraintSeeds);
}

#[test]
fn test_admin_void_fails_on_double_void_handler_guard() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    // Injects DrawCycle with Complete status, but PayoutRegistry with Voided status
    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(50_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner],
        0,
        anchor::PayoutRegistryStatus::Voided,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::DrawAlreadyVoided);
}

#[test]
fn test_admin_void_fails_on_sequential_second_call() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(50_000)
        .with_cycle_fee(5_000)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    // First void succeeds
    send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id)
        .expect("First admin_void_payout_registry must succeed");

    svm.expire_blockhash();

    // Second sequential void on the same accounts fails via account constraint (InvalidDrawStatus)
    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::InvalidDrawStatus);
}

// ─── Zero-Prize Void Tests ───────────────────────────────────────────────────

#[test]
fn test_admin_void_draw_with_zero_truncated_prize_succeeds_before_crank() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;
    let prize_pot = 100_000;
    let cycle_fee = 5_000;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 50_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(prize_pot)
        .with_cycle_fee(cycle_fee)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 50_000, 0);
    let winner2 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 0, 1);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1, winner2],
        0, // 0 completed
        anchor::PayoutRegistryStatus::Active,
    );

    // Execute void
    let meta = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id)
        .expect("admin_void_payout_registry should succeed");

    let event = assert_cpi_event::<anchor::events::DrawVoided>(&meta);
    assert_eq!(event.pool_id, pool_id, "DrawVoided pool_id mismatch");
    assert_eq!(event.cycle_id, cycle_id, "DrawVoided cycle_id mismatch");
    assert_eq!(event.admin, admin.pubkey(), "DrawVoided admin mismatch");
    assert_eq!(
        event.prizes_reversed, 50_000,
        "DrawVoided prizes_reversed mismatch"
    );
    assert_eq!(
        event.fees_reversed, cycle_fee,
        "DrawVoided fees_reversed mismatch"
    );

    // Verify Pool accounting
    let pool = read_pool_state(&svm, pool_id);
    assert_eq!(
        pool.total_prizes_allocated, 0,
        "total_prizes_allocated must be 0"
    );
    assert_eq!(pool.total_fees_accrued, 0, "total_fees_accrued must be 0");

    // Verify PayoutRegistry marked as Voided
    let pr = read_payout_registry(&svm, pool_id, cycle_id);
    assert_eq!(
        pr.status,
        anchor::PayoutRegistryStatus::Voided as u8,
        "PayoutRegistry status must be Voided"
    );

    // Verify DrawCycle marked as Voided
    let (dc_pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let dc_acc = svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Voided,
        "DrawCycle status must be Voided"
    );
    assert!(
        dc.completed_at > 0,
        "DrawCycle completed_at must be positive"
    );
}

#[test]
fn test_admin_void_100_percent_zero_truncated_draw_succeeds() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;
    let prize_pot = 5_000;
    let cycle_fee = 500;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 0, cycle_fee)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(prize_pot)
        .with_cycle_fee(cycle_fee)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 0, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let meta = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id)
        .expect("voiding 100% zero-truncated draw should succeed");

    let event = assert_cpi_event::<anchor::events::DrawVoided>(&meta);
    assert_eq!(
        event.prizes_reversed, 0,
        "DrawVoided prizes_reversed must be 0"
    );
    assert_eq!(
        event.fees_reversed, cycle_fee,
        "DrawVoided fees_reversed mismatch"
    );

    let pool = read_pool_state(&svm, pool_id);
    assert_eq!(
        pool.total_prizes_allocated, 0,
        "total_prizes_allocated must remain 0"
    );
    assert_eq!(
        pool.total_fees_accrued, 0,
        "total_fees_accrued must be rolled back to 0"
    );
}

#[test]
fn test_admin_void_fails_if_zero_prize_winner_already_cranked() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_solvency_state(0, 0, 500)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(5_000)
        .with_cycle_fee(500)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let mut winner = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), 0, 0);
    winner.processed = 1; // Already cranked!

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner],
        1, // payouts_completed = 1
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::PayoutsAlreadyStarted);
}

/// MTR-007: Admin Draw Void Complete Rollback Equivalence
/// Verifies: buy -> harvest -> prepare -> reveal -> void restores the complete BookValue
/// and individual liability fields (allocated prizes, distributed prizes, accrued fees)
/// while preserving physical token vault balances, cycle progression, and ticket maturation.
#[test]
fn test_mtr007_void_draw_complete_rollback_equivalence() {
    let mut ctx = setup_e2e();

    // User buys 10 bonds in Cycle 0 (10 pending tickets)
    send_e2e_buy_bonds(&mut ctx, 10).expect("buy bonds should succeed");

    // 1. Cycle 0 harvest matures pending tickets (10 pending -> 10 active) and advances pool to Cycle 1
    send_e2e_harvest_yield_and_commit(&mut ctx).expect("cycle 0 maturation harvest");

    // 2. Snapshot BookValue & constituent state BEFORE yield harvest in Cycle 1
    let pool_before = read_pool_state(&ctx.svm, 1);
    let book_value_before = pool_before.total_deposited_principal
        + (pool_before.total_fees_accrued - pool_before.total_fees_withdrawn)
        + pool_before.total_prizes_allocated;
    assert_eq!(
        pool_before.total_prizes_allocated, 0,
        "total_prizes_allocated before must be 0"
    );
    assert_eq!(
        pool_before.total_fees_accrued, 0,
        "total_fees_accrued before must be 0"
    );

    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let vault_usdc_before = read_token_balance(&ctx.svm, pool_vault);
    let vault_pst_before = read_token_balance(&ctx.svm, pool_pst_vault);

    // 3. Inject 5M USDC yield into Huma pool and harvest Cycle 1
    inject_huma_yield_ratio(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        15_000_000,
        10_000_000,
    );
    send_e2e_harvest_yield_and_commit(&mut ctx).expect("cycle 1 yield harvest");

    // 4. Prepare draw for Cycle 1
    send_e2e_prepare_draw(&mut ctx, 1, 1, 10).expect("prepare_draw should succeed");

    // 5. Inject resolved Switchboard Randomness into the EXACT account recorded by harvest in Cycle 1
    let (dc_pda, _) = draw_cycle_pda(1, 1);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();

    common::inject_randomness_account_data(
        &mut ctx.svm,
        dc.randomness_account,
        dc.harvest_slot,
        dc.harvest_slot,
        [42u8; 32],
    );

    // 6. Reveal and pick winners for Cycle 1
    send_e2e_reveal_and_pick_winners(&mut ctx, 1, 1, dc.randomness_account)
        .expect("reveal should succeed");

    // 7. Execute Admin Void for Cycle 1
    send_admin_void_payout_registry(&mut ctx.svm, &ctx.admin, 1, 1)
        .expect("admin_void_payout_registry should succeed");

    // 8. METAMORPHIC DEEP INVARIANT ASSERTIONS
    let pool_after = read_pool_state(&ctx.svm, 1);
    let book_value_after = pool_after.total_deposited_principal
        + (pool_after.total_fees_accrued - pool_after.total_fees_withdrawn)
        + pool_after.total_prizes_allocated;

    // [A] Complete Ledger Conservation
    assert_eq!(
        book_value_after, book_value_before,
        "MTR-007: BookValue not conserved after void"
    );
    assert_eq!(
        pool_after.total_deposited_principal, pool_before.total_deposited_principal,
        "Deposited principal must be conserved"
    );
    assert_eq!(
        pool_after.total_prizes_allocated, 0,
        "Prizes allocated must be 0 after void"
    );
    assert_eq!(
        pool_after.total_fees_accrued, 0,
        "Fees accrued must be 0 after void"
    );
    assert_eq!(
        pool_after.total_fees_withdrawn, 0,
        "Fees withdrawn must be 0"
    );

    // [B] Physical Vault Parity
    let vault_usdc_after = read_token_balance(&ctx.svm, pool_vault);
    let vault_pst_after = read_token_balance(&ctx.svm, pool_pst_vault);
    assert_eq!(
        vault_usdc_after, vault_usdc_before,
        "Physical USDC vault altered"
    );
    assert_eq!(
        vault_pst_after, vault_pst_before,
        "Physical PST vault altered"
    );

    // [C] State Transition Integrity
    assert_eq!(pool_after.is_frozen_for_draw, 0, "Pool must be unfrozen");
    assert_eq!(
        pool_after.current_draw_cycle_id, 2,
        "Draw cycle ID should advance to 2"
    );
}

/// INV-VOID-001 / INV-FREEZE-001: Defensive audit remediation (PB-SEC-02).
/// Attempting to void a payout registry while the pool is frozen must fail with AwaitingRandomnessFreeze.
/// Tests defensive isolation against future lifecycle regressions where pool state might remain frozen.
#[test]
fn test_admin_void_payout_registry_fails_when_frozen() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let cycle_id = 1;
    let prize_pot = 100_000;
    let winner_amount = 50_000;
    let cycle_fee = 5_000;

    PrizePoolTestBuilder::new(pool_id)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_solvency_state(0, 100_000, 5_000)
        .with_current_draw_cycle_id(1)
        .inject(&mut svm);

    DrawCycleTestBuilder::new(pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(prize_pot)
        .with_cycle_fee(cycle_fee)
        .with_locked_tickets(100)
        .inject(&mut svm);

    let winner1 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), winner_amount, 0);
    let winner2 = WinnerTestBuilder::default_winner(Keypair::new().pubkey(), winner_amount, 0);

    inject_payout_registry(
        &mut svm,
        pool_id,
        cycle_id,
        vec![winner1, winner2],
        0,
        anchor::PayoutRegistryStatus::Active,
    );

    let res = send_admin_void_payout_registry(&mut svm, &admin, pool_id, cycle_id);
    assert_custom_error(res, PremiumBondsError::AwaitingRandomnessFreeze);
}
