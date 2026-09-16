//! Integration tests for the `initialize_huma_lender` instruction.
//!
//! Strategy
//! ─────────
//! Tests load compiled .so binaries for both our anchor program and the mock Huma program.
//! Using LiteSVM, we verify happy paths and all security constraints (admin signer, global config,
//! pool PDAs, pool PST vaults, Huma program ID, token programs, and Huma CPI errors).

use {anchor_lang::prelude::Pubkey, solana_keypair::Keypair, solana_signer::Signer};

mod common;
use common::*;

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-path Scenario
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_succeeds() {
    let mut ctx = setup_e2e();
    let meta = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .send(&mut ctx.svm, &ctx.admin)
        .expect("initialize_huma_lender should succeed");

    let event = assert_log_event::<anchor::events::HumaLenderInitialized>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.admin, ctx.admin.pubkey());
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Control Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_unsigned_admin() {
    let mut ctx = setup_e2e();
    let ix = InitializeHumaLenderBuilder::from_ctx(&ctx).build_ix();

    assert_signer_required(
        &mut ctx.svm,
        ix,
        0,
        &ctx.admin.pubkey(),
        &[],
        "initialize_huma_lender",
        "admin",
    );
}

#[test]
fn test_initialize_huma_lender_fails_unauthorized_admin() {
    let mut ctx = setup_e2e();
    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_admin(hacker.pubkey())
        .send(&mut ctx.svm, &hacker);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedAdmin);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Seed/PDA Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_wrong_global_config_pda() {
    let mut ctx = setup_e2e();
    let wrong_global_config = Keypair::new().pubkey();

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_global_config(wrong_global_config)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::AccountNotInitialized);
}

#[test]
fn test_initialize_huma_lender_fails_wrong_pool_pda() {
    let mut ctx = setup_e2e();
    let wrong_pool = Keypair::new().pubkey();

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_pool(wrong_pool)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(
        res,
        anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram,
    );
}

#[test]
fn test_initialize_huma_lender_fails_pool_vault_authority_bump_mismatch() {
    let mut ctx = setup_e2e();

    // Corrupt the pool state bump
    mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.vault_authority_bump ^= 1;
    });

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx).send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_initialize_huma_lender_fails_wrong_pool_pst_vault_pda() {
    let mut ctx = setup_e2e();
    let wrong_pst_vault = Keypair::new().pubkey();

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_pool_pst_vault(wrong_pst_vault)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::AccountNotInitialized);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Huma Program Check
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_invalid_huma_program() {
    let mut ctx = setup_e2e();
    let wrong_huma_program = Keypair::new().pubkey();

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_huma_program(wrong_huma_program)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintAddress);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token Program Check
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_invalid_pst_token_program() {
    let mut ctx = setup_e2e();
    let wrong_pst_token_program = anchor_spl::associated_token::ID;

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_pst_token_program(wrong_pst_token_program)
        .send(&mut ctx.svm, &ctx.admin);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::InvalidProgramId);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI Failure Check
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_huma_cpi_error() {
    let mut ctx = setup_e2e();

    // Use FAIL_CREATE_LENDER_PUBKEY as the huma_config account to trigger simulated failure
    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_huma_config(FAIL_CREATE_LENDER_PUBKEY)
        .send(&mut ctx.svm, &ctx.admin);
    assert_mock_huma_error(res, mock_huma::MockHumaError::SimulatedCreateLenderFailure);
}

/// INV-INIT-001: Supplying an invalid/mismatched Huma mode mint ($PST mint) must fail address constraint.
#[test]
fn test_initialize_huma_lender_fails_invalid_mode_mint() {
    let mut ctx = setup_e2e();
    let fake_pst_mint = create_spl_mint(&mut ctx.svm, &ctx.admin, &ctx.admin.pubkey(), 6);

    let res = InitializeHumaLenderBuilder::from_ctx(&ctx)
        .with_huma_mode_mint(fake_pst_mint)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidModeMint);
}
