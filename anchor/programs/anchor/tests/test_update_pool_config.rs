use anchor::error::PremiumBondsError;
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
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


fn inject_pool(svm: &mut LiteSVM, pool_id: u32) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);

    use anchor_lang::Discriminator;
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint: Pubkey::default(),
        ticket_registry: Pubkey::default(),
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
        is_frozen_for_draw: 0,
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

fn build_update_pool_config_ix(
    admin: Pubkey,
    pool_id: u32,
    new_fee_basis_points: Option<u16>,
    new_bond_price: Option<u64>,
    new_fee_wallet: Option<Pubkey>,
    new_min_yield_threshold: Option<u64>,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let accounts = anchor::accounts::UpdatePoolConfig {
        global_config,
        admin,
        pool,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::UpdatePoolConfig {
            new_fee_basis_points,
            new_bond_price,
            new_fee_wallet,
            new_min_yield_threshold,
        }
        .data(),
    }
}

#[test]
fn test_update_pool_config_succeeds_empty() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "update_pool_config should succeed with all None"
    );
}

#[test]
fn test_update_pool_config_succeeds_one_field() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, Some(200), None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let meta = svm.send_transaction(tx).expect("update_pool_config should succeed updating one field");
    let event = assert_log_event::<anchor::events::PoolConfigUpdated>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.admin, admin.pubkey());
    assert_eq!(event.fee_basis_points, 200);

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pool_state.fee_basis_points, 200);
    assert_eq!(pool_state.bond_price, 1_000_000);
}

#[test]
fn test_update_pool_config_succeeds_all_fields() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let new_fee_wallet = Keypair::new().pubkey();

    let ix = build_update_pool_config_ix(
        admin.pubkey(),
        1,
        Some(50),
        Some(2_000_000),
        Some(new_fee_wallet),
        Some(1_000_000),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "update_pool_config should succeed updating all fields"
    );

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();

    assert_eq!(pool_state.fee_basis_points, 50);
    assert_eq!(pool_state.bond_price, 2_000_000);
    assert_eq!(pool_state.fee_wallet, new_fee_wallet);
    assert_eq!(pool_state.min_yield_threshold, 1_000_000);
}

#[test]
fn test_update_pool_config_fails_invalid_bond_price() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, Some(0), None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("InvalidBondPrice"));
}

#[test]
fn test_update_pool_config_unauthorized_admin() {
    let (mut svm, _true_admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let hacker = Keypair::new();
    svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let ix = build_update_pool_config_ix(hacker.pubkey(), 1, Some(0), None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&hacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&hacker]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne"));
}

#[test]
fn test_update_pool_config_fails_invalid_fee() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, Some(10_001), None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("InvalidFeeConfig"));
}

fn inject_pool_custom(
    svm: &mut LiteSVM,
    pool_id: u32,
    total_deposited_principal: u64,
    total_prizes_allocated: u64,
    total_pending_redemptions: u64,
    is_frozen_for_draw: u8,
) -> Pubkey {
    let pda = common::inject_pool(
        svm,
        pool_id,
        Pubkey::default(),
        Pubkey::default(),
        anchor::PoolStatus::Active,
        is_frozen_for_draw != 0,
    );

    let mut acc = svm.get_account(&pda).unwrap();
    let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
    pool.total_deposited_principal = total_deposited_principal;
    pool.total_prizes_allocated = total_prizes_allocated;
    pool.total_pending_redemptions = total_pending_redemptions;
    pool.is_frozen_for_draw = is_frozen_for_draw;

    svm.set_account(pda, acc).unwrap();
    pda
}

#[test]
fn test_update_pool_config_fails_when_deposited_principal_non_zero() {
    let (mut svm, admin) = setup_global_config();
    inject_pool_custom(&mut svm, 1, 5_000_000, 0, 0, 0);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, Some(2_000_000), None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("CannotModifyBondPriceWithActiveDeposits"),
        "Expected CannotModifyBondPriceWithActiveDeposits error, got: {}",
        err_str
    );
}

#[test]
fn test_update_pool_config_fails_when_prizes_allocated_non_zero() {
    let (mut svm, admin) = setup_global_config();
    inject_pool_custom(&mut svm, 1, 0, 1_000_000, 0, 0);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, Some(2_000_000), None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("CannotModifyBondPriceWithActiveDeposits"),
        "Expected CannotModifyBondPriceWithActiveDeposits error, got: {}",
        err_str
    );
}

#[test]
fn test_update_pool_config_fails_when_pending_redemptions_non_zero() {
    let (mut svm, admin) = setup_global_config();
    inject_pool_custom(&mut svm, 1, 0, 0, 2, 0);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, Some(2_000_000), None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("CannotModifyBondPriceWithActiveDeposits"),
        "Expected CannotModifyBondPriceWithActiveDeposits error, got: {}",
        err_str
    );
}

#[test]
fn test_update_pool_config_fails_when_frozen_for_draw() {
    let (mut svm, admin) = setup_global_config();
    inject_pool_custom(&mut svm, 1, 0, 0, 0, 1);

    // Attempting to update any parameter (e.g. fee basis points) should fail if frozen
    let ix = build_update_pool_config_ix(admin.pubkey(), 1, Some(200), None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("AwaitingRandomnessFreeze"),
        "Expected AwaitingRandomnessFreeze error, got: {}",
        err_str
    );
}

#[test]
fn test_update_pool_config_idempotent_bond_price_succeeds_with_deposits() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool_custom(&mut svm, 1, 10_000_000, 500_000, 1, 0);

    // Passing current bond_price (1_000_000) along with a new fee should succeed
    let ix = build_update_pool_config_ix(
        admin.pubkey(),
        1,
        Some(250),
        Some(1_000_000), // Same bond price (idempotent)
        None,
        None,
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
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
