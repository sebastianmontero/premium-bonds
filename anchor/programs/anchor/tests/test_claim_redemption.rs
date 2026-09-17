//! Integration tests for the `claim_redemption` instruction.
//!
//! Guard tests verify that basic validation rules (like ownership, pool, mint,
//! and program address constraints) fire and fail before calling the Huma CPI.
//! E2E tests verify the full flow: buy bonds -> sell bonds -> inject Huma lender state -> claim redemption.

use anchor_lang::{
    prelude::AccountMeta, AccountDeserialize, AccountSerialize, AnchorDeserialize, InstructionData,
    Space, ToAccountMetas,
};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{account::Account, signature::Keypair, signer::Signer};

mod common;
use common::*;

// ─── Guard Test Setup ────────────────────────────────────────────────────────

struct ClaimGuardCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pool_vault: Pubkey,
    user_token_account: Pubkey,
    huma_config: Pubkey,
    huma_pool_config: Pubkey,
    huma_pool_state: Pubkey,
    huma_mode_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_authority: Pubkey,
    huma_pool_underlying_token: Pubkey,
}

fn setup_claim_redemption_guard(
    pool_id: u32,
    redemption_id: u64,
    redemption_amount: u64,
    redemption_owner: Option<Pubkey>,
) -> ClaimGuardCtx {
    let mut svm = setup_svm();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let pool_key = pool_pda(pool_id).0;

    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        Pubkey::default(),
        anchor::PoolStatus::Active,
        false,
    );

    let (pool_vault, _) = pool_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 0);

    let owner = redemption_owner.unwrap_or_else(|| user.pubkey());

    inject_pending_redemption(
        &mut svm,
        pool_id,
        redemption_id,
        owner,
        redemption_amount,
        redemption_amount,
    );

    let user_token_account = create_spl_token_account(&mut svm, &user, &token_mint, &user.pubkey());

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let dummy = Keypair::new().pubkey();

    ClaimGuardCtx {
        svm,
        user,
        token_mint,
        pool_vault,
        user_token_account,
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: dummy,
        huma_pool_underlying_token: dummy,
    }
}

impl ClaimGuardCtx {
    pub fn claim_builder(
        &self,
        pool_id: u32,
        redemption_id: u64,
        caller: Pubkey,
    ) -> ClaimRedemptionBuilder {
        ClaimRedemptionBuilder::for_redemption(pool_id, redemption_id, caller, self.user.pubkey())
            .with_token_mint(self.token_mint)
            .with_pool_vault_account(self.pool_vault)
            .with_user_token_account(self.user_token_account)
            .with_huma_pool_state(self.huma_pool_state)
    }

    pub fn send_claim(
        &mut self,
        caller_kp: &Keypair,
        pool_id: u32,
        redemption_id: u64,
    ) -> TxResult {
        let ix = self
            .claim_builder(pool_id, redemption_id, caller_kp.pubkey())
            .build_ix();
        send_user_tx(&mut self.svm, caller_kp, ix)
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard Tests (Validation checks before any Huma CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_redemption_fails_wrong_user() {
    let wrong_user = Pubkey::new_unique();
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, Some(wrong_user));
    let user_kp = clone_keypair(&ctx.user);
    // User ctx.user is unauthorized because the pending redemption owner is wrong_user.
    let res = ctx.send_claim(&user_kp, 1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRedemptionOwner,
    );
}

#[test]
fn test_claim_redemption_fails_token_mint_mismatch() {
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, None);
    let user_kp = clone_keypair(&ctx.user);
    let wrong_mint = Keypair::new().pubkey();
    inject_mint(&mut ctx.svm, wrong_mint, 6);
    let res = ctx
        .claim_builder(1, 0, user_kp.pubkey())
        .with_token_mint(wrong_mint)
        .send(&mut ctx.svm, &user_kp);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintAddress);
}

#[test]
fn test_claim_redemption_fails_pool_id_mismatch() {
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, None);
    let user_kp = clone_keypair(&ctx.user);
    // Use pool_id = 2 instead of 1. Pool 2 account is not initialized (owned by system program).
    let res = ctx.send_claim(&user_kp, 2, 0);
    assert_anchor_error(
        res,
        anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram,
    );
}

#[test]
fn test_claim_redemption_fails_huma_program_mismatch() {
    let mut ctx = setup_claim_redemption_guard(1, 0, 1_000_000, None);
    let user_kp = clone_keypair(&ctx.user);
    let wrong_huma_program = Pubkey::new_unique();
    let res = ctx
        .claim_builder(1, 0, user_kp.pubkey())
        .with_huma_program(wrong_huma_program)
        .send(&mut ctx.svm, &user_kp);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintAddress);
}

