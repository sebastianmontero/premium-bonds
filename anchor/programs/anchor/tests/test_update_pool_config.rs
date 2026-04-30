use anchor::error::PremiumBondsError;
use anchor_lang::{AccountSerialize, AccountDeserialize, InstructionData, ToAccountMetas, Space};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PRIZE_POOL_SEED: &[u8] = b"prize_pool";

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn setup_global_config() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();

    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    svm.add_program(anchor::id(), program_bytes);

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _bump) = global_config_pda();
    let jobs_account = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy: 100,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    svm.send_transaction(tx).expect("initialize_global should succeed");

    (svm, admin)
}

fn inject_pool(svm: &mut LiteSVM, pool_id: u32) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);

    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint: Pubkey::default(),
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status: anchor::PoolStatus::Active,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: false,
        current_draw_cycle_id: 0,
        max_withdrawal_slippage_dust: 0,
        prize_tiers: vec![],
        auto_reinvest_default: false,
    };

    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();

    let full_size = 8 + anchor::PrizePool::INIT_SPACE;
    data.resize(full_size, 0);

    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    pda
}

fn build_update_pool_config_ix(
    admin: Pubkey,
    pool_id: u32,
    new_auto_reinvest_default: Option<bool>,
    new_fee_basis_points: Option<u16>,
    new_bond_price: Option<u64>,
    new_max_withdrawal_slippage_dust: Option<u64>,
    new_fee_wallet: Option<Pubkey>,
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
            new_auto_reinvest_default,
            new_fee_basis_points,
            new_bond_price,
            new_max_withdrawal_slippage_dust,
            new_fee_wallet,
        }
        .data(),
    }
}

#[test]
fn test_update_pool_config_succeeds_empty() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, None, None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "update_pool_config should succeed with all None");
}

#[test]
fn test_update_pool_config_succeeds_one_field() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, Some(200), None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "update_pool_config should succeed updating one field");

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();
    
    // Check that the updated field changed
    assert_eq!(pool_state.fee_basis_points, 200);
    // Check that others remained the default values
    assert_eq!(pool_state.bond_price, 1_000_000);
    assert_eq!(pool_state.auto_reinvest_default, false);
}

#[test]
fn test_update_pool_config_succeeds_all_fields() {
    let (mut svm, admin) = setup_global_config();
    let pool_pda = inject_pool(&mut svm, 1);

    let new_fee_wallet = Keypair::new().pubkey();

    let ix = build_update_pool_config_ix(
        admin.pubkey(), 
        1, 
        Some(true), 
        Some(50), 
        Some(2_000_000), 
        Some(500), 
        Some(new_fee_wallet)
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "update_pool_config should succeed updating all fields");

    let pool_acc = svm.get_account(&pool_pda).unwrap();
    let mut data_slice: &[u8] = &pool_acc.data;
    let pool_state = anchor::PrizePool::try_deserialize(&mut data_slice).unwrap();
    
    assert_eq!(pool_state.auto_reinvest_default, true);
    assert_eq!(pool_state.fee_basis_points, 50);
    assert_eq!(pool_state.bond_price, 2_000_000);
    assert_eq!(pool_state.max_withdrawal_slippage_dust, 500);
    assert_eq!(pool_state.fee_wallet, new_fee_wallet);
}

#[test]
fn test_update_pool_config_fails_invalid_bond_price() {
    let (mut svm, admin) = setup_global_config();
    inject_pool(&mut svm, 1);

    let ix = build_update_pool_config_ix(admin.pubkey(), 1, None, None, Some(0), None, None);

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

    let ix = build_update_pool_config_ix(hacker.pubkey(), 1, None, Some(0), None, None, None);

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&hacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&hacker]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne"));
}
