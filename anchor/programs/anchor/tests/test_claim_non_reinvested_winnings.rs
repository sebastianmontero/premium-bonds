//! Integration tests for `claim_non_reinvested_winnings` (Huma-based async redemption).
//!
//! Guard tests verify validation logic before CPI is reached.
//! Happy-path tests verify the full claim flow with mock Huma program.

use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{account::Account, signature::Keypair, signer::Signer};

mod common;
use common::*;

// ─── Setup ───────────────────────────────────────────────────────────────────

struct ClaimCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    huma_pool_state: Pubkey,
    huma_pool_mode_token: Pubkey,
}

impl ClaimCtx {
    pub fn claim_builder(
        &self,
        pool_id: u32,
        redemption_id: u64,
    ) -> ClaimNonReinvestedWinningsBuilder {
        ClaimNonReinvestedWinningsBuilder::for_pool(pool_id, self.user.pubkey())
            .with_huma_pool_state(self.huma_pool_state)
            .with_huma_mode_mint(self.pst_mint)
            .with_huma_pool_mode_token(self.huma_pool_mode_token)
            .with_redemption_id(pool_id, redemption_id)
    }

    pub fn send_claim(&mut self, pool_id: u32) -> TxResult {
        self.send_claim_with_redemption_id(pool_id, 0)
    }

    pub fn send_claim_with_redemption_id(&mut self, pool_id: u32, redemption_id: u64) -> TxResult {
        let ix = self.claim_builder(pool_id, redemption_id).build_ix();
        send_user_tx(&mut self.svm, &self.user, ix)
    }
}

fn setup_claim_guard(unclaimed_amount: u64, status: anchor::PoolStatus) -> ClaimCtx {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let _ = svm.add_program(
        anchor::constants::HUMA_PROGRAM_ID,
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint_with_supply(&mut svm, pst_mint, 6, 1_000_000_000);

    // Setup and inject valid huma_pool_state stub with matching assets
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state_with_assets(&mut svm, huma_pool_state, 1_000_000_000);

    let pool_key = pool_pda(1).0;
    PrizePoolTestBuilder::new(1)
        .with_token_mint(token_mint)
        .with_status(status)
        .with_huma_pool_state(huma_pool_state)
        .with_solvency_state(0, 1_000_000_000, 0)
        .inject(&mut svm);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 1_000_000_000);

    inject_user_winnings(&mut svm, 1, user.pubkey(), unclaimed_amount, 0, 0);

    // Setup and inject huma_pool_mode_token
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_mode_token,
        pst_mint,
        Pubkey::default(),
        0,
    );

    ClaimCtx {
        svm,
        user,
        token_mint,
        pst_mint,
        huma_pool_state,
        huma_pool_mode_token,
    }
}

fn send_claim(ctx: &mut ClaimCtx, pool_id: u32) -> TxResult {
    ctx.send_claim(pool_id)
}

