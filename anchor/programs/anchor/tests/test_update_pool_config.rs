use anchor::error::PremiumBondsError;
use anchor_lang::AccountDeserialize;
use litesvm::LiteSVM;
use solana_program::pubkey::Pubkey;
use solana_sdk::{signature::Keypair, signer::Signer};

mod common;
use common::*;

fn inject_pool(svm: &mut LiteSVM, pool_id: u32) -> Pubkey {
    PrizePoolTestBuilder::new(pool_id)
        .with_payout_timelock_seconds(300)
        .inject(svm)
        .0
}

#[test]
fn test_update_pool_config_succeeds_empty() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey()).send(&mut svm, &admin);
    assert!(res.is_ok());
}

#[test]
fn test_update_pool_config_succeeds_one_field() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let meta = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_basis_points(200)
        .send(&mut svm, &admin)
        .expect("update_pool_config should succeed updating one field");
    let event = assert_cpi_event::<anchor::events::PoolConfigUpdated>(&meta);
    assert_eq!(event.pool_id, 1, "Event pool_id mismatch");
    assert_eq!(event.admin, admin.pubkey(), "Event admin mismatch");
    assert_eq!(event.old_fee_basis_points, 100, "Old fee bips mismatch");
    assert_eq!(event.new_fee_basis_points, 200, "New fee bips mismatch");
    assert_eq!(
        event.old_stake_cycle_duration_hrs, 24,
        "Old duration mismatch"
    );
    assert_eq!(
        event.new_stake_cycle_duration_hrs, 24,
        "New duration mismatch"
    );
    assert!(event.timestamp > 0, "Event timestamp must be positive");

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pool_state.fee_basis_points, 200, "Pool fee bips mismatch");
    assert_eq!(pool_state.bond_price, 1_000_000, "Pool bond price mismatch");
}

#[test]
fn test_update_pool_config_succeeds_all_fields() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let new_fee_wallet = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        new_fee_wallet,
        Pubkey::default(),
        admin.pubkey(),
        0,
    );

    let meta = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_basis_points(50)
        .with_bond_price(2_000_000)
        .with_fee_wallet(new_fee_wallet)
        .with_min_yield_threshold(1_000_000)
        .with_stake_cycle_duration_hrs(168)
        .send(&mut svm, &admin)
        .expect("update_pool_config should succeed updating all fields");
    let event = assert_cpi_event::<anchor::events::PoolConfigUpdated>(&meta);
    assert_eq!(
        event.old_stake_cycle_duration_hrs, 24,
        "Old duration mismatch"
    );
    assert_eq!(
        event.new_stake_cycle_duration_hrs, 168,
        "New duration mismatch"
    );
    assert_eq!(event.old_fee_basis_points, 100, "Old fee bips mismatch");
    assert_eq!(event.new_fee_basis_points, 50, "New fee bips mismatch");
    assert!(event.timestamp > 0, "Event timestamp must be positive");

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pool_state.fee_basis_points, 50, "Pool fee bips mismatch");
    assert_eq!(pool_state.bond_price, 2_000_000, "Pool bond price mismatch");
    assert_eq!(pool_state.fee_wallet, new_fee_wallet, "Fee wallet mismatch");
    assert_eq!(
        pool_state.min_yield_threshold, 1_000_000,
        "Min yield threshold mismatch"
    );
    assert_eq!(
        pool_state.stake_cycle_duration_hrs, 168,
        "Duration mismatch"
    );
}

#[test]
fn test_update_pool_config_succeeds_stake_cycle_duration() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let meta = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_stake_cycle_duration_hrs(72)
        .send(&mut svm, &admin)
        .expect("update_pool_config should succeed updating duration");
    let event = assert_cpi_event::<anchor::events::PoolConfigUpdated>(&meta);
    assert_eq!(event.pool_id, 1, "Pool ID mismatch");
    assert_eq!(
        event.old_stake_cycle_duration_hrs, 24,
        "Old duration mismatch"
    );
    assert_eq!(
        event.new_stake_cycle_duration_hrs, 72,
        "New duration mismatch"
    );
    assert!(event.timestamp > 0, "Event timestamp must be positive");

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();
    assert_eq!(
        pool_state.stake_cycle_duration_hrs, 72,
        "Duration mismatch in state"
    );
}

