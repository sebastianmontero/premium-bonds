//! Integration tests for `claim_non_reinvested_winnings` (Huma-based async redemption).
//!
//! Guard tests verify validation logic before CPI is reached.
//! Happy-path tests require a mock-huma program and are marked #[ignore].

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

// ─── Instruction builder ─────────────────────────────────────────────────────

fn build_claim_ix(user: Pubkey, pool_id: u32, pst_mint: Pubkey) -> Instruction {
    build_claim_ix_with_redemption_id(
        user,
        pool_id,
        pst_mint,
        0,
        Pubkey::default(),
        Pubkey::default(),
    )
}

fn build_claim_ix_with_redemption_id(
    user: Pubkey,
    pool_id: u32,
    pst_mint: Pubkey,
    redemption_id: u64,
    huma_pool_state: Pubkey,
    huma_pool_mode_token: Pubkey,
) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &user);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user,
        pool,
        user_winnings,
        pool_pst_vault,
        pending_redemption,
        huma_program: anchor::constants::HUMA_PROGRAM_ID,
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: dummy,
        huma_pool_mode_token,
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
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

struct ClaimCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    huma_pool_state: Pubkey,
    huma_pool_mode_token: Pubkey,
}

fn setup_claim_guard(unclaimed_amount: u64, status: anchor::PoolStatus) -> ClaimCtx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );
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
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 1_000_000_000); // Fund vault with PST to pass Huma transfer

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
    send_claim_with_redemption_id(ctx, pool_id, 0)
}

fn send_claim_with_redemption_id(ctx: &mut ClaimCtx, pool_id: u32, redemption_id: u64) -> TxResult {
    let ix = build_claim_ix_with_redemption_id(
        ctx.user.pubkey(),
        pool_id,
        ctx.pst_mint,
        redemption_id,
        ctx.huma_pool_state,
        ctx.huma_pool_mode_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm.send_transaction(tx)
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

    // Send claim instruction
    let ix = build_claim_ix_with_redemption_id(
        ctx.user.pubkey(),
        1,
        ctx.pst_mint,
        0,
        ctx.huma_pool_state,
        huma_pool_mode_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let meta = ctx
        .svm
        .send_transaction(tx)
        .expect("claim non-reinvested winnings");
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
    let uw_account = ctx.svm.get_account(&user_winnings_key).unwrap();
    let uw = anchor::UserWinnings::try_deserialize(&mut uw_account.data.as_slice()).unwrap();
    assert_eq!(
        uw.unclaimed_non_reinvested_winnings, 0,
        "unclaimed winnings must be cleared"
    );
    assert_eq!(
        uw.total_claimed, 500_000,
        "total_claimed must equal 500_000"
    );

    // Assert PrizePool state updates
    let pool_account = ctx.svm.get_account(&pool_pda(1).0).unwrap();
    let pool = anchor::PrizePool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(
        pool.total_prizes_allocated, 500_000,
        "pool prizes allocated updated"
    ); // 1_000_000 - 500_000
    assert_eq!(
        pool.next_redemption_id, 1,
        "pool next_redemption_id incremented"
    );
    assert_eq!(
        pool.total_pending_redemptions, 500_000,
        "total_pending_redemptions updated"
    );

    // Assert PendingRedemption PDA creation and all fields
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    let pr_account = ctx.svm.get_account(&pending_redemption_key).unwrap();
    let pr = anchor::PendingRedemption::try_deserialize(&mut pr_account.data.as_slice()).unwrap();
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

    let ix = build_claim_ix_with_redemption_id(
        ctx.user.pubkey(),
        1,
        ctx.pst_mint,
        0,
        ctx.huma_pool_state,
        ctx.huma_pool_mode_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
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

    // Send claim instruction on closed pool
    let ix = build_claim_ix_with_redemption_id(
        ctx.user.pubkey(),
        1,
        ctx.pst_mint,
        0,
        ctx.huma_pool_state,
        huma_pool_mode_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let meta = ctx
        .svm
        .send_transaction(tx)
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

    let ix = build_claim_ix_with_redemption_id(
        ctx.user.pubkey(),
        1,
        ctx.pst_mint,
        0,
        ctx.huma_pool_state,
        ctx.huma_pool_mode_token,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::YieldVenueInsolvent);
}