fn send_claim_with_redemption_id(ctx: &mut ClaimCtx, pool_id: u32, redemption_id: u64) -> TxResult {
    ctx.send_claim_with_redemption_id(pool_id, redemption_id)
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests (validation fires before Huma CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_fails_no_winnings() {
    let mut ctx = setup_claim_guard(0, anchor::PoolStatus::Active);
    let res = send_claim(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::NoWinningsToClaim);
}

#[test]
fn test_claim_fails_pool_paused() {
    let mut ctx = setup_claim_guard(500_000, anchor::PoolStatus::Paused);
    let res = send_claim(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolPaused);
}

#[test]
fn test_claim_fails_total_claimed_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Reinject user winnings with total_claimed = u64::MAX
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 100, u64::MAX, 0);
    let res = send_claim(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_claim_fails_next_redemption_id_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Reinject pool with next_redemption_id = u64::MAX
    PrizePoolTestBuilder::new(1)
        .with_token_mint(ctx.token_mint)
        .with_status(anchor::PoolStatus::Active)
        .with_huma_pool_state(ctx.huma_pool_state)
        .with_solvency_state(0, 1_000_000_000, 0)
        .with_next_redemption_id(u64::MAX)
        .inject(&mut ctx.svm);
    let res = send_claim_with_redemption_id(&mut ctx, 1, u64::MAX);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_claim_fails_invalid_mode_mint() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    let fake_mint = Keypair::new().pubkey();
    inject_mint(&mut ctx.svm, fake_mint, 6);

    ctx.pst_mint = fake_mint;

    let res = send_claim(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidModeMint);
}

fn set_pool_prizes_allocated(svm: &mut LiteSVM, pool_id: u32, amount: u64) {
    PrizePoolTestBuilder::from_state(svm, pool_id)
        .with_prizes_allocated(amount)
        .inject(svm);
}

#[test]
fn test_claim_non_reinvested_winnings_e2e_happy_path() {
    let mut ctx = common::setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    let huma_pool_mode_token = common::create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Setup user winnings with 500_000 unclaimed winnings
    let (user_winnings_key, _) = user_winnings_pda(1, &ctx.user.pubkey());
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.user.pubkey(), 500_000, 0, 0, 0);

    // Update pool total_prizes_allocated = 1_000_000 to prevent MathOverflow underflow
    set_pool_prizes_allocated(&mut ctx.svm, 1, 1_000_000);

    // Fund pool_pst_vault with 1_000_000 PST tokens
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda(1).0,
        1_000_000,
    );
    inject_mint_with_supply(&mut ctx.svm, ctx.pst_mint, 6, 1_000_000);
    inject_huma_pool_state_with_assets(&mut ctx.svm, ctx.huma_pool_state, 1_000_000);

    // Send claim instruction via ClaimNonReinvestedWinningsBuilder
    let ix = ClaimNonReinvestedWinningsBuilder::new(&ctx)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .build_ix();
    let user = clone_keypair(&ctx.user);
    let meta = send_user_tx(&mut ctx.svm, &user, ix).expect("claim non-reinvested winnings");
    let event = assert_cpi_event::<anchor::events::WinningsClaimed>(&meta);
    assert_eq!(
        event.user,
        ctx.user.pubkey(),
        "event user must match claimant"
    );
    assert_eq!(event.pool_id, 1, "event pool_id must match pool");
    assert_eq!(
        event.amount, 500_000,
        "event amount must match claimed winnings"
    );
    assert_eq!(event.redemption_id, 0, "event redemption_id must be 0");
    assert!(event.pst_shares > 0, "event pst_shares must be non-zero");
    assert_eq!(event.huma_request_id, 0, "event huma_request_id must be 0");

    // Assert UserWinnings state updates
    let uw = read_user_winnings(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(
        uw.unclaimed_non_reinvested_winnings, 0,
        "unclaimed winnings must be cleared"
    );
    assert_eq!(
        uw.total_claimed, 500_000,
        "total_claimed must equal 500_000"
    );

    // Assert PrizePool state updates
    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_prizes_allocated, 500_000,
        "pool prizes allocated updated"
    );
    assert_eq!(
        pool.next_redemption_id, 1,
        "pool next_redemption_id incremented"
    );
    assert_eq!(
        pool.total_pending_redemptions, 500_000,
        "total_pending_redemptions updated"
    );

    // Assert PendingRedemption PDA creation and all fields
    let pr = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(pr.pool_id, 1, "pr pool_id matches");
    assert_eq!(pr.redemption_id, 0, "pr redemption_id matches");
    assert_eq!(pr.user, ctx.user.pubkey(), "pr user matches");
    assert_eq!(pr.amount, 500_000, "pr amount matches");
    assert!(pr.pst_shares_locked > 0, "pr pst_shares_locked non-zero");
    assert_eq!(pr.huma_request_id, 0, "pr huma_request_id matches");
    assert_eq!(
        pr.version,
        anchor::PendingRedemption::CURRENT_VERSION,
        "pr version is current"
    );
    assert_eq!(
        pr.redemption_type,
        anchor::state::RedemptionType::PrizeClaim,
        "pr redemption_type is PrizeClaim"
    );
}

