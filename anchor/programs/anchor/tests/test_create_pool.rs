use anchor::error::PremiumBondsError;
use litesvm::LiteSVM;
use solana_program::pubkey::Pubkey;
use solana_sdk::{signature::Keypair, signer::Signer};

mod common;
use common::*;

struct TestContext {
    svm: LiteSVM,
    admin: Keypair,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    fee_wallet: Pubkey,
    ticket_registry: Pubkey,
    huma_pool_state: Pubkey,
}

impl TestContext {
    pub fn pool_builder(&self, pool_id: u32) -> CreatePoolBuilder {
        CreatePoolBuilder::new(self.admin.pubkey(), pool_id)
            .with_token_mint(self.token_mint)
            .with_pst_mint(self.pst_mint)
            .with_ticket_registry(self.ticket_registry)
            .with_fee_wallet(self.fee_wallet)
            .with_huma_pool_state(self.huma_pool_state)
    }
}

fn setup_create_pool_context() -> TestContext {
    let (mut svm, admin) = setup_global_config();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    let fee_wallet = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();
    let huma_pool_state = Keypair::new().pubkey();

    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);
    inject_token_account(&mut svm, fee_wallet, token_mint, fee_wallet, 0);
    inject_huma_pool_state(&mut svm, huma_pool_state);

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
        huma_pool_state,
    }
}

#[test]
fn test_create_pool_succeeds() {
    let mut ctx = setup_create_pool_context();
    let meta = ctx
        .pool_builder(1)
        .send(&mut ctx.svm, &ctx.admin)
        .expect("create_pool should succeed");
    let event = assert_log_event::<anchor::events::PoolCreated>(&meta);
    assert_eq!(event.pool_id, 1, "Pool ID mismatch in event");
    assert_eq!(event.admin, ctx.admin.pubkey(), "Admin mismatch in event");
    assert_eq!(
        event.token_mint, ctx.token_mint,
        "Token mint mismatch in event"
    );
    assert_eq!(event.pst_mint, ctx.pst_mint, "PST mint mismatch in event");
    assert_eq!(
        event.max_yield_basis_points, 0,
        "Max yield bips mismatch in event"
    );
    assert_eq!(
        event.payout_timelock_seconds, 300,
        "Payout timelock mismatch in event"
    );
    assert_eq!(event.tiers_count, 1, "Tiers count mismatch in event");
    assert_eq!(event.total_winners, 1, "Total winners mismatch in event");

    let pool_state = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_state.max_yield_basis_points, 0,
        "Max yield bips mismatch in state"
    );
    assert_eq!(
        pool_state.payout_timelock_seconds, 300,
        "Payout timelock mismatch in state"
    );
    assert_eq!(
        pool_state.prize_tiers_count, 1,
        "Tiers count mismatch in state"
    );
    assert_eq!(
        pool_state.prize_tiers[0],
        anchor::PrizeTier::default_single_winner(),
        "Prize tier 0 mismatch in state"
    );
}

#[test]
fn test_create_pool_with_custom_security_parameters_succeeds() {
    let mut ctx = setup_create_pool_context();
    let meta = ctx
        .pool_builder(1)
        .with_max_yield_basis_points(500)
        .with_payout_timelock_seconds(600)
        .send(&mut ctx.svm, &ctx.admin)
        .expect("create_pool should succeed");
    let event = assert_log_event::<anchor::events::PoolCreated>(&meta);
    assert_eq!(event.pool_id, 1, "Pool ID mismatch in event");
    assert_eq!(
        event.max_yield_basis_points, 500,
        "Max yield mismatch in event"
    );
    assert_eq!(
        event.payout_timelock_seconds, 600,
        "Payout timelock mismatch in event"
    );

    let pool_state = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_state.max_yield_basis_points, 500,
        "Max yield mismatch in state"
    );
    assert_eq!(
        pool_state.payout_timelock_seconds, 600,
        "Payout timelock mismatch in state"
    );
}

#[test]
fn test_create_pool_boundary_values_succeed() {
    let mut ctx = setup_create_pool_context();
    // Boundary: max_yield_basis_points = 10_000 (100%), payout_timelock = 86_400 (24h)
    let meta = ctx
        .pool_builder(1)
        .with_fee_basis_points(10_000)
        .with_max_yield_basis_points(10_000)
        .with_payout_timelock_seconds(86_400)
        .send(&mut ctx.svm, &ctx.admin)
        .expect("create_pool boundary should succeed");
    let event = assert_log_event::<anchor::events::PoolCreated>(&meta);
    assert_eq!(
        event.max_yield_basis_points, 10_000,
        "Max yield mismatch in event"
    );
    assert_eq!(
        event.payout_timelock_seconds, 86_400,
        "Payout timelock mismatch in event"
    );
}

#[test]
fn test_create_pool_fails_on_invalid_bond_price() {
    let mut ctx = setup_create_pool_context();
    // bond_price = 0 should fail
    let res = ctx
        .pool_builder(1)
        .with_bond_price(0)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidBondPrice);
}

