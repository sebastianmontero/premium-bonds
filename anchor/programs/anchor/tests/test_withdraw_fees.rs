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

/// Build a `WithdrawFees` instruction.
fn build_withdraw_fees_ix(
    svm: &LiteSVM,
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
    let pool_state = read_pool_state(svm, pool_id);
    let token_mint = pool_state.token_mint;
    let fee_wallet = pool_state.fee_wallet;

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
        token_mint,
        fee_wallet,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::WithdrawFees { amount }.data(),
    }
}

/// Send a `WithdrawFees` instruction.
fn send_withdraw_fees(
    svm: &mut LiteSVM,
    admin: &Keypair,
    ix: Instruction,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();
    svm.send_transaction(tx)
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy Path Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_succeeds() {
    let mut ctx = setup_e2e();
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

    // Set Huma venue solvency state to cover book liabilities (1:1 parity, 10M assets / 10M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        10_000_000,
        10_000_000,
    );

    // Update pool state to have accrued fees
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 0;
        pool.next_redemption_id = 0;
    });

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_eq!(pending.user, ctx.admin.pubkey());
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
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Set Huma venue solvency state: total_assets = 20M, supply = 10M (1 PST = 2 USDC)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        20_000_000,
        10_000_000,
    );

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
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 0;
        pool.next_redemption_id = 0;
    });

    // Withdraw 2 USDC (2_000_000). At 1 PST = 2 USDC, this should equal 1 PST (1_000_000 shares)
    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_eq!(
        pending.redemption_type,
        anchor::state::RedemptionType::FeeWithdrawal
    );

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
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_withdraw_fees_fails_unsigned_admin() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    set_signer_flag(&mut ix.accounts, &ctx.admin.pubkey(), false);

    let payer = Keypair::new();
    ctx.svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    let res = ctx.svm.send_transaction(tx);

    assert_anchor_error(res, anchor_lang::error::ErrorCode::AccountNotSigner);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Input Validation & Guards
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_zero_amount() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_custom_error(res, anchor::error::PremiumBondsError::InsufficientFeeBalance);
}

#[test]
fn test_withdraw_fees_fails_exceeds_available_fees() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Set Huma venue solvency state to cover book liabilities (1M assets / 1M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        1_000_000,
        1_000_000,
    );

    // Set up pool state
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 4_000_000; // Available = 1_000_000
    });

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pool_pda, _) = pool_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda,
        1_000_000,
    );

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_custom_error(res, anchor::error::PremiumBondsError::InsufficientFeeBalance);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDA & Account Constraint Validation
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_wrong_global_config_pda() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        &ctx.svm,
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

    // Swap global_config for an initialized GlobalConfig at a non-canonical PDA
    let (wrong_config, _) = Pubkey::find_program_address(&[b"wrong_global_config"], &anchor::id());
    let config_acc = ctx.svm.get_account(&global_config_pda().0).unwrap();
    ctx.svm.set_account(wrong_config, config_acc).unwrap();
    substitute_account_meta(&mut ix, global_config_pda().0, wrong_config);

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_frozen_for_draw() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Set Huma venue solvency state to cover book liabilities (5M assets / 5M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        5_000_000,
        5_000_000,
    );

    // Set accrued fees and freeze the pool for draw
    let (pool_pda_key, _) = pool_pda(1);
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.is_frozen_for_draw = 1;
    });

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_key,
        5_000_000,
    );

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_custom_error(res, anchor::error::PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_withdraw_fees_fails_wrong_pool_pda() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        &ctx.svm,
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

    // Swap pool for an initialized valid imposter pool (Pool #2)
    let (wrong_pool, _) = pool_pda(2);
    PrizePoolTestBuilder::new(2).inject(&mut ctx.svm);
    substitute_account_meta(&mut ix, pool_pda(1).0, wrong_pool);

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_pool_vault_authority_bump_mismatch() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Corrupt vault_authority_bump inside pool state
    let mut pool = PrizePoolTestBuilder::from_state(&ctx.svm, 1).build();
    pool.vault_authority_bump ^= 1; // Corrupt bump
    PrizePoolTestBuilder::from_pool(pool).inject(&mut ctx.svm);

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_wrong_pst_vault_pda() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    let (wrong_vault, _) = pool_pst_vault_pda(2);
    inject_token_account(&mut ctx.svm, wrong_vault, ctx.pst_mint, pool_pda(2).0, 0);
    substitute_account_meta(&mut ix, pool_pst_vault_pda(1).0, wrong_vault);

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_wrong_huma_program() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let mut ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    substitute_account_meta(&mut ix, huma_program_id(), wrong_huma_prog);

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintAddress);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layout Validation Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_invalid_huma_pool_state_layout() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let (pool_pda_key, _) = pool_pda(1);
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
    });

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_key,
        5_000_000,
    );

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
        &ctx.svm,
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
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidHumaPoolData);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI Failures
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_huma_redemption_error() {
    let mut ctx = setup_e2e();

    // Set Huma venue solvency state to cover book liabilities (5M assets / 5M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        5_000_000,
        5_000_000,
    );

    // Set up pool state
    let (pool_pda, _) = pool_pda(1);
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 0;
        pool.next_redemption_id = 0;
    });

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda,
        5_000_000,
    );

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
        &ctx.svm,
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
    assert_mock_huma_error(res, mock_huma::MockHumaError::SimulatedRedemptionFailure);
}

