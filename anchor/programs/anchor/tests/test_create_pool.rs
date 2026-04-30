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

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const POOL_VAULT_SEED: &[u8] = b"pool_vault";
const POOL_KTOKENS_SEED: &[u8] = b"pool_ktokens";

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn pool_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn pool_ktokens_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_KTOKENS_SEED, pool_id.to_le_bytes().as_ref()],
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

fn inject_mint(svm: &mut LiteSVM, address: Pubkey) {
    let mut data = vec![0; 82];
    data[45] = 1; // is_initialized = true
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();
}

fn inject_token_account(svm: &mut LiteSVM, address: Pubkey, mint: Pubkey) {
    let mut data = vec![0; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[108] = 1; // state = Initialized
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();
}

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
    ).unwrap();
}

struct TestContext {
    svm: LiteSVM,
    admin: Keypair,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    fee_wallet: Pubkey,
    ticket_registry: Pubkey,
}

fn setup_create_pool_context() -> TestContext {
    let (mut svm, admin) = setup_global_config();

    let token_mint = Keypair::new().pubkey();
    let reserve_collateral_mint = Keypair::new().pubkey();
    let fee_wallet = Keypair::new().pubkey();
    let ticket_registry = Keypair::new().pubkey();

    inject_mint(&mut svm, token_mint);
    inject_mint(&mut svm, reserve_collateral_mint);
    inject_token_account(&mut svm, fee_wallet, token_mint);
    
    // Inject the ticket registry with the minimum initial size
    inject_zero_account(&mut svm, ticket_registry, anchor::constants::REGISTRY_INITIAL_SIZE);

    TestContext {
        svm,
        admin,
        token_mint,
        reserve_collateral_mint,
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
    max_withdrawal_slippage_dust: u64,
    auto_reinvest_default: bool,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault_account, _) = pool_vault_pda(pool_id);
    let (pool_ktokens_vault, _) = pool_ktokens_vault_pda(pool_id);

    let accounts = anchor::accounts::CreatePool {
        global_config,
        admin: ctx.admin.pubkey(),
        pool,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.token_mint,
        reserve_collateral_mint: ctx.reserve_collateral_mint,
        pool_vault_account,
        pool_ktokens_vault,
        fee_wallet: ctx.fee_wallet,
        system_program: anchor_lang::system_program::ID,
        token_program: anchor_spl::token::ID,
        ktokens_token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CreatePool {
            pool_id,
            bond_price,
            stake_cycle_duration_hrs,
            fee_basis_points,
            max_withdrawal_slippage_dust,
            auto_reinvest_default,
        }
        .data(),
    }
}

#[test]
fn test_create_pool_succeeds() {
    let mut ctx = setup_create_pool_context();
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 10, true);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_ok(), "create_pool should succeed");
}

#[test]
fn test_create_pool_fails_on_invalid_bond_price() {
    let mut ctx = setup_create_pool_context();
    // bond_price = 0 should fail
    let ix = build_create_pool_ix(&ctx, 1, 0, 24, 100, 10, true);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("InvalidBondPrice"));
}

#[test]
fn test_create_pool_fails_on_invalid_stake_duration() {
    let mut ctx = setup_create_pool_context();
    // stake_cycle_duration_hrs = 0 should fail
    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 0, 100, 10, true);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("InvalidStakeCycleDuration"));
}

#[test]
fn test_create_pool_fails_on_registry_too_small() {
    let mut ctx = setup_create_pool_context();
    
    // Inject a ticket registry that is too small
    let too_small_registry = Keypair::new().pubkey();
    inject_zero_account(&mut ctx.svm, too_small_registry, anchor::constants::REGISTRY_INITIAL_SIZE - 1);
    ctx.ticket_registry = too_small_registry;

    let ix = build_create_pool_ix(&ctx, 1, 1_000_000, 24, 100, 10, true);

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("RegistryTooSmall"));
}

#[test]
fn test_create_pool_fails_on_unauthorized_admin() {
    let mut ctx = setup_create_pool_context();
    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(1);
    let (pool_vault_account, _) = pool_vault_pda(1);
    let (pool_ktokens_vault, _) = pool_ktokens_vault_pda(1);

    // Try to call create_pool with hacker as admin
    let accounts = anchor::accounts::CreatePool {
        global_config,
        admin: hacker.pubkey(),
        pool,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.token_mint,
        reserve_collateral_mint: ctx.reserve_collateral_mint,
        pool_vault_account,
        pool_ktokens_vault,
        fee_wallet: ctx.fee_wallet,
        system_program: anchor_lang::system_program::ID,
        token_program: anchor_spl::token::ID,
        ktokens_token_program: anchor_spl::token::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CreatePool {
            pool_id: 1,
            bond_price: 1_000_000,
            stake_cycle_duration_hrs: 24,
            fee_basis_points: 100,
            max_withdrawal_slippage_dust: 10,
            auto_reinvest_default: true,
        }
        .data(),
    };

    let blockhash = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&hacker.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&hacker]).unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_err());
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne"));
}