// ═════════════════════════════════════════════════════════════════════════════
// E2E Happy Path & Failure Tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_redemption_e2e_happy_path() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund Huma underlying token vault with USDC so disburse can complete
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    // Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 90_000_000);

    // Inject simulated Huma lender state with 3 USDC settled
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    let meta = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("claim redemption should succeed");
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(
        event.caller,
        user_a.pubkey(),
        "RedemptionClaimed event caller must match claimer"
    );
    assert_eq!(
        event.user,
        user_a.pubkey(),
        "RedemptionClaimed event user must match user_a"
    );
    assert_eq!(
        event.redemption_type,
        anchor::state::RedemptionType::BondSale,
        "RedemptionClaimed event type must be BondSale"
    );

    // User A should have received 3 USDC back (93 USDC total)
    assert_eq!(
        read_token_balance(&ctx.svm, user_a_usdc),
        93_000_000,
        "User A USDC balance must equal 93 USDC after claiming 3 USDC"
    );

    // PendingRedemption PDA should be closed and its rent/account space deleted
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(
        ctx.svm.get_account(&pending_redemption_key).is_none(),
        "PendingRedemption account must be closed after claim"
    );
}

#[test]
fn test_claim_redemption_fails_insufficient_settled_amount() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    // Inject lender state with insufficient settled amount (500_000 USDC < 1_000_000 USDC needed)
    inject_lender_state(&mut ctx.svm, huma_lender_state, 500_000);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::HumaRedemptionNotSettled,
    );

    // PendingRedemption PDA should NOT be closed
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_some());
}

#[test]
fn test_claim_redemption_fails_simulated_disburse_failure() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 1_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim with FAIL_DISBURSE_PUBKEY to trigger simulated Huma error
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        FAIL_DISBURSE_PUBKEY,
        huma_lender_state,
    );

    assert_mock_huma_error(res, mock_huma::MockHumaError::SimulatedDisburseFailure);

    // PendingRedemption PDA should NOT be closed
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_some());
}

fn set_pool_prizes_allocated(svm: &mut LiteSVM, pool_id: u32, amount: u64) {
    PrizePoolTestBuilder::from_state(svm, pool_id)
        .with_prizes_allocated(amount)
        .inject(svm);
}

fn send_e2e_claim_winnings_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_mode_token: Pubkey,
) -> TxResult {
    let mut builder = ClaimNonReinvestedWinningsBuilder::new(ctx)
        .with_user(&user.pubkey())
        .with_huma_pool_mode_token(huma_pool_mode_token);
    if huma_config != Pubkey::default() {
        builder = builder.with_huma_config(huma_config);
    }
    if huma_lender_state != Pubkey::default() {
        builder = builder.with_huma_lender_state(huma_lender_state);
    }
    send_user_tx(&mut ctx.svm, user, builder.build_ix())
}

#[test]
fn test_claim_redemption_rounding_error_failure() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Manipulate Huma pool state: total_assets = 10,000,030, pst_supply = 10,000,000
    // Yield rate is > 1:1 (approx 1.000003 USDC per share)
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 10_000_030);

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> target USDC = 3,000,000
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let pending_data = read_pending_redemption(&ctx.svm, 1, 0);

    // S = ceil(3,000,000 * 10,000,000 / 10,000,030) = 2,999,992 shares
    // This assertion verifies that ceiling behavior is applied.
    assert_eq!(pending_data.pst_shares_locked, 2_999_992);

    // Huma payout calculation on old code:
    // D = floor(2,999,991 * 10,000,030 / 10,000,000) = 2,999,999 USDC
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 2_999_999);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption - MUST SUCCEED because transfer amount is defensively clamped
    // to available pool_vault_account balance (2,999,999 USDC), preventing bricked funds.
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    let meta = res.expect("claim redemption with 1-unit rounding deficit should succeed due to vault clamping");
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(
        event.amount, 2_999_999,
        "RedemptionClaimed event amount must truthfully report actual disbursed amount"
    );
    // User started with 90_000_000 USDC and received the clamped 2_999_999 USDC
    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 92_999_999);
}

#[test]
fn test_claim_redemption_case_a_1_to_1() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    // Verify locked shares (exactly 3,000,000 for 1:1)
    let pending_data = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(
        pending_data.pst_shares_locked, 3_000_000,
        "Pending redemption locked PST shares must equal 3,000,000"
    );

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("Case A: 1:1 redemption claim should succeed");

    assert_eq!(
        read_token_balance(&ctx.svm, user_a_usdc),
        93_000_000,
        "User A USDC balance must equal 93 USDC after 1:1 redemption claim"
    );
}