#[test]
fn test_withdraw_fees_fails_invalid_mode_mint() {
    let mut ctx = setup_e2e();

    // Set up pool state
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(0)
        .with_next_redemption_id(0)
        .inject(&mut ctx.svm);

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
        &ctx.svm,
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
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidModeMint);
}

#[test]
fn test_withdraw_fees_and_claim_e2e() {
    let mut ctx = setup_e2e();
    let (pool_pda, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);

    // Set Huma venue solvency state to cover book liabilities (10M assets / 10M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        10_000_000,
        10_000_000,
    );

    // Setup pool state with accrued fees
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 0;
        pool.next_redemption_id = 0;
    });

    // Set up mock $PST in pool's pst vault (representing Huma yield)
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda,
        10_000_000,
    );

    // Initialize huma_pool_mode_token owned by huma_pool_authority
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    let dummy = Keypair::new().pubkey();

    // 1. Withdraw fees (creates PendingRedemption)
    let ix_withdraw = build_withdraw_fees_ix(
        &ctx.svm,
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

    let meta = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix_withdraw)
        .expect("withdraw_fees should succeed");
    let event = assert_cpi_event::<anchor::events::FeesWithdrawn>(&meta);
    assert_eq!(event.pool_id, 1, "event pool_id matches");
    assert_eq!(event.admin, ctx.admin.pubkey(), "event admin matches");
    assert_eq!(event.amount, 2_000_000, "event amount is 2 USDC");
    assert!(event.pst_shares > 0, "event pst_shares is positive");
    assert_eq!(event.redemption_id, 0, "event redemption_id is 0");
    assert_eq!(event.huma_request_id, 0, "event huma_request_id is 0");

    // Verify PendingRedemption was created with admin (fee wallet owner) as the user
    let pending_pda = pending_redemption_pda(1, 0).0;
    let pending_acct = ctx.svm.get_account(&pending_pda).unwrap();
    let pending_state =
        <anchor::state::PendingRedemption as anchor_lang::AccountDeserialize>::try_deserialize(
            &mut &pending_acct.data[..],
        )
        .unwrap();
    // admin.pubkey() is the owner of the fee_wallet token account
    assert_eq!(pending_state.user, ctx.admin.pubkey());
    assert_eq!(pending_state.amount, 2_000_000);

    // 2. Claim redemption
    // We mock Huma's disburse by transferring underlying USDC into the pool vault and advancing next_request_id.
    // Let's set the Huma PoolState's redemption queue to next_request_id = 1.
    let mut huma_pool_state_data = ctx.svm.get_account(&ctx.huma_pool_state).unwrap().data;
    huma_pool_state_data[250..266].copy_from_slice(&1u128.to_le_bytes()); // next_request_id = 1

    // Set mock assets to 100_000_000 so conversion is 1:1
    huma_pool_state_data[30..46].copy_from_slice(&100_000_000u128.to_le_bytes());

    let mut pool_state_acct = ctx.svm.get_account(&ctx.huma_pool_state).unwrap();
    pool_state_acct.data = huma_pool_state_data;
    ctx.svm
        .set_account(ctx.huma_pool_state, pool_state_acct)
        .unwrap();

    // Fund the pool vault so it can pay out the USDC
    inject_token_account(&mut ctx.svm, pool_vault, ctx.usdc_mint, pool_pda, 5_000_000);

    // Create the admin's token account (destination for claiming fees)
    let admin_usdc = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    let huma = TestHumaAccounts {
        huma_pool_state: ctx.huma_pool_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        ..Default::default()
    };
    // Build and send claim_redemption signed by admin (or crank on behalf of fee wallet owner)
    let ix_claim = build_claim_redemption_ix(
        ctx.admin.pubkey(),
        ctx.admin.pubkey(),
        1,
        0, // redemption_id = 0
        ctx.usdc_mint,
        admin_usdc,
        &huma,
        Some(pool_vault),
    );

    // Admin signs the claim transaction!
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix_claim], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let meta_claim = ctx
        .svm
        .send_transaction(tx)
        .expect("claim_redemption should succeed for fee wallet owner");
    let claim_event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta_claim);
    assert_eq!(claim_event.caller, ctx.admin.pubkey());
    assert_eq!(claim_event.user, ctx.admin.pubkey());
    assert_eq!(
        claim_event.redemption_type,
        anchor::state::RedemptionType::FeeWithdrawal
    );

    // Assert that the admin received the 2 USDC fees
    let balance = read_token_balance(&ctx.svm, admin_usdc);
    assert_eq!(balance, 2_000_000);

    // Assert that the PendingRedemption account was closed (does not exist anymore)
    assert!(ctx.svm.get_account(&pending_pda).is_none());
}

