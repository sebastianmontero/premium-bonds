//! Integration tests for the `withdraw_fees` admin instruction.
//!
//! Strategy
//! ─────────
//! Tests load compiled .so binaries for both our anchor program and the mock Huma program.
//! Using LiteSVM, we verify happy paths (1:1 and non-1:1 exchange rates), access control,
//! validation guards, and PDA/account constraints.

use {
    anchor::error::PremiumBondsError, anchor_lang::error::ErrorCode, litesvm::LiteSVM,
    solana_keypair::Keypair, solana_program::pubkey::Pubkey, solana_sdk::account::Account,
    solana_signer::Signer,
};

mod common;
use common::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Happy Path Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_succeeds() {
    let mut ctx = setup_e2e();

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
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(0)
        .with_next_redemption_id(0)
        .inject(&mut ctx.svm);

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_amount(2_000_000)
        .send(&mut ctx.svm, &ctx.admin);
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
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(0)
        .with_next_redemption_id(0)
        .inject(&mut ctx.svm);

    // Withdraw 2 USDC (2_000_000). At 1 PST = 2 USDC, this should equal 1 PST (1_000_000 shares)
    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_amount(2_000_000)
        .send(&mut ctx.svm, &ctx.admin);
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

    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_admin(hacker.pubkey())
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &hacker);

    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_withdraw_fees_fails_unsigned_admin() {
    let mut ctx = setup_e2e();

    let ix = WithdrawFeesBuilder::new(&ctx)
        .with_amount(1_000_000)
        .build_default_ix();

    assert_signer_required_dynamic(&mut ctx.svm, ix, &ctx.admin.pubkey(), "withdraw_fees");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Input Validation & Guards
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_zero_amount() {
    let mut ctx = setup_e2e();

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_amount(0)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InsufficientFeeBalance);
}

#[test]
fn test_withdraw_fees_fails_exceeds_available_fees() {
    let mut ctx = setup_e2e();

    // Set Huma venue solvency state to cover book liabilities (1M assets / 1M supply)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        1_000_000,
        1_000_000,
    );

    // Set up pool state
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(4_000_000) // Available = 1_000_000
        .inject(&mut ctx.svm);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pool_pda, _) = pool_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda,
        1_000_000,
    );

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_amount(1_000_001) // 1 micro-USDC over limit
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InsufficientFeeBalance);
}

// ═══════════════════════════════════════════════════════════════════════════════
// PDA & Account Constraint Validation
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_wrong_global_config_pda() {
    let mut ctx = setup_e2e();

    // Swap global_config for an initialized GlobalConfig at a non-canonical PDA
    let (wrong_config, _) = Pubkey::find_program_address(&[b"wrong_global_config"], &anchor::id());
    let config_acc = ctx.svm.get_account(&global_config_pda().0).unwrap();
    ctx.svm.set_account(wrong_config, config_acc).unwrap();

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_global_config(wrong_config)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_frozen_for_draw() {
    let mut ctx = setup_e2e();

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
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_frozen(true)
        .inject(&mut ctx.svm);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_key,
        5_000_000,
    );

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_withdraw_fees_fails_wrong_pool_pda() {
    let mut ctx = setup_e2e();

    // Swap pool for an initialized valid imposter pool (Pool #2)
    let (wrong_pool, _) = pool_pda(2);
    PrizePoolTestBuilder::new(2).inject(&mut ctx.svm);

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_pool(wrong_pool)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_pool_vault_authority_bump_mismatch() {
    let mut ctx = setup_e2e();

    // Corrupt vault_authority_bump inside pool state
    let mut pool = PrizePoolTestBuilder::from_state(&ctx.svm, 1).build();
    pool.vault_authority_bump ^= 1; // Corrupt bump
    PrizePoolTestBuilder::from_pool(pool).inject(&mut ctx.svm);

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_wrong_pst_vault_pda() {
    let mut ctx = setup_e2e();

    // Swap pool_pst_vault for a random token account PDA
    let (wrong_vault, _) = pool_pst_vault_pda(2);
    inject_token_account(&mut ctx.svm, wrong_vault, ctx.pst_mint, pool_pda(2).0, 0);

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_pool_pst_vault(wrong_vault)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, ErrorCode::ConstraintSeeds);
}

#[test]
fn test_withdraw_fees_fails_wrong_huma_program() {
    let mut ctx = setup_e2e();

    // Swap huma_program for a random key
    let wrong_huma_prog = Keypair::new().pubkey();

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_program(wrong_huma_prog)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, ErrorCode::ConstraintAddress);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layout Validation Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_withdraw_fees_fails_invalid_huma_pool_state_layout() {
    let mut ctx = setup_e2e();

    let (pool_pda_key, _) = pool_pda(1);
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .inject(&mut ctx.svm);

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

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolData);
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
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(0)
        .with_next_redemption_id(0)
        .inject(&mut ctx.svm);

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
    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_config(FAIL_REDEMPTION_PUBKEY)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);

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

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_mode_mint(fake_mint)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);

    assert_custom_error(res, PremiumBondsError::InvalidModeMint);
}