#[test]
fn test_update_pool_config_fails_invalid_stake_cycle_duration_zero() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_stake_cycle_duration_hrs(0)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_update_pool_config_fails_negative_stake_cycle_duration() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_stake_cycle_duration_hrs(-10)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_update_pool_config_fails_exceeds_max_stake_cycle_duration() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_stake_cycle_duration_hrs(8761)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidStakeCycleDuration);
}

#[test]
fn test_update_pool_config_fails_invalid_bond_price() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_bond_price(0)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidBondPrice);
}

#[test]
fn test_update_pool_config_unauthorized_admin() {
    let (mut svm, _true_admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let hacker = Keypair::new();
    svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let res = UpdatePoolConfigBuilder::for_pool(1, hacker.pubkey())
        .with_fee_basis_points(0)
        .send(&mut svm, &hacker);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_update_pool_config_fails_invalid_fee() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_basis_points(10_001)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidFeeConfig);
}

#[test]
fn test_update_pool_config_fails_when_deposited_principal_non_zero() {
    let (mut svm, admin) = setup_global_config();
    PrizePoolTestBuilder::new(1)
        .with_payout_timelock_seconds(300)
        .with_solvency_state(5_000_000, 0, 0)
        .inject(&mut svm);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_bond_price(2_000_000)
        .send(&mut svm, &admin);
    assert_custom_error(
        res,
        PremiumBondsError::CannotModifyBondPriceWithActiveDeposits,
    );
}

#[test]
fn test_update_pool_config_fails_when_prizes_allocated_non_zero() {
    let (mut svm, admin) = setup_global_config();
    PrizePoolTestBuilder::new(1)
        .with_payout_timelock_seconds(300)
        .with_solvency_state(0, 1_000_000, 0)
        .inject(&mut svm);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_bond_price(2_000_000)
        .send(&mut svm, &admin);
    assert_custom_error(
        res,
        PremiumBondsError::CannotModifyBondPriceWithActiveDeposits,
    );
}

#[test]
fn test_update_pool_config_fails_when_pending_redemptions_non_zero() {
    let (mut svm, admin) = setup_global_config();
    PrizePoolTestBuilder::new(1)
        .with_payout_timelock_seconds(300)
        .with_pending_redemptions(2)
        .inject(&mut svm);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_bond_price(2_000_000)
        .send(&mut svm, &admin);
    assert_custom_error(
        res,
        PremiumBondsError::CannotModifyBondPriceWithActiveDeposits,
    );
}

#[test]
fn test_update_pool_config_fails_when_frozen_for_draw() {
    let (mut svm, admin) = setup_global_config();
    PrizePoolTestBuilder::new(1)
        .with_payout_timelock_seconds(300)
        .with_frozen(true)
        .inject(&mut svm);

    // Attempting to update any parameter (e.g. fee basis points) should fail if frozen
    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_basis_points(200)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_update_pool_config_fails_when_frozen_stake_duration() {
    let (mut svm, admin) = setup_global_config();
    PrizePoolTestBuilder::new(1)
        .with_payout_timelock_seconds(300)
        .with_frozen(true)
        .inject(&mut svm);

    // Attempting to update duration should fail if frozen
    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_stake_cycle_duration_hrs(168)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_update_pool_config_idempotent_bond_price_succeeds_with_deposits() {
    let (mut svm, admin) = setup_global_config();
    let (pool_pda, _) = PrizePoolTestBuilder::new(1)
        .with_payout_timelock_seconds(300)
        .with_solvency_state(10_000_000, 500_000, 0)
        .with_pending_redemptions(1)
        .inject(&mut svm);

    // Passing current bond_price (1_000_000) along with a new fee should succeed
    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_basis_points(250)
        .with_bond_price(1_000_000) // Same bond price (idempotent)
        .send(&mut svm, &admin);
    assert!(
        res.is_ok(),
        "Idempotent bond_price update should succeed on active pools"
    );

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pool_state.fee_basis_points, 250);
    assert_eq!(pool_state.bond_price, 1_000_000);
}

#[test]
fn test_update_pool_config_duration_advances_on_next_harvest() {
    let mut ctx = setup_e2e();
    let pool_state = read_pool_state(&ctx.svm, 1);
    let initial_cycle_end = pool_state.current_cycle_end_at;

    // Mid-cycle config update to 168 hours (7 days)
    let res = UpdatePoolConfigBuilder::for_pool(1, ctx.admin.pubkey())
        .with_stake_cycle_duration_hrs(168)
        .send(&mut ctx.svm, &ctx.admin);
    assert!(res.is_ok(), "Config update should succeed: {:?}", res.err());

    // Invariant check: current_cycle_end_at MUST remain initial_cycle_end for the active cycle
    let pool_after_update = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_after_update.stake_cycle_duration_hrs, 168);
    assert_eq!(pool_after_update.current_cycle_end_at, initial_cycle_end);

    // Warp clock to initial_cycle_end and execute HarvestYieldAndCommit on-chain
    let harvest_res = send_e2e_harvest_yield_and_commit(&mut ctx);
    assert!(
        harvest_res.is_ok(),
        "Harvest should succeed: {:?}",
        harvest_res.err()
    );

    // Verify on-chain state: current_cycle_end_at has advanced by new 168 hours duration
    let pool_after_harvest = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_after_harvest.current_cycle_end_at,
        initial_cycle_end + 168 * 3600,
        "Cycle end time must advance by 168 hours upon on-chain harvest"
    );
}