#[test]
fn test_claim_non_reinvested_winnings_fails_when_frozen() {
    let mut ctx = setup_claim_guard(100_000, anchor::PoolStatus::Active);
    // Freeze pool for draw
    PrizePoolTestBuilder::new(1)
        .with_token_mint(ctx.token_mint)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_huma_pool_state(ctx.huma_pool_state)
        .with_solvency_state(0, 1_000_000_000, 0)
        .inject(&mut ctx.svm);

    let res = send_claim(&mut ctx, 1);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

#[test]
fn test_claim_non_reinvested_winnings_succeeds_when_pool_closed() {
    let mut ctx = common::setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    let huma_pool_mode_token = common::create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Setup pool in Closed state
    PrizePoolTestBuilder::new(1)
        .with_token_mint(ctx.usdc_mint)
        .with_status(anchor::PoolStatus::Closed)
        .with_huma_pool_state(ctx.huma_pool_state)
        .with_solvency_state(0, 1_000_000_000, 0)
        .inject(&mut ctx.svm);

    // Setup user winnings with 500_000 unclaimed winnings
    let (user_winnings_key, _) = user_winnings_pda(1, &ctx.user.pubkey());
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.user.pubkey(), 500_000, 0, 0, 0);

    // Update pool total_prizes_allocated = 1_000_000
    set_pool_prizes_allocated(&mut ctx.svm, 1, 1_000_000);

    // Fund pool_pst_vault with 1_000_000 PST tokens
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda(1).0,
        1_000_000,
    );
    inject_mint_with_supply(&mut ctx.svm, ctx.pst_mint, 6, 1_000_000);
    inject_huma_pool_state_with_assets(&mut ctx.svm, ctx.huma_pool_state, 1_000_000);

    // Send claim instruction on closed pool via ClaimNonReinvestedWinningsBuilder
    let ix = ClaimNonReinvestedWinningsBuilder::new(&ctx)
        .with_huma_pool_mode_token(huma_pool_mode_token)
        .build_ix();
    let user = clone_keypair(&ctx.user);
    let meta = send_user_tx(&mut ctx.svm, &user, ix)
        .expect("claim non-reinvested winnings on closed pool should succeed");
    let event = assert_cpi_event::<anchor::events::WinningsClaimed>(&meta);
    assert_eq!(event.user, ctx.user.pubkey(), "event user matches claimant");
    assert_eq!(event.pool_id, 1, "event pool_id matches");
    assert_eq!(event.amount, 500_000, "event amount matches");
    assert_eq!(event.redemption_id, 0, "event redemption_id is 0");
    assert!(event.pst_shares > 0, "event pst_shares is positive");
    assert_eq!(event.huma_request_id, 0, "event huma_request_id is 0");

    let uw_account = ctx.svm.get_account(&user_winnings_key).unwrap();
    let uw = anchor::UserWinnings::try_deserialize(&mut uw_account.data.as_slice()).unwrap();
    assert_eq!(
        uw.unclaimed_non_reinvested_winnings, 0,
        "unclaimed winnings cleared"
    );
    assert_eq!(uw.total_claimed, 500_000, "total claimed matches");
}

#[test]
fn test_claim_non_reinvested_winnings_fails_yield_venue_insolvent() {
    let mut ctx = setup_claim_guard(100_000, anchor::PoolStatus::Active);

    // Inject pst_mint with supply > 0 (e.g. 1_000_000)
    inject_mint_with_supply(&mut ctx.svm, ctx.pst_mint, 6, 1_000_000);

    // Inject insolvent Huma pool state: total_assets = 0 (with vec_len = 1)
    inject_huma_pool_state_with_assets(&mut ctx.svm, ctx.huma_pool_state, 0);

    let res = send_claim(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::YieldVenueInsolvent);
}
