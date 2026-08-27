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

fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    status: anchor::PoolStatus,
) -> Pubkey {
    inject_pool_with_next_redemption_id(svm, pool_id, token_mint, status, 0)
}

fn inject_pool_with_next_redemption_id(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    status: anchor::PoolStatus,
    next_redemption_id: u64,
) -> Pubkey {
    use anchor_lang::Discriminator;
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: status as u8,
        total_deposited_principal: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 1_000_000_000,
        next_redemption_id,
        total_pending_redemptions: 0,
        total_prizes_distributed: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: 0,
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10],
        prize_tiers_count: 0,
        _padding: [0; 3],
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
    inject_mint(&mut svm, pst_mint, 6);

    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, status);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 1_000_000_000); // Fund vault with PST to pass Huma transfer

    inject_user_winnings(&mut svm, 1, user.pubkey(), unclaimed_amount, 0, 0);

    // Setup and inject valid huma_pool_state stub
    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

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

fn send_claim(ctx: &mut ClaimCtx, pool_id: u32) -> Result<(), String> {
    send_claim_with_redemption_id(ctx, pool_id, 0)
}

fn send_claim_with_redemption_id(
    ctx: &mut ClaimCtx,
    pool_id: u32,
    redemption_id: u64,
) -> Result<(), String> {
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
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests (validation fires before Huma CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_fails_no_winnings() {
    let mut ctx = setup_claim_guard(0, anchor::PoolStatus::Active);
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("NoWinningsToClaim"), "got: {err}");
}

#[test]
fn test_claim_fails_pool_paused() {
    let mut ctx = setup_claim_guard(500_000, anchor::PoolStatus::Paused);
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("PoolPaused"), "got: {err}");
}

#[test]
fn test_claim_fails_total_claimed_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Reinject user winnings with total_claimed = u64::MAX
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 100, u64::MAX, 0);
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_claim_fails_next_redemption_id_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Reinject pool with next_redemption_id = u64::MAX
    inject_pool_with_next_redemption_id(
        &mut ctx.svm,
        1,
        ctx.token_mint,
        anchor::PoolStatus::Active,
        u64::MAX,
    );
    let err = send_claim_with_redemption_id(&mut ctx, 1, u64::MAX).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_claim_fails_invalid_mode_mint() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    let fake_mint = Keypair::new().pubkey();
    inject_mint(&mut ctx.svm, fake_mint, 6);

    ctx.pst_mint = fake_mint;

    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("InvalidModeMint"),
        "Expected InvalidModeMint, got: {err}"
    );
}

fn set_pool_prizes_allocated(svm: &mut LiteSVM, pool_id: u32, amount: u64) {
    let (pda, _) = pool_pda(pool_id);
    let mut pool = common::read_pool_state(svm, pool_id);
    pool.total_prizes_allocated = amount;
    use anchor_lang::Discriminator;
    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));
    let mut account = svm.get_account(&pda).unwrap();
    account.data = data;
    svm.set_account(pda, account).unwrap();
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
    inject_token_account(&mut ctx.svm, pool_pst_vault, ctx.pst_mint, pool_pda(1).0, 1_000_000);

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
    let meta = ctx.svm.send_transaction(tx).expect("claim non-reinvested winnings");
    let event = assert_cpi_event::<anchor::events::WinningsClaimed>(&meta);
    assert_eq!(event.user, ctx.user.pubkey());
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.amount, 500_000);
    assert_eq!(event.redemption_id, 0);

    // Assert UserWinnings state updates
    let uw_account = ctx.svm.get_account(&user_winnings_key).unwrap();
    let uw = anchor::UserWinnings::try_deserialize(&mut uw_account.data.as_slice()).unwrap();
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 0);
    assert_eq!(uw.total_claimed, 500_000);

    // Assert PrizePool state updates
    let pool_account = ctx.svm.get_account(&pool_pda(1).0).unwrap();
    let pool = anchor::PrizePool::try_deserialize(&mut pool_account.data.as_slice()).unwrap();
    assert_eq!(pool.total_prizes_allocated, 500_000); // 1_000_000 - 500_000
    assert_eq!(pool.total_prizes_distributed, 0); // Lifetime cumulative total remains invariant
    assert_eq!(pool.next_redemption_id, 1);
    assert_eq!(pool.total_pending_redemptions, 500_000);

    // Assert PendingRedemption PDA creation and all fields
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    let pr_account = ctx.svm.get_account(&pending_redemption_key).unwrap();
    let pr = anchor::PendingRedemption::try_deserialize(&mut pr_account.data.as_slice()).unwrap();
    assert_eq!(pr.pool_id, 1);
    assert_eq!(pr.redemption_id, 0);
    assert_eq!(pr.user, ctx.user.pubkey());
    assert_eq!(pr.amount, 500_000);
    assert!(pr.pst_shares_locked > 0);
    assert_eq!(pr.huma_request_id, 0);
    assert_eq!(pr.version, anchor::PendingRedemption::CURRENT_VERSION);
    assert_eq!(pr.redemption_type, anchor::state::RedemptionType::PrizeClaim);
}

fn inject_pool_with_frozen(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    status: anchor::PoolStatus,
    is_frozen_for_draw: u8,
) -> Pubkey {
    use anchor_lang::Discriminator;
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: status as u8,
        total_deposited_principal: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 1_000_000_000,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        total_prizes_distributed: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw,
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10],
        prize_tiers_count: 0,
        _padding: [0; 3],
        version: anchor::PrizePool::CURRENT_VERSION,
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

#[test]
fn test_claim_non_reinvested_winnings_fails_when_frozen() {
    let mut ctx = setup_claim_guard(100_000, anchor::PoolStatus::Active);
    // Freeze pool for draw
    inject_pool_with_frozen(&mut ctx.svm, 1, ctx.token_mint, anchor::PoolStatus::Active, 1);

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
    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("AwaitingRandomnessFreeze") || err_str.contains("Custom(6008)"),
        "Expected AwaitingRandomnessFreeze error, got: {err_str}"
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
    inject_pool_with_frozen(&mut ctx.svm, 1, ctx.usdc_mint, anchor::PoolStatus::Closed, 0);

    // Setup user winnings with 500_000 unclaimed winnings
    let (user_winnings_key, _) = user_winnings_pda(1, &ctx.user.pubkey());
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.user.pubkey(), 500_000, 0, 0, 0);

    // Update pool total_prizes_allocated = 1_000_000
    set_pool_prizes_allocated(&mut ctx.svm, 1, 1_000_000);

    // Fund pool_pst_vault with 1_000_000 PST tokens
    inject_token_account(&mut ctx.svm, pool_pst_vault, ctx.pst_mint, pool_pda(1).0, 1_000_000);

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
    let meta = ctx.svm.send_transaction(tx).expect("claim non-reinvested winnings on closed pool should succeed");
    let event = assert_cpi_event::<anchor::events::WinningsClaimed>(&meta);
    assert_eq!(event.user, ctx.user.pubkey());
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.amount, 500_000);
    assert_eq!(event.redemption_id, 0);

    let uw_account = ctx.svm.get_account(&user_winnings_key).unwrap();
    let uw = anchor::UserWinnings::try_deserialize(&mut uw_account.data.as_slice()).unwrap();
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 0);
    assert_eq!(uw.total_claimed, 500_000);
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