#[test]
fn test_update_pool_config_fails_missing_fee_wallet_account() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);
    let new_fee_wallet = Keypair::new().pubkey();

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_wallet(new_fee_wallet)
        .without_fee_wallet_account()
        .send(&mut svm, &admin);

    assert_custom_error(res, PremiumBondsError::InvalidFeeWallet);
}

#[test]
fn test_update_pool_config_fails_invalid_fee_wallet_mint() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    // Create fee_wallet with wrong token mint
    let wrong_mint = Keypair::new().pubkey();
    let new_fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, new_fee_wallet, wrong_mint, admin.pubkey(), 0);

    // Pool's token_mint is Pubkey::default() in inject_pool, which does not match wrong_mint
    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_fee_wallet(new_fee_wallet)
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidFeeWallet);
}

#[test]
fn test_update_pool_config_fails_timelock_exceeds_max() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_payout_timelock_seconds(86_401) // > 86400 max
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidPayoutTimelock);
}

#[test]
fn test_update_pool_config_fails_max_yield_exceeds_max() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let res = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_max_yield_basis_points(10_001) // > 10_000 max bps
        .send(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::InvalidMaxYieldBasisPoints);
}

#[test]
fn test_update_pool_config_succeeds_max_yield_and_timelock() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let meta = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_max_yield_basis_points(500) // 5%
        .with_payout_timelock_seconds(600) // 600s
        .send(&mut svm, &admin)
        .expect("update should succeed");
    let event = assert_cpi_event::<anchor::events::PoolConfigUpdated>(&meta);
    assert_eq!(
        event.old_max_yield_basis_points, 0,
        "old_max_yield_basis_points was 0"
    );
    assert_eq!(
        event.new_max_yield_basis_points, 500,
        "new_max_yield_basis_points is 500"
    );
    assert_eq!(
        event.old_payout_timelock_seconds, 300,
        "old_payout_timelock_seconds was 300"
    );
    assert_eq!(
        event.new_payout_timelock_seconds, 600,
        "new_payout_timelock_seconds is 600"
    );
    assert!(event.timestamp > 0, "event timestamp is valid");

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();
    assert_eq!(
        pool_state.max_yield_basis_points, 500,
        "pool max_yield_basis_points updated"
    );
    assert_eq!(
        pool_state.payout_timelock_seconds, 600,
        "pool payout_timelock_seconds updated"
    );
}

#[test]
fn test_update_pool_config_bond_price_change_after_full_exit() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    // Ensure all liabilities are 0 (full exit state)
    common::mutate_pool_state(&mut svm, 1, |p| {
        p.total_deposited_principal = 0;
        p.total_prizes_allocated = 0;
        p.total_pending_redemptions = 0;
        p.bond_price = 1_000_000;
    });

    let meta = UpdatePoolConfigBuilder::for_pool(1, admin.pubkey())
        .with_bond_price(5_000_000) // update bond_price from 1 to 5 USDC
        .send(&mut svm, &admin)
        .expect("bond price change after full exit should succeed");
    let event = assert_cpi_event::<anchor::events::PoolConfigUpdated>(&meta);
    assert_eq!(event.old_bond_price, 1_000_000);
    assert_eq!(event.new_bond_price, 5_000_000);

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();
    assert_eq!(pool_state.bond_price, 5_000_000);
}