#[test]
fn test_create_pool_fails_on_invalid_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = 0 should fail
    let res = ctx
        .pool_builder(1)
        .with_stake_cycle_duration_hrs(0)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_create_pool_fails_on_negative_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = -24 should fail
    let res = ctx
        .pool_builder(1)
        .with_stake_cycle_duration_hrs(-24)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_create_pool_fails_on_exceeds_max_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = 8761 (> MAX_STAKE_CYCLE_DURATION_HRS) should fail
    let res = ctx
        .pool_builder(1)
        .with_stake_cycle_duration_hrs(8761)
        .send(&mut ctx.svm, &ctx.admin);
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

    let res = ctx
        .pool_builder(1)
        .with_ticket_registry(too_small_registry)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::RegistryTooSmall);
}

#[test]
fn test_create_pool_fails_on_unauthorized_admin() {
    let mut ctx = setup_create_pool_context();
    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let res = ctx.pool_builder(1).send(&mut ctx.svm, &hacker);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_create_pool_fails_on_invalid_fee_config() {
    let mut ctx = setup_create_pool_context();
    // fee_basis_points = 10001 (exceeds 10000 / 100%) should fail
    let res = ctx
        .pool_builder(1)
        .with_fee_basis_points(10_001)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidFeeConfig);
}

#[test]
fn test_create_pool_fails_on_invalid_max_yield_basis_points() {
    let mut ctx = setup_create_pool_context();
    // max_yield_basis_points = 10001 (exceeds 10000 / 100%) should fail
    let res = ctx
        .pool_builder(1)
        .with_max_yield_basis_points(10_001)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidMaxYieldBasisPoints);
}

#[test]
fn test_create_pool_fails_on_invalid_payout_timelock() {
    let mut ctx = setup_create_pool_context();
    // payout_timelock_seconds = 86401 (exceeds 86400 / 24h) should fail
    let res = ctx
        .pool_builder(1)
        .with_payout_timelock_seconds(86_401)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidPayoutTimelock);
}

#[test]
fn test_create_pool_fails_on_empty_prize_tiers() {
    let mut ctx = setup_create_pool_context();
    let res = ctx
        .pool_builder(1)
        .with_prize_tiers(vec![])
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidPrizeTierConfig);
}

#[test]
fn test_create_pool_fails_on_exceeding_max_prize_tiers() {
    let mut ctx = setup_create_pool_context();
    let eleven_tiers = vec![anchor::PrizeTier::new(1, 909); 11];
    let res = ctx
        .pool_builder(1)
        .with_prize_tiers(eleven_tiers)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidPrizeTierConfig);
}

#[test]
fn test_create_pool_fails_on_invalid_basis_points_or_winners() {
    let mut ctx = setup_create_pool_context();

    // 0 winners
    let zero_winners = vec![anchor::PrizeTier::new(0, 10_000)];
    let res1 = ctx
        .pool_builder(1)
        .with_prize_tiers(zero_winners)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res1, PremiumBondsError::InvalidPrizeTierConfig);

    // 0 bps
    let zero_bps = vec![anchor::PrizeTier::new(1, 0)];
    let res2 = ctx
        .pool_builder(1)
        .with_prize_tiers(zero_bps)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res2, PremiumBondsError::InvalidPrizeTierConfig);
}

#[test]
fn test_create_pool_fails_on_incorrect_total_basis_points() {
    let mut ctx = setup_create_pool_context();
    let bad_bps = vec![anchor::PrizeTier::new(1, 9999)];
    let res = ctx
        .pool_builder(1)
        .with_prize_tiers(bad_bps)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::BasisPointsMustEqual10000);
}

#[test]
fn test_create_pool_fails_on_exceeding_total_winners() {
    let mut ctx = setup_create_pool_context();
    let too_many_winners = vec![anchor::PrizeTier::new(181, 10_000)];
    let res = ctx
        .pool_builder(1)
        .with_prize_tiers(too_many_winners)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::TooManyWinners);
}

#[test]
fn test_create_pool_fails_duplicate_initialization() {
    let mut ctx = setup_create_pool_context();
    let res1 = ctx.pool_builder(1).send(&mut ctx.svm, &ctx.admin);
    assert!(
        res1.is_ok(),
        "First create_pool must succeed: {:?}",
        res1.err()
    );

    // Second create_pool with same pool_id = 1 and new registry account on the same svm
    ctx.svm.expire_blockhash();
    let new_reg = Keypair::new().pubkey();
    inject_zero_account(
        &mut ctx.svm,
        new_reg,
        anchor::constants::REGISTRY_INITIAL_SIZE,
    );

    let res2 = ctx
        .pool_builder(1)
        .with_ticket_registry(new_reg)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_code_at(res2, 0, 0, "SystemError::AccountAlreadyInUse");
}

#[test]
fn test_create_pool_fails_reusing_initialized_registry() {
    let mut ctx = setup_create_pool_context();

    // Create pool 1 with registry
    let res1 = ctx.pool_builder(1).send(&mut ctx.svm, &ctx.admin);
    assert!(
        res1.is_ok(),
        "First create_pool must succeed: {:?}",
        res1.err()
    );

    // Attempt to create pool 2 reusing the already initialized (non-zero) registry
    ctx.svm.expire_blockhash();
    let res2 = ctx.pool_builder(2).send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res2, anchor_lang::error::ErrorCode::ConstraintZero);
}