#[test]
fn test_withdraw_fees_fails_invalid_fee_wallet() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let wrong_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    let mut ix = build_withdraw_fees_ix(
        &ctx.svm,
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

    substitute_account_meta(&mut ix, read_pool_state(&ctx.svm, 1).fee_wallet, wrong_wallet);

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidFeeWallet);
}

#[test]
fn test_withdraw_fees_succeeds_from_closed_pool() {
    let mut ctx = setup_e2e();
    let (pool_pda, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);

    // Set Huma venue solvency state to cover book liabilities (10M assets / 10M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        10_000_000,
        10_000_000,
    );

    // Setup pool state with accrued fees and Closed status
    common::mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 0;
        pool.status = anchor::PoolStatus::Closed as u8;
    });

    // Set up mock $PST in pool's pst vault
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda,
        10_000_000,
    );

    // Initialize huma_pool_mode_token owned by huma_pool_authority
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    let dummy = Keypair::new().pubkey();
    let ix = build_withdraw_fees_ix(
        &ctx.svm,
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
    assert!(
        res.is_ok(),
        "Fee withdrawal must succeed from a Closed pool during sunset: {:?}",
        res
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_fees_withdrawn, 2_000_000);
}

#[test]
fn test_withdraw_fees_fails_when_yield_venue_insolvent() {
    let mut ctx = setup_e2e();
    let (pool_pda, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    // Setup pool state with 5,000,000 USDC accrued fees liabilities
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_fees_accrued = 5_000_000;
        pool.total_fees_withdrawn = 0;
        pool.next_redemption_id = 0;
    });

    // Inject 5,000,000 PST into vault
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda,
        5_000_000,
    );

    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    // Impair Huma assets to 2,000,000 with 5,000,000 PST supply (value = 2M < 5M book liabilities)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        2_000_000,
        5_000_000,
    );

    let ix = build_withdraw_fees_ix(
        &ctx.svm,
        ctx.admin.pubkey(),
        1,
        0,
        pool_pst_vault,
        dummy,
        ctx.huma_pool_state,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        huma_pool_mode_token,
        1_000_000,
    );

    let res = send_withdraw_fees(&mut ctx.svm, &ctx.admin, ix);
    assert_custom_error(res, anchor::error::PremiumBondsError::YieldVenueInsolvent);
}