#[test]
fn test_claim_redemption_case_b_accrued_yield() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        15_000_000, // Mint enough USDC in Huma pool underlying token to cover all redemptions
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Manipulate Huma pool state: total_assets = 12_000_030, pst_supply = 10,000,000
    // Yield rate is > 1:1 (approx 1.200003 USDC per share)
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 12_000_030);

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // ── Operation 1: Sell 3 pending bonds -> target USDC = 3,000,000 ──
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let pending_data0 = read_pending_redemption(&ctx.svm, 1, 0);

    // Ceiling expectation:
    // S = ceil(3,000,000 * 10,000,000 / 12,000,030) = 2,499,994 shares
    assert_eq!(pending_data0.pst_shares_locked, 2_499_994);

    let huma_lender_state0 = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state0, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption 0
    let meta = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state0,
    )
    .expect("Redemption 0 should succeed");
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(event.caller, user_a.pubkey(), "event caller matches user_a");
    assert_eq!(event.user, user_a.pubkey(), "event user matches user_a");
    assert_eq!(event.pool_id, 1, "event pool_id matches");
    assert_eq!(
        event.amount, 3_000_000,
        "event amount matches sold principal"
    );
    assert_eq!(event.redemption_id, 0, "event redemption_id is 0");
    assert_eq!(
        event.redemption_type,
        anchor::state::RedemptionType::BondSale,
        "event redemption_type is BondSale"
    );
    assert!(event.pst_shares_locked > 0, "pst_shares_locked is positive");
    assert_eq!(event.huma_request_id, 0, "huma_request_id is 0");
    assert!(event.requested_at > 0, "requested_at timestamp is valid");
    assert!(event.timestamp > 0, "event timestamp is valid");

    assert_eq!(
        read_token_balance(&ctx.svm, user_a_usdc),
        93_000_000,
        "user_a USDC balance matches 93 USDC"
    );

    // ── Operation 2: Claim 2,000,000 USDC winnings ──
    set_pool_prizes_allocated(&mut ctx.svm, 1, 2_000_000);
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, user_a.pubkey(), 2_000_000, 0, 0, 0);

    send_e2e_claim_winnings_for_user(
        &mut ctx,
        &user_a,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let pending_data1 = read_pending_redemption(&ctx.svm, 1, 1);

    // Ceiling expectation:
    // S = ceil(2,000,000 * 10,000,000 / 12,000,030) = 1,666,663 shares
    assert_eq!(pending_data1.pst_shares_locked, 1_666_663);

    let huma_lender_state1 = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state1, 2_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption 1
    let meta1 = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        1,
        Pubkey::default(),
        huma_lender_state1,
    )
    .expect("Redemption 1 (winnings) should succeed");
    let event1 = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta1);
    assert_eq!(event1.caller, user_a.pubkey());
    assert_eq!(event1.user, user_a.pubkey());
    assert_eq!(
        event1.redemption_type,
        anchor::state::RedemptionType::PrizeClaim
    );

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 95_000_000);

    // ── Operation 3: Sell remaining 7 pending bonds -> target USDC = 7,000,000 ──
    // The remaining tickets occupy indices 0..6 in the pending registry
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        7,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let pending_data2 = read_pending_redemption(&ctx.svm, 1, 2);

    // Ceiling expectation:
    // S = ceil(7,000,000 * 10,000,000 / 12,000,030) = 5,833,319 shares
    assert_eq!(pending_data2.pst_shares_locked, 5_833_319);

    let huma_lender_state2 = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state2, 7_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption 2
    let meta2 = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        2,
        Pubkey::default(),
        huma_lender_state2,
    )
    .expect("Redemption 2 (remaining bonds) should succeed");
    let event2 = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta2);
    assert_eq!(event2.caller, user_a.pubkey());
    assert_eq!(event2.user, user_a.pubkey());
    assert_eq!(
        event2.redemption_type,
        anchor::state::RedemptionType::BondSale
    );

    // Total claimed should be user's start balance (90 USDC) + 10 USDC (bonds principal) + 2 USDC (winnings) = 102 USDC
    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 102_000_000);

    // Vault should have 0 USDC left
    let (pool_vault, _) = pool_vault_pda(1);
    assert_eq!(read_token_balance(&ctx.svm, pool_vault), 0);
}

