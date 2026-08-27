use anchor::error::PremiumBondsError;
use anchor_lang::{InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

mod common;
use common::*;

fn inject_zero_account(svm: &mut LiteSVM, address: Pubkey, size: usize) {
    svm.set_account(
        address,
        Account {
            lamports: 10_000_000_000,
            data: vec![0; size],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

struct TestContext {
    svm: LiteSVM,
    admin: Keypair,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    fee_wallet: Pubkey,
    ticket_registry: Pubkey,
}

fn setup_create_pool_context() -> TestContext {
    let (mut svm, admin) = setup_global_config();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    let fee_wallet = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();

    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);
    inject_token_account(&mut svm, fee_wallet, token_mint, fee_wallet, 0);

    // Inject the ticket registry with the minimum initial size
    inject_zero_account(
        &mut svm,
        ticket_registry,
        anchor::constants::REGISTRY_INITIAL_SIZE,
    );

    TestContext {
        svm,
        admin,
        token_mint,
        pst_mint,
        fee_wallet,
        ticket_registry,
    }
}

fn build_create_pool_ix(
    ctx: &TestContext,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
    min_yield_threshold: u64,
    max_yield_basis_points: u16,
    payout_timelock_seconds: u32,
) -> Instruction {
    build_create_pool_ix_with_tiers(
        ctx,
        pool_id,
        bond_price,
        stake_cycle_duration_hrs,
        fee_basis_points,
        min_yield_threshold,
        max_yield_basis_points,
        payout_timelock_seconds,
        default_prize_tiers(),
    )
}

fn build_create_pool_ix_with_tiers(
    ctx: &TestContext,
    pool_id: u32,
    bond_price: u64,
    stake_cycle_duration_hrs: i64,
    fee_basis_points: u16,
    min_yield_threshold: u64,
    max_yield_basis_points: u16,
    payout_timelock_seconds: u32,
    prize_tiers: Vec<anchor::PrizeTier>,
) -> Instruction {
    build_create_pool_instruction(
        &ctx.admin,
        pool_id,
        bond_price,
        stake_cycle_duration_hrs,
        fee_basis_points,
        min_yield_threshold,
        max_yield_basis_points,
        payout_timelock_seconds,
        prize_tiers,
        ctx.token_mint,
        ctx.pst_mint,
        ctx.ticket_registry,
        ctx.fee_wallet,
    )
}

#[test]
fn test_create_pool_succeeds() {
    let mut ctx = setup_create_pool_context();
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let meta = ctx.svm.send_transaction(tx).expect("create_pool should succeed");
    let event = assert_log_event::<anchor::events::PoolCreated>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.admin, ctx.admin.pubkey());
    assert_eq!(event.token_mint, ctx.token_mint);
    assert_eq!(event.pst_mint, ctx.pst_mint);
    assert_eq!(event.max_yield_basis_points, 0);
    assert_eq!(event.payout_timelock_seconds, 300);
    assert_eq!(event.tiers_count, 1);
    assert_eq!(event.total_winners, 1);

    let pool_state = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_state.total_prizes_distributed, 0);
    assert_eq!(pool_state.max_yield_basis_points, 0);
    assert_eq!(pool_state.payout_timelock_seconds, 300);
    assert_eq!(pool_state.prize_tiers_count, 1);
    assert_eq!(pool_state.prize_tiers[0], anchor::PrizeTier::default_single_winner());
}

#[test]
fn test_create_pool_with_custom_security_parameters_succeeds() {
    let mut ctx = setup_create_pool_context();
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 0, 500, 600);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let meta = ctx.svm.send_transaction(tx).expect("create_pool should succeed");
    let event = assert_log_event::<anchor::events::PoolCreated>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.max_yield_basis_points, 500);
    assert_eq!(event.payout_timelock_seconds, 600);

    let pool_state = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_state.max_yield_basis_points, 500);
    assert_eq!(pool_state.payout_timelock_seconds, 600);
}

#[test]
fn test_create_pool_boundary_values_succeed() {
    let mut ctx = setup_create_pool_context();
    // Boundary: max_yield_basis_points = 10_000 (100%), payout_timelock = 86_400 (24h)
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 10_000, 0, 10_000, 86_400);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let meta = ctx.svm.send_transaction(tx).expect("create_pool boundary should succeed");
    let event = assert_log_event::<anchor::events::PoolCreated>(&meta);
    assert_eq!(event.max_yield_basis_points, 10_000);
    assert_eq!(event.payout_timelock_seconds, 86_400);
}