#[test]
fn test_withdraw_fees_and_claim_e2e() {
    let mut ctx = setup_e2e();
    let (pool_pda, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);

    // 1. User buys 10 bonds (10_000_000 USDC principal -> 10 pending tickets for cycle 0)
    send_e2e_buy_bonds(&mut ctx, 10).expect("buy bonds should succeed");

    // 2. Warp past cycle 0 and harvest to merge pending tickets into active tickets for cycle 1
    warp_forward_seconds(&mut ctx.svm, 24 * 3600 + 1);
    send_e2e_harvest_yield_and_commit(&mut ctx).expect("cycle 0 harvest should succeed");

    // 3. Configure pool fee_basis_points = 1000 (10%) for cycle 1 and warp past cycle 1 duration
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fee_basis_points(1000)
        .inject(&mut ctx.svm);
    warp_forward_seconds(&mut ctx.svm, 24 * 3600 + 1);

    // 4. Accrue authentic yield in Huma: total_assets = 30_000_000 with 10_000_000 PST supply (20 USDC yield)
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 30_000_000);

    // 5. Crank harvests yield for cycle 1 -> accrues 2_000_000 fees and freezes pool for draw
    send_e2e_harvest_yield_and_commit(&mut ctx).expect("cycle 1 harvest yield should succeed");
    let pool_after_harvest = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_after_harvest.total_fees_accrued, 2_000_000);
    assert_eq!(pool_after_harvest.is_frozen_for_draw, 1);

    // 6. Crank prepares draw and reveals randomness for cycle 1 to pick winners and unfreeze pool
    send_e2e_prepare_draw(&mut ctx, 1, 1, 10).expect("prepare draw should succeed");
    let dc = read_draw_cycle_state(&ctx.svm, 1, 1);
    send_e2e_reveal_and_pick_winners(&mut ctx, 1, 1, dc.randomness_account)
        .expect("reveal and pick winners should succeed");

    let pool_after_reveal = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_after_reveal.is_frozen_for_draw, 0);

    // 7. Admin withdraws fees (creates PendingRedemption 0 for 2_000_000 USDC)
    let admin_kp = clone_keypair(&ctx.admin);
    let meta = send_e2e_withdraw_fees_with_admin(&mut ctx, &admin_kp, 2_000_000)
        .expect("withdraw_fees should succeed");

    let event = assert_cpi_event::<anchor::events::FeesWithdrawn>(&meta);
    assert_eq!(event.pool_id, 1, "event pool_id matches");
    assert_eq!(event.admin, ctx.admin.pubkey(), "event admin matches");
    assert_eq!(event.amount, 2_000_000, "event amount is 2 USDC");
    assert!(event.pst_shares > 0, "event pst_shares is positive");
    assert_eq!(event.redemption_id, 0, "event redemption_id is 0");
    assert_eq!(event.huma_request_id, 0, "event huma_request_id is 0");

    // Verify PendingRedemption was created with admin (fee wallet owner) as the user
    let pending_state = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(pending_state.user, ctx.admin.pubkey());
    assert_eq!(pending_state.amount, 2_000_000);

    // 7. Settle Huma redemption and disburse USDC to pool vault
    set_mock_huma_next_request_id(&mut ctx.svm, ctx.huma_pool_state, 1);
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 2_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Fund the pool vault so it can pay out the USDC
    inject_token_account(&mut ctx.svm, pool_vault, ctx.usdc_mint, pool_pda, 5_000_000);

    // Create the admin's token account (destination for claiming fees)
    let admin_usdc = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    // 8. Admin claims fee redemption
    let meta_claim = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &admin_kp,
        admin_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
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
    let (pending_pda, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_pda).is_none());
}

#[test]
fn test_withdraw_fees_fails_invalid_fee_wallet() {
    let mut ctx = setup_e2e();

    let wrong_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_fee_wallet(wrong_wallet)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::InvalidFeeWallet);
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
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(0)
        .with_status(anchor::PoolStatus::Closed)
        .inject(&mut ctx.svm);

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

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_amount(2_000_000)
        .send(&mut ctx.svm, &ctx.admin);
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

    // Setup pool state with 5,000,000 USDC accrued fees liabilities
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_fees_accrued(5_000_000)
        .with_fees_withdrawn(0)
        .with_next_redemption_id(0)
        .inject(&mut ctx.svm);

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

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .with_amount(1_000_000)
        .send(&mut ctx.svm, &ctx.admin);

    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);
}