#[test]
fn test_claim_redemption_e2e_permissionless_crank() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    // Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let user_sol_before = ctx.svm.get_account(&user_a.pubkey()).unwrap().lamports;

    // Crank keypair that executes the transaction
    let crank = Keypair::new();
    ctx.svm.airdrop(&crank.pubkey(), 1_000_000_000).unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Crank calls claim redemption on behalf of user_a
    let meta = send_e2e_claim_redemption_full(
        &mut ctx,
        &crank,
        user_a.pubkey(),
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("crank claim redemption should succeed");
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(event.caller, crank.pubkey());
    assert_eq!(event.user, user_a.pubkey());
    assert_eq!(
        event.redemption_type,
        anchor::state::RedemptionType::BondSale
    );

    // User A receives 3 USDC (93 USDC total)
    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 93_000_000);

    // User A received the PDA rent refund (lamports increased)
    let user_sol_after = ctx.svm.get_account(&user_a.pubkey()).unwrap().lamports;
    assert!(
        user_sol_after > user_sol_before,
        "User should have received the closed pending redemption PDA rent refund"
    );

    // PendingRedemption PDA closed
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_none());
}

#[test]
fn test_claim_redemption_fails_diverted_token_account() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let crank = Keypair::new();
    ctx.svm.airdrop(&crank.pubkey(), 1_000_000_000).unwrap();

    // Attacker crank tries to pass their own token account as the recipient
    let crank_usdc =
        create_spl_token_account(&mut ctx.svm, &crank, &ctx.usdc_mint, &crank.pubkey());

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let res = send_e2e_claim_redemption_full(
        &mut ctx,
        &crank,
        user_a.pubkey(),
        crank_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintTokenOwner);
}

#[test]
fn test_claim_redemption_fails_on_double_claim() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let user_a_usdc =
        create_spl_token_account(&mut ctx.svm, &user_a, &ctx.usdc_mint, &user_a.pubkey());

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // First claim succeeds and closes the pending_redemption account (close = beneficiary)
    let meta1 = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(meta1.is_ok(), "First claim redemption must succeed");

    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(
        ctx.svm.get_account(&pending_redemption_key).is_none(),
        "Pending redemption account must be closed"
    );

    // Second claim fails because the account is already closed and cannot be re-executed
    ctx.svm.expire_blockhash();
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert_anchor_error(res, anchor_lang::error::ErrorCode::AccountNotInitialized);
}

#[test]
fn test_claim_redemption_fails_pending_redemptions_underflow() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let user_a_usdc =
        create_spl_token_account(&mut ctx.svm, &user_a, &ctx.usdc_mint, &user_a.pubkey());

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Corrupt pool state: total_pending_redemptions is smaller than redemption amount (3_000_000)
    common::mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.total_pending_redemptions = 1_000_000;
    });

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_claim_redemption_succeeds_while_pool_frozen() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let user_a_usdc =
        create_spl_token_account(&mut ctx.svm, &user_a, &ctx.usdc_mint, &user_a.pubkey());

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Freeze pool for draw
    common::mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.is_frozen_for_draw = 1;
    });

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert!(
        res.is_ok(),
        "Claiming settled redemption must succeed even while pool is frozen for draw: {:?}",
        res
    );
}

#[test]
fn test_claim_redemption_fails_when_pool_paused() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let user_a_usdc =
        create_spl_token_account(&mut ctx.svm, &user_a, &ctx.usdc_mint, &user_a.pubkey());

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Pause the pool
    send_pause_pool(&mut ctx.svm, &ctx.admin, 1).expect("pause_pool should succeed");

    // Attempt claim_redemption while paused -> MUST FAIL with PoolPaused
    let ix = ClaimRedemptionBuilder::new(&ctx)
        .with_user(&user_a.pubkey(), user_a_usdc)
        .with_caller(user_a.pubkey())
        .with_redemption_id(0)
        .build_ix();
    let res = send_user_tx(&mut ctx.svm, &user_a, ix);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolPaused);

    // Unpause pool -> claim_redemption succeeds
    ctx.svm.expire_blockhash();
    send_unpause_pool(&mut ctx.svm, &ctx.admin, 1).expect("unpause_pool should succeed");

    let res_ok = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(
        res_ok.is_ok(),
        "Claiming after unpause must succeed: {:?}",
        res_ok
    );
}

// ─── Bounded Solvency Dust Settlement Tests ─────────────────────────────────