#[test]
fn test_create_pool_fails_on_invalid_bond_price() {
    let mut ctx = setup_create_pool_context();
    // bond_price = 0 should fail
    let ix = build_create_pool_ix(&ctx, 1, 0, 24, 100, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidBondPrice);
}

#[test]
fn test_create_pool_fails_on_invalid_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = 0 should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 0, 100, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_create_pool_fails_on_negative_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = -24 should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, -24, 100, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_create_pool_fails_on_exceeds_max_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = 8761 (> MAX_STAKE_CYCLE_DURATION_HRS) should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 8761, 100, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_create_pool_fails_on_registry_too_small() {
    let mut ctx = setup_create_pool_context();

    // Inject a ticket registry that is too small
    let too_small_registry = Keypair::new().pubkey();
    inject_zero_account(
        &mut ctx.svm,
        too_small_registry,
        anchor::constants::REGISTRY_INITIAL_SIZE - 1,
    );
    ctx.ticket_registry = too_small_registry;

    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::RegistryTooSmall);
}

#[test]
fn test_create_pool_fails_on_unauthorized_admin() {
    let mut ctx = setup_create_pool_context();
    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let ix = build_create_pool_instruction(
        &hacker,
        1,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        ctx.token_mint,
        ctx.pst_mint,
        ctx.ticket_registry,
        ctx.fee_wallet,
    );

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&hacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&hacker]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_create_pool_fails_on_invalid_fee_config() {
    let mut ctx = setup_create_pool_context();
    // fee_basis_points = 10001 (exceeds 10000 / 100%) should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 10001, 0, 0, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidFeeConfig);
}

#[test]
fn test_create_pool_fails_on_invalid_max_yield_basis_points() {
    let mut ctx = setup_create_pool_context();
    // max_yield_basis_points = 10001 (exceeds 10000 / 100%) should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 0, 10_001, 300);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidMaxYieldBasisPoints);
}

#[test]
fn test_create_pool_fails_on_invalid_payout_timelock() {
    let mut ctx = setup_create_pool_context();
    // payout_timelock_seconds = 86401 (exceeds 86400 / 24h) should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 0, 0, 86_401);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidPayoutTimelock);
}

#[test]
fn test_create_pool_fails_on_empty_prize_tiers() {
    let mut ctx = setup_create_pool_context();
    let ix = build_create_pool_ix_with_tiers(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300, vec![]);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidPrizeTierConfig);
}

#[test]
fn test_create_pool_fails_on_exceeding_max_prize_tiers() {
    let mut ctx = setup_create_pool_context();
    let eleven_tiers = vec![anchor::PrizeTier::new(1, 909); 11];
    let ix = build_create_pool_ix_with_tiers(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300, eleven_tiers);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidPrizeTierConfig);
}

#[test]
fn test_create_pool_fails_on_invalid_basis_points_or_winners() {
    let mut ctx = setup_create_pool_context();

    // 0 winners
    let zero_winners = vec![anchor::PrizeTier::new(0, 10_000)];
    let ix1 = build_create_pool_ix_with_tiers(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300, zero_winners);
    let blockhash = ctx.svm.latest_blockhash();
    let msg1 = Message::new_with_blockhash(&[ix1], Some(&ctx.admin.pubkey()), &blockhash);
    let tx1 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg1), &[&ctx.admin]).unwrap();
    let res1 = ctx.svm.send_transaction(tx1);
    assert_custom_error(res1, PremiumBondsError::InvalidPrizeTierConfig);

    // 0 bps
    let zero_bps = vec![anchor::PrizeTier::new(1, 0)];
    let ix2 = build_create_pool_ix_with_tiers(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300, zero_bps);
    let msg2 = Message::new_with_blockhash(&[ix2], Some(&ctx.admin.pubkey()), &blockhash);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&ctx.admin]).unwrap();
    let res2 = ctx.svm.send_transaction(tx2);
    assert_custom_error(res2, PremiumBondsError::InvalidPrizeTierConfig);
}

#[test]
fn test_create_pool_fails_on_incorrect_total_basis_points() {
    let mut ctx = setup_create_pool_context();
    let bad_bps = vec![anchor::PrizeTier::new(1, 9999)];
    let ix = build_create_pool_ix_with_tiers(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300, bad_bps);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::BasisPointsMustEqual10000);
}

#[test]
fn test_create_pool_fails_on_exceeding_total_winners() {
    let mut ctx = setup_create_pool_context();
    let too_many_winners = vec![anchor::PrizeTier::new(51, 10_000)];
    let ix = build_create_pool_ix_with_tiers(&ctx, 1, 1_000_000, 24, 100, 0, 0, 300, too_many_winners);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidPrizeTierConfig);
}
