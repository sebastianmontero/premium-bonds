//! Integration tests for the `withdraw_fees` admin instruction.
//!
//! Strategy
//! ─────────
//! Tests load compiled .so binaries for both our anchor program and the mock Huma program.
//! Using LiteSVM, we verify happy paths (1:1 and non-1:1 exchange rates), access control,
//! validation guards, and PDA/account constraints.

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

fn pending_redemption_pda(pool_id: u32, redemption_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"pending_redemption",
            pool_id.to_le_bytes().as_ref(),
            redemption_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

fn read_pending_redemption(
    svm: &LiteSVM,
    pool_id: u32,
    redemption_id: u64,
) -> anchor::PendingRedemption {
    use anchor_lang::AccountDeserialize;
    let (pda, _) = pending_redemption_pda(pool_id, redemption_id);
    let acct = svm
        .get_account(&pda)
        .expect("pending_redemption account should exist");
    anchor::PendingRedemption::try_deserialize(&mut &acct.data[..]).unwrap()
}

/// Build a `WithdrawFees` instruction.
fn build_withdraw_fees_ix(
    admin: Pubkey,
    pool_id: u32,
    redemption_id: u64,
    pool_pst_vault: Pubkey,
    huma_config: Pubkey,
    huma_pool_state: Pubkey,
    huma_mode_mint: Pubkey,
    huma_pool_authority: Pubkey,
    huma_pool_mode_token: Pubkey,
    amount: u64,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::WithdrawFees {
        admin,
        global_config,
        pool,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint,
        huma_redemption_request: dummy,
        huma_lender_state: dummy,
        huma_pool_authority,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::WithdrawFees { amount }.data(),
    }
}

/// Send a `WithdrawFees` instruction.
fn send_withdraw_fees(svm: &mut LiteSVM, admin: &Keypair, ix: Instruction) -> Result<(), String> {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy Path Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_succeeds() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    // Initialize huma_pool_mode_token owned by huma_pool_authority
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    // Set up pool_pst_vault with $PST tokens
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pool_key, _) = pool_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_key,
        10_000_000,
    );

    // Update pool state to have accrued fees
    let (pool_pda, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 5_000_000;
    pool.total_fees_withdrawn = 0;
    pool.next_redemption_id = 0;

    let mut serialized_pool = vec![];
    pool.try_serialize(&mut serialized_pool).unwrap();
    serialized_pool.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0, // redemption_id = 0
        pool_pst_vault,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        huma_pool_mode_token,
        2_000_000, // withdraw 2 USDC
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_ok(), "withdraw_fees should succeed: {:?}", res);

    // Verify pool state updates
    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(updated_pool.total_fees_withdrawn, 2_000_000);
    assert_eq!(updated_pool.next_redemption_id, 1);

    // Verify pending redemption PDA creation and data
    let pending = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(pending.pool_id, 1);
    assert_eq!(pending.redemption_id, 0);
    assert_eq!(pending.user, updated_pool.fee_wallet);
    assert_eq!(pending.amount, 2_000_000);
    assert_eq!(pending.pst_shares_locked, 2_000_000); // 1:1 since total_assets is 0

    // Verify token transfers
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 8_000_000);
    assert_eq!(
        read_token_balance(&ctx.svm, huma_pool_mode_token),
        2_000_000
    );
}

#[test]
fn test_withdraw_fees_math_non_1_to_1() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    // 1. Set huma_pool_state to total_assets = 20,000,000 USDC
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
    huma_pool_state_data[30..46].copy_from_slice(&20_000_000u128.to_le_bytes()); // assets = 20 USDC
    ctx.svm
        .set_account(
            ctx.huma_pool_state,
            Account {
                lamports: 1_000_000_000,
                data: huma_pool_state_data,
                owner: huma_program_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // 2. Set pst_mint to supply = 10,000,000 PST (meaning 1 PST = 2 USDC)
    let mut mint_data = vec![0u8; 82];
    mint_data[0..4].copy_from_slice(&1u32.to_le_bytes()); // COption::Some
    mint_data[4..36].copy_from_slice(&ctx.huma_pool_authority.to_bytes());
    mint_data[36..44].copy_from_slice(&10_000_000u64.to_le_bytes()); // supply = 10M
    mint_data[44] = 6;
    mint_data[45] = 1;
    ctx.svm
        .set_account(
            ctx.pst_mint,
            Account {
                lamports: 1_000_000_000,
                data: mint_data,
                owner: anchor_spl::token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Initialize huma_pool_mode_token owned by huma_pool_authority
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    // Set up pool_pst_vault with $PST tokens
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pool_key, _) = pool_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_key,
        10_000_000,
    );

    // Update pool state to have accrued fees
    let (pool_pda, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 5_000_000;
    pool.total_fees_withdrawn = 0;
    pool.next_redemption_id = 0;

    let mut serialized_pool = vec![];
    pool.try_serialize(&mut serialized_pool).unwrap();
    serialized_pool.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Withdraw 2 USDC (2_000_000). At 1 PST = 2 USDC, this should equal 1 PST (1_000_000 shares)
    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        huma_pool_mode_token,
        2_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_ok(), "withdraw_fees should succeed: {:?}", res);

    // Verify pending redemption PDA has 1_000_000 shares locked
    let pending = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(pending.amount, 2_000_000);
    assert_eq!(pending.pst_shares_locked, 1_000_000);

    // Verify token transfers
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 9_000_000);
    assert_eq!(
        read_token_balance(&ctx.svm, huma_pool_mode_token),
        1_000_000
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Control Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_unauthorized_admin() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let ix = build_withdraw_fees_ix(
        hacker.pubkey(), // hacker tries to pretend to be the admin
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &hacker, ix);
    assert!(res.is_err(), "Must fail with unauthorized admin");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne"),
        "Expected UnauthorizedAdmin or ConstraintHasOne, got: {}",
        err_str
    );
}