// Vector V2: Surplus Vault Leaves Excess
#[test]
fn test_claim_redemption_surplus_vault_leaves_excess() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        20_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();
    let user_a_usdc = ctx.user_usdc_account;

    // Disburse 10,000,000 into pool vault (3,000,000 redemption + 7,000,000 surplus)
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 10_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    let meta = res.expect("claim redemption with surplus vault balance must succeed");
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(
        event.amount, 3_000_000,
        "Must disburse exactly redemption_amount"
    );
    assert_eq!(
        read_token_balance(&ctx.svm, user_a_usdc),
        93_000_000,
        "User must receive exactly 3 USDC"
    );
    let (pool_vault, _) = pool_vault_pda(1);
    assert_eq!(
        read_token_balance(&ctx.svm, pool_vault),
        7_000_000,
        "Vault must retain 7 USDC surplus"
    );
}

// Vector V4: Max Bounded Dust Tolerance Succeeds
#[test]
fn test_claim_redemption_max_dust_tolerance_succeeds() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();
    let user_a_usdc = ctx.user_usdc_account;

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(
        &mut ctx.svm,
        huma_lender_state,
        3_000_000 - anchor::constants::SOLVENCY_DUST_TOLERANCE,
    );
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    let meta = res.expect(
        "claim redemption at exact dust tolerance boundary (1,000 deficit) must succeed",
    );
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(
        event.amount, 2_999_000,
        "Disbursed amount must equal 2_999_000"
    );
    assert_eq!(
        read_token_balance(&ctx.svm, user_a_usdc),
        92_999_000,
        "User balance must match clamped transfer"
    );
}

// Vector V5 & V7: Exceeds Dust Tolerance by 1 Base Unit Fails & Preserves State
#[test]
fn test_claim_redemption_exceeds_dust_tolerance_fails() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();
    let user_a_usdc = ctx.user_usdc_account;

    let huma_lender_state = Keypair::new().pubkey();
    // 1,001 deficit (exceeds 1,000 tolerance by 1 base unit)
    inject_lender_state(
        &mut ctx.svm,
        huma_lender_state,
        3_000_000 - (anchor::constants::SOLVENCY_DUST_TOLERANCE + 1),
    );
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InsufficientVaultBalance,
    );

    // Vector V7 Invariant Proof: State rolled back cleanly
    let pending_data = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(
        pending_data.amount, 3_000_000,
        "PendingRedemption amount must remain untouched"
    );
    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_pending_redemptions, 3_000_000,
        "Pool total_pending_redemptions liability must remain intact"
    );
}

// Vector V6A: Normal Redemption with Empty Vault Fails
#[test]
fn test_claim_redemption_empty_vault_fails() {
    let mut ctx = setup_e2e();
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();
    let user_a_usdc = ctx.user_usdc_account;

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 0);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InsufficientVaultBalance,
    );
}

// Vector V6B: Sub-Tolerance Micro-Redemption with Zero Vault Succeeds & Recovers Rent
#[test]
fn test_claim_redemption_sub_tolerance_zero_vault_succeeds_and_refunds_rent() {
    let mut ctx = setup_e2e();
    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;
    let initial_user_sol = ctx.svm.get_balance(&user_a.pubkey()).unwrap();

    // Inject a sub-tolerance pending redemption (500 base units <= SOLVENCY_DUST_TOLERANCE)
    let pda = inject_pending_redemption(&mut ctx.svm, 1, 99, user_a.pubkey(), 500, 500);

    // Update pool state to reflect the injected liability
    mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_pending_redemptions = 500;
        pool.next_redemption_id = 100;
    });

    // Pool vault balance is 0
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 0);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim must succeed: 500 deficit is within the 1,000 dust tolerance threshold
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        99,
        Pubkey::default(),
        huma_lender_state,
    );
    let meta = res.expect(
        "sub-tolerance redemption with empty vault must succeed under dust tolerance",
    );

    // Truthful event reporting: disbursed 0
    let event = assert_cpi_event::<anchor::events::RedemptionClaimed>(&meta);
    assert_eq!(event.amount, 0, "Emitted amount must be 0");
    assert_eq!(
        read_token_balance(&ctx.svm, user_a_usdc),
        100_000_000,
        "USDC token balance unchanged"
    );

    // Account closed and rent refunded to user
    assert!(
        ctx.svm.get_account(&pda).is_none(),
        "PendingRedemption PDA must be closed"
    );
    assert!(
        ctx.svm.get_balance(&user_a.pubkey()).unwrap() > initial_user_sol,
        "User must receive rent refund from closed PendingRedemption"
    );
}