#[test]
fn test_withdraw_fees_fails_unsigned_admin() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    // Override is_signer to false
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == ctx.admin.pubkey() {
            meta.is_signer = false;
        }
    }

    let payer = Keypair::new();
    ctx.svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    let res = ctx.svm.send_transaction(tx);

    assert!(res.is_err(), "Must fail when admin is not signer");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Input Validation & Guards
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_zero_amount() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        0, // amount = 0
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with zero amount");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("InsufficientFeeBalance")
            || err_str.contains("6004")
            || err_str.contains("0x1774"),
        "Expected InsufficientFeeBalance error, got: {}",
        err_str
    );
}

#[test]
fn test_withdraw_fees_fails_exceeds_available_fees() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    // Set up pool state
    let (pool_pda, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 5_000_000;
    pool.total_fees_withdrawn = 4_000_000; // Available = 1_000_000

    let mut serialized_pool = vec![];
    pool.try_serialize(&mut serialized_pool).unwrap();
    serialized_pool.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_001, // 1 micro-USDC over limit
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail when amount exceeds available fees");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("InsufficientFeeBalance")
            || err_str.contains("6004")
            || err_str.contains("0x1774"),
        "Expected InsufficientFeeBalance error, got: {}",
        err_str
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDA & Account Constraint Validation
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_wrong_global_config_pda() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    // Swap global_config for a random PDA
    let wrong_config = Keypair::new().pubkey();
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == global_config_pda().0 {
            meta.pubkey = wrong_config;
        }
    }

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with incorrect global config PDA");
}

#[test]
fn test_withdraw_fees_fails_wrong_pool_pda() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    // Swap pool for a random PDA
    let wrong_pool = Keypair::new().pubkey();
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == pool_pda(1).0 {
            meta.pubkey = wrong_pool;
        }
    }

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with incorrect pool PDA");
}

#[test]
fn test_withdraw_fees_fails_pool_vault_authority_bump_mismatch() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    // Corrupt vault_authority_bump inside pool state
    let (pool_pda, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.vault_authority_bump ^= 1; // Corrupt bump

    let mut serialized_pool = vec![];
    pool.try_serialize(&mut serialized_pool).unwrap();
    serialized_pool.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with vault_authority_bump mismatch");
}

#[test]
fn test_withdraw_fees_fails_wrong_pst_vault_pda() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    // Swap pool_pst_vault for a random token account PDA
    let wrong_vault = Keypair::new().pubkey();
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == pool_pst_vault_pda(1).0 {
            meta.pubkey = wrong_vault;
        }
    }

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with incorrect pool PST vault PDA");
}

#[test]
fn test_withdraw_fees_fails_wrong_huma_program() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    // Swap huma_program for a random key
    let wrong_huma_prog = Keypair::new().pubkey();
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == huma_program_id() {
            meta.pubkey = wrong_huma_prog;
        }
    }

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail with incorrect huma program address"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layout Validation Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_invalid_huma_pool_state_layout() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    // 1. Corrupt huma_pool_state by writing an empty vector length prefix
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&0u32.to_le_bytes()); // vec_len = 0
    ctx.svm
        .set_account(
            ctx.huma_pool_state,
            Account {
                lamports: 1_000_000_000,
                data: huma_pool_state_data,
                owner: huma_program_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        dummy,
        1_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail when huma_pool_state has empty mode_states vector"
    );
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("MathOverflow") || err_str.contains("custom program error"),
        "Expected MathOverflow error, got: {}",
        err_str
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI Failures
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_huma_redemption_error() {
    let mut ctx = setup_e2e(10);

    // Set up pool state
    let (pool_pda, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 5_000_000;
    pool.total_fees_withdrawn = 0;
    pool.next_redemption_id = 0;

    let mut serialized_pool = vec![];
    pool.try_serialize(&mut serialized_pool).unwrap();
    serialized_pool.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Initialize huma_pool_mode_token owned by huma_pool_authority so it passes Anchor validation
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    // Use FAIL_REDEMPTION_PUBKEY as the huma_config account to trigger simulated failure
    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        FAIL_REDEMPTION_PUBKEY,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        huma_pool_mode_token,
        1_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail with simulated Huma CPI redemption failure"
    );
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("SimulatedRedemptionFailure")
            || err_str.contains("6001")
            || err_str.contains("0x1771"),
        "Expected SimulatedRedemptionFailure error, got: {}",
        err_str
    );
}

#[test]
fn test_withdraw_fees_fails_invalid_mode_mint() {
    let mut ctx = setup_e2e(10);

    // Set up pool state
    let (pool_pda, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 5_000_000;
    pool.total_fees_withdrawn = 0;
    pool.next_redemption_id = 0;

    let mut serialized_pool = vec![];
    pool.try_serialize(&mut serialized_pool).unwrap();
    serialized_pool.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    // Create a fake mint
    let fake_mint = create_spl_mint(&mut ctx.svm, &ctx.admin, &ctx.admin.pubkey(), 6);

    let ix = build_withdraw_fees_ix(
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault_pda(1).0,
        Keypair::new().pubkey(),
        ctx.huma_pool_state,
        fake_mint, // Pass fake mint!
        ctx.huma_pool_authority,
        huma_pool_mode_token,
        1_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with InvalidModeMint");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(err_str.contains("InvalidModeMint"), "Expected InvalidModeMint error, got: {}", err_str);
}
