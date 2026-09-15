//! Integration tests for `harvest_yield_and_commit` (Huma accounting-only).
//!
//! The instruction is now pure accounting: reads $PST price from a Huma PoolState
//! account on-chain, calculates yield, accrues fee to state, creates DrawCycle.
//! No CPI, no token movement.

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

/// Inject a mock Huma PoolState account with the correct byte layout.
///
/// Layout: [discriminator:8][bump:1][status:1][disbursement_reserve:16][mode_states_len:4][mode_state_0.assets:16]...
/// We only need `assets` (u128) at offset 30 (= 8+1+1+16+4).
fn inject_huma_pool_state(svm: &mut LiteSVM, address: Pubkey, total_assets: u128) {
    // MODE_STATES_OFFSET = 26 (after discriminator)
    // Layout: 26 bytes prefix + 4 bytes vec_len + 216 bytes ModeState[0]
    let size = 26 + 4 + 216;
    let mut data = vec![0u8; size];
    // vec_len = 1
    data[26..30].copy_from_slice(&1u32.to_le_bytes());
    // assets (u128) at offset 30
    data[30..46].copy_from_slice(&total_assets.to_le_bytes());
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::constants::HUMA_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ─── SVM bootstrap ───────────────────────────────────────────────────────────

fn setup_global_with_crank() -> (LiteSVM, Keypair, Keypair) {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    (svm, admin, crank)
}

// ─── Context + instruction builder ──────────────────────────────────────────

struct HarvestCtx {
    svm: LiteSVM,
    crank: Keypair,
    pst_mint: Pubkey,
    ticket_registry: Pubkey,
    huma_pool_state: Pubkey,
    randomness_account: Pubkey,
}

fn inject_mock_randomness_account(svm: &mut LiteSVM, address: Pubkey) {
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: owner_pubkey,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn build_harvest_ix(ctx: &HarvestCtx, pool_id: u32, _cycle_id: u32) -> Instruction {
    let (gc, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let pool_state = &ctx.svm.get_account(&pool).unwrap();
    let pool_data: anchor::PrizePool =
        anchor::PrizePool::try_deserialize(&mut pool_state.data.as_slice()).unwrap();
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (draw_cycle, _) = draw_cycle_pda(pool_id, pool_data.current_draw_cycle_id);

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: ctx.crank.pubkey(),
        global_config: gc,
        pool,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle: draw_cycle,
        pool_pst_vault,
        pst_mint: ctx.pst_mint,
        huma_pool_state: ctx.huma_pool_state,
        randomness_account: ctx.randomness_account,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    }
}

fn send_harvest(
    ctx: &mut HarvestCtx,
    pool_id: u32,
    cycle_id: u32,
) -> TxResult {
    let ix = build_harvest_ix(ctx, pool_id, cycle_id);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx)
}

// ─── Readers ─────────────────────────────────────────────────────────────────

fn read_pool(svm: &LiteSVM, pool_id: u32) -> anchor::PrizePool {
    let (pda, _) = pool_pda(pool_id);
    let acct = svm.get_account(&pda).unwrap();
    anchor::PrizePool::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

fn read_draw_cycle(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::DrawCycle {
    let (pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let acct = svm.get_account(&pda).unwrap();
    anchor::DrawCycle::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

fn read_registry_counts(svm: &LiteSVM, reg: Pubkey) -> (u32, u32) {
    let acct = svm.get_account(&reg).unwrap();
    let active = u32::from_le_bytes(acct.data[20..24].try_into().unwrap());
    let pending = u32::from_le_bytes(acct.data[24..28].try_into().unwrap());
    (active, pending)
}

// ─── Setup helpers ───────────────────────────────────────────────────────────

/// Setup for guard tests — no yield, just validation checks.
fn setup_guard(status: anchor::PoolStatus, is_frozen: bool, cycle_end_at: i64) -> HarvestCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint_with_supply(&mut svm, token_mint, 6, 0);
    inject_mint_with_supply(&mut svm, pst_mint, 6, 0);

    let fee_wallet = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    inject_registry_with_tickets(&mut svm, registry, 1, 1000, 0, 0, &[]);

    let pool_key = pool_pda(1).0;
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 0);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state, 0);

    PrizePoolTestBuilder::new(1)
        .with_token_mint(token_mint)
        .with_ticket_registry(registry)
        .with_fee_wallet(fee_wallet)
        .with_huma_pool_state(huma_pool_state)
        .with_status(status)
        .with_frozen(is_frozen)
        .with_fee_basis_points(100)
        .with_cycle_end_at(cycle_end_at)
        .with_current_draw_cycle_id(0)
        .with_solvency_state(0, 0, 0)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    warp_to_timestamp(&mut svm, 1_700_001_000);

    HarvestCtx {
        svm,
        crank,
        pst_mint,
        ticket_registry: registry,
        huma_pool_state,
        randomness_account,
    }
}

/// Setup for happy-path tests — inject PST balance and Huma pool state to simulate yield.
///
/// `pst_balance`: number of $PST shares held by pool
/// `pst_supply`: total $PST supply
/// `total_assets`: total USDC in Huma pool (used for price calculation)
/// `principal`: total deposited principal
fn setup_happy(
    active: u32,
    pending: u32,
    fee_bps: u16,
    prize_tiers: Vec<anchor::PrizeTier>,
    pst_balance: u64,
    pst_supply: u64,
    total_assets: u128,
    principal: u64,
) -> HarvestCtx {
    setup_happy_with_cycle_end(
        active,
        pending,
        fee_bps,
        prize_tiers,
        pst_balance,
        pst_supply,
        total_assets,
        principal,
        0,
    )
}

fn setup_happy_with_cycle_end(
    active: u32,
    pending: u32,
    fee_bps: u16,
    prize_tiers: Vec<anchor::PrizeTier>,
    pst_balance: u64,
    pst_supply: u64,
    total_assets: u128,
    principal: u64,
    cycle_end_at: i64,
) -> HarvestCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint_with_supply(&mut svm, token_mint, 6, 0);
    inject_mint_with_supply(&mut svm, pst_mint, 6, pst_supply);

    let fee_wallet = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, active, pending);

    let pool_key = pool_pda(1).0;
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, pst_balance);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state, total_assets);

    PrizePoolTestBuilder::new(1)
        .with_token_mint(token_mint)
        .with_ticket_registry(registry)
        .with_fee_wallet(fee_wallet)
        .with_huma_pool_state(huma_pool_state)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(false)
        .with_fee_basis_points(fee_bps)
        .with_cycle_end_at(cycle_end_at)
        .with_current_draw_cycle_id(0)
        .with_prize_tiers(prize_tiers)
        .with_solvency_state(principal, 0, 0)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    warp_to_timestamp(&mut svm, 1_700_001_000);

    HarvestCtx {
        svm,
        crank,
        pst_mint,
        ticket_registry: registry,
        huma_pool_state,
        randomness_account,
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_fails_unauthorized_crank() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, 0);
    let fake_crank = Keypair::new();
    ctx.svm
        .airdrop(&fake_crank.pubkey(), 10_000_000_000)
        .unwrap();
    ctx.crank = fake_crank;
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedCrank);
}

#[test]
fn test_harvest_fails_pool_not_active() {
    let mut ctx = setup_guard(anchor::PoolStatus::Paused, false, 0);
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolNotActive);
}

#[test]
fn test_harvest_fails_pool_frozen() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, true, 0);
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_harvest_fails_cycle_not_ended() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, i64::MAX);
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::CycleNotEnded);
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy-path tests (accounting-only, no CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_happy_path_zero_yield() {
    // PST balance=0 → current_value=0, yield=0, DrawCycle Complete
    let mut ctx = setup_happy(0, 3, 100, vec![], 0, 0, 0, 0);
    let meta = send_harvest(&mut ctx, 1, 0).expect("zero yield harvest");
    let event = assert_cpi_event::<anchor::events::DrawSkipped>(&meta);
    assert_eq!(event.crank, ctx.crank.pubkey(), "DrawSkipped crank must match caller");
    assert_eq!(event.pool_id, 1, "DrawSkipped pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "DrawSkipped cycle_id must be 0");
    assert_eq!(event.raw_yield, 0, "DrawSkipped raw_yield must be 0");
    assert_eq!(event.locked_ticket_count, 0, "DrawSkipped locked_ticket_count must be 0");
    assert_eq!(event.reason, anchor::DrawSkipReason::ZeroActiveTickets, "DrawSkipReason must be ZeroActiveTickets");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Skipped, "DrawCycle status must be Skipped");
    assert!(dc.initiated_at > 0, "DrawCycle initiated_at must be positive");
    assert_eq!(dc.completed_at, dc.initiated_at, "DrawCycle completed_at must match initiated_at for Skipped");
    assert_eq!(dc.prize_pot, 0, "DrawCycle prize_pot must be 0");
    assert_eq!(dc.cycle_fee_collected, 0, "DrawCycle cycle_fee_collected must be 0");
    assert_eq!(dc.locked_ticket_count, 0, "DrawCycle locked_ticket_count must be 0");

    let (active, pending) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active, 3, "Pending tickets must be merged into active tickets");
    assert_eq!(pending, 0, "Pending tickets count must be 0 after merge");
}

#[test]
fn test_harvest_happy_path_yield_no_eligible() {
    // Yield > 0 but active=0 (only pending) → Complete status, fee accrued
    // 1M PST balance, 1M supply, 1.5M total_assets, 1M principal
    // current_value = 1M * 1.5M / 1M = 1.5M
    // yield = 1.5M - 1M (principal) - 0 (accrued) = 500K
    // fee = 500K * 500 / 10000 = 25K
    let mut ctx = setup_happy(
        0,
        2,
        500,
        vec![],
        1_000_000,
        1_000_000,
        1_500_000,
        1_000_000,
    );
    let meta = send_harvest(&mut ctx, 1, 0).expect("yield no eligible harvest");
    let event = assert_cpi_event::<anchor::events::DrawSkipped>(&meta);
    assert_eq!(event.crank, ctx.crank.pubkey(), "DrawSkipped crank must match caller");
    assert_eq!(event.pool_id, 1, "DrawSkipped pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "DrawSkipped cycle_id must be 0");
    assert_eq!(event.raw_yield, 0, "DrawSkipped raw_yield must be 0");
    assert_eq!(event.locked_ticket_count, 0, "DrawSkipped locked_ticket_count must be 0");
    assert_eq!(event.reason, anchor::DrawSkipReason::ZeroActiveTickets, "DrawSkipReason must be ZeroActiveTickets");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Skipped, "DrawCycle status must be Skipped");
    assert!(dc.initiated_at > 0, "DrawCycle initiated_at must be positive");
    assert_eq!(dc.completed_at, dc.initiated_at, "DrawCycle completed_at must match initiated_at");
    assert_eq!(dc.cycle_fee_collected, 0, "DrawCycle cycle_fee_collected must be 0");
    assert_eq!(dc.prize_pot, 0, "DrawCycle prize_pot must be 0");
    assert_eq!(dc.locked_ticket_count, 0, "DrawCycle locked_ticket_count must be 0");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_accrued, 0, "Pool fees accrued must remain 0 when zero active tickets");
}

#[test]
fn test_harvest_happy_path_yield_and_eligible() {
    // Yield > 0, active > 0, tiers set → AwaitingRandomness + pool frozen
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 2M PST, 2M supply, 2.5M total_assets, 2M principal
    // yield = 2M * 2.5M / 2M - 2M = 500K
    let mut ctx = setup_happy(2, 1, 100, tiers, 2_000_000, 2_000_000, 2_500_000, 2_000_000);
    let meta = send_harvest(&mut ctx, 1, 0).expect("yield + eligible harvest");
    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(event.crank, ctx.crank.pubkey(), "YieldHarvested crank must match caller");
    assert_eq!(event.pool_id, 1, "YieldHarvested pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "YieldHarvested cycle_id must be 0");
    assert_eq!(event.raw_yield, 500_000, "YieldHarvested raw_yield must be 500,000");
    assert_eq!(event.fee, 5_000, "YieldHarvested fee must be 5,000");
    assert_eq!(event.prize_pot, 495_000, "YieldHarvested prize_pot must be 495,000");
    assert_eq!(event.locked_ticket_count, 2, "YieldHarvested locked_ticket_count must be 2");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::AwaitingRandomness, "DrawCycle status must be AwaitingRandomness");
    assert!(dc.initiated_at > 0, "DrawCycle initiated_at must be positive");
    assert_eq!(dc.completed_at, 0, "DrawCycle completed_at must be 0 while awaiting randomness");
    assert_eq!(dc.locked_ticket_count, 2, "DrawCycle locked_ticket_count must match active tickets count");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.is_frozen_for_draw, 1, "Pool must be frozen for draw");
}

#[test]
fn test_harvest_happy_path_fee_exact() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 1M PST, 1M supply, 2M total_assets, 1M principal → yield=1M, fee_bps=250 (2.5%)
    let mut ctx = setup_happy(1, 0, 250, tiers, 1_000_000, 1_000_000, 2_000_000, 1_000_000);
    send_harvest(&mut ctx, 1, 0).expect("fee exact harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_fee_partition_conserved(1_000_000, 250, dc.cycle_fee_collected, dc.prize_pot);

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_accrued, dc.cycle_fee_collected, "Pool total_fees_accrued must match cycle fee");
}

#[test]
fn test_harvest_happy_path_zero_fee_bps() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 1M PST, 1M supply, 1.5M total_assets, 1M principal → yield=500K, fee=0
    let mut ctx = setup_happy(1, 0, 0, tiers, 1_000_000, 1_000_000, 1_500_000, 1_000_000);
    send_harvest(&mut ctx, 1, 0).expect("zero fee harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.cycle_fee_collected, 0, "DrawCycle cycle_fee_collected must be 0 with 0 bps fee");
    assert_eq!(dc.prize_pot, 500_000, "DrawCycle prize_pot must be full 500,000 yield");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_accrued, 0, "Pool total_fees_accrued must be 0");
}

#[test]
fn test_harvest_happy_path_pending_merge() {
    // 2 active + 3 pending → after: 5 active, 0 pending
    let mut ctx = setup_happy(2, 3, 100, vec![], 0, 0, 0, 0);
    send_harvest(&mut ctx, 1, 0).expect("merge harvest");

    let (active, pending) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active, 5, "Registry active tickets must include merged pending tickets");
    assert_eq!(pending, 0, "Registry pending tickets must be 0 after merge");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.locked_ticket_count, 2, "DrawCycle locked tickets must reflect only pre-merge active tickets");
    assert_eq!(dc.status, anchor::DrawStatus::Skipped, "DrawCycle status must be Skipped when zero yield");
}

#[test]
fn test_harvest_happy_path_cycle_advances() {
    let mut ctx = setup_happy(0, 0, 100, vec![], 0, 0, 0, 0);
    let current_ts = 1_700_001_000i64;
    send_harvest(&mut ctx, 1, 0).expect("cycle advance harvest");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.current_draw_cycle_id, 1, "Draw cycle id must increment to 1");
    assert_eq!(pool.current_cycle_end_at, current_ts + 24 * 3600, "Current cycle end at must advance by duration");
}

#[test]
fn test_harvest_fails_prize_tiers_not_configured() {
    // yield > 0, eligible > 0, but prize_tiers empty
    let mut ctx = setup_happy(
        2,
        0,
        100,
        vec![],
        1_000_000,
        1_000_000,
        2_000_000,
        1_000_000,
    );
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::PrizeTiersNotConfigured);
}

#[test]
fn test_harvest_happy_path_consecutive_cycles() {
    let mut ctx = setup_happy(0, 0, 100, vec![], 0, 0, 0, 0);
    send_harvest(&mut ctx, 1, 0).expect("first harvest");

    let pool = read_pool(&ctx.svm, 1);
    warp_to_timestamp(&mut ctx.svm, pool.current_cycle_end_at + 1);

    send_harvest(&mut ctx, 1, 1).expect("second harvest");

    let pool2 = read_pool(&ctx.svm, 1);
    assert_eq!(pool2.current_draw_cycle_id, 2, "Draw cycle id must increment to 2");

    let dc0 = read_draw_cycle(&ctx.svm, 1, 0);
    let dc1 = read_draw_cycle(&ctx.svm, 1, 1);
    assert_eq!(dc0.cycle_id, 0, "First draw cycle id must be 0");
    assert_eq!(dc1.cycle_id, 1, "Second draw cycle id must be 1");
}

#[test]
fn test_harvest_fails_invalid_mint() {
    let mut ctx = setup_happy(0, 0, 100, vec![], 0, 0, 0, 0);
    let fake_mint = Keypair::new().pubkey();
    ctx.pst_mint = fake_mint;

    // Inject the fake mint into the SVM
    inject_mint_with_supply(&mut ctx.svm, fake_mint, 6, 0);

    let res = send_harvest(&mut ctx, 1, 0);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintTokenMint);
}

#[test]
fn test_harvest_fails_invalid_randomness_account() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, 0);
    ctx.randomness_account = Keypair::new().pubkey();
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidRandomnessAccount);
}

#[test]
fn test_harvest_fails_math_overflow() {
    let mut ctx = setup_happy(
        10, // active count > 0 to have yield_generated > 0
        0,
        100, // fee bps
        vec![anchor::PrizeTier::default_single_winner()], // prize tiers not empty
        1_000_000, // pst_balance
        1_000_000, // pst_supply
        2_000_000, // total_assets
        1_000_000, // principal
    );

    mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.total_prizes_allocated = u64::MAX;
    });

    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_harvest_below_min_yield_threshold_skips_and_rolls_over() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 1M PST, 1M supply, 1.5M total_assets, 1M principal → raw yield = 500k
    let mut ctx = setup_happy(5, 0, 100, tiers, 1_000_000, 1_000_000, 1_500_000, 1_000_000);

    // Set min_yield_threshold to 1M (1,000,000 > 500,000 raw yield)
    mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.min_yield_threshold = 1_000_000;
    });

    // Execute harvest
    let meta = send_harvest(&mut ctx, 1, 0).expect("harvest below threshold");
    let event = assert_cpi_event::<anchor::events::DrawSkipped>(&meta);
    assert_eq!(event.crank, ctx.crank.pubkey(), "DrawSkipped crank must match caller");
    assert_eq!(event.pool_id, 1, "DrawSkipped pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "DrawSkipped cycle_id must be 0");
    assert_eq!(event.raw_yield, 500_000, "DrawSkipped raw_yield must be 500,000");
    assert_eq!(event.threshold, 1_000_000, "DrawSkipped threshold must be 1,000,000");
    assert_eq!(event.locked_ticket_count, 5, "DrawSkipped locked_ticket_count must be 5");
    assert_eq!(event.reason, anchor::DrawSkipReason::InsufficientYield, "DrawSkipReason must be InsufficientYield");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Skipped, "DrawCycle status must be Skipped");
    assert_eq!(dc.locked_ticket_count, 5, "DrawCycle locked_ticket_count must be 5");
    assert_eq!(dc.prize_pot, 0, "DrawCycle prize_pot must be 0");
    assert_eq!(dc.cycle_fee_collected, 0, "DrawCycle cycle_fee_collected must be 0");

    let pool_state = read_pool(&ctx.svm, 1);
    assert_eq!(pool_state.is_frozen_for_draw, 0, "Pool is_frozen_for_draw must be 0 when skipped");
    assert_eq!(pool_state.total_fees_accrued, 0, "Pool total_fees_accrued must be 0 when skipped");
    assert_eq!(pool_state.total_prizes_allocated, 0, "Pool total_prizes_allocated must be 0 when skipped");
}

#[test]
fn test_harvest_yield_and_commit_succeeds_immediately_after_create_pool_and_deposit() {
    // End-to-end test verifying that a newly created pool with atomic prize tiers
    // allows deposits and immediately completes a harvest draw cycle without calling set_prize_tiers.
    let mut ctx = setup_happy(
        10,
        0,
        100,
        default_prize_tiers(),
        1_000_000,
        1_000_000,
        2_000_000,
        1_000_000,
    );

    send_harvest(&mut ctx, 1, 0)
        .expect("harvest should succeed immediately with atomic prize tiers");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::AwaitingRandomness, "DrawCycle status must be AwaitingRandomness");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.is_frozen_for_draw, 1, "Pool must be frozen for draw");
    assert_eq!(pool.prize_tiers_count, 1, "Pool prize_tiers_count must be 1");
    assert_eq!(
        pool.prize_tiers[0],
        anchor::PrizeTier::default_single_winner(),
        "Prize tier must match default single winner"
    );
}

// ─── Dust Rollover Verification ──────────────────────────────────────────────

#[test]
fn test_harvest_yield_rolls_over_unallocated_dust_from_prior_cycle() {
    // Initial pool state:
    // deposited_principal = 10_000_000 (10 USDC)
    // total_prizes_allocated = 0 (because prior cycle had 5_000 lamports dust rolled over/deducted)
    // PST vault balance = 10_005_000 (representing 10 USDC principal + 0.005 USDC dust)
    let mut ctx = setup_happy(
        10,
        0,
        100, // 1% fee
        default_prize_tiers(),
        10_005_000,
        10_000_000,
        10_000_000,
        10_000_000,
    );

    let meta = send_harvest(&mut ctx, 1, 0).expect("harvest with rolled-over dust should succeed");

    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(event.crank, ctx.crank.pubkey(), "YieldHarvested crank must match caller");
    // Yield generated = current_value (10_005_000) - book_value (10_000_000) = 5_000
    // Fee = 5_000 * 100 / 10_000 = 50 lamports
    // Prize pot = 4_950 lamports
    assert_eq!(event.raw_yield, 5_000, "YieldHarvested raw_yield must be 5,000");
    assert_eq!(event.fee, 50, "YieldHarvested fee must be 50");
    assert_eq!(event.prize_pot, 4_950, "YieldHarvested prize_pot must be 4,950");
    assert_eq!(
        event.fee + event.prize_pot,
        event.raw_yield,
        "Conservation: fee ({}) + prize_pot ({}) must equal raw_yield ({})",
        event.fee,
        event.prize_pot,
        event.raw_yield
    );

    let updated_pool = read_pool(&ctx.svm, 1);
    assert_eq!(updated_pool.total_prizes_allocated, 4_950, "Pool total_prizes_allocated must match prize pot");
    assert_eq!(updated_pool.total_fees_accrued, 50, "Pool total_fees_accrued must match fee");
}

#[test]
fn test_harvest_fails_double_harvest_same_cycle() {
    let mut ctx = setup_happy(
        10,
        0,
        100,
        default_prize_tiers(),
        11_000_000,
        10_000_000,
        10_000_000,
        10_000_000,
    );

    send_harvest(&mut ctx, 1, 0).expect("first harvest should succeed");

    // Second harvest in same cycle should fail
    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_harvest_fails_current_draw_cycle_id_overflow() {
    let mut ctx = setup_happy(
        10,
        0,
        100,
        default_prize_tiers(),
        11_000_000,
        10_000_000,
        10_000_000,
        10_000_000,
    );

    common::mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.current_draw_cycle_id = u32::MAX;
    });

    let res = send_harvest(&mut ctx, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_harvest_yield_fee_truncation_rounding() {
    // Setup pool with fee_basis_points = 1 (0.01%) and yield = 9_999 lamports
    // fee = 9_999 * 1 / 10_000 = 0 lamports (truncated)
    // prize_pot = 9_999 - 0 = 9_999 lamports
    let mut ctx = setup_happy(
        10,
        0,
        1, // 1 bps fee
        default_prize_tiers(),
        10_009_999, // current value
        10_000_000, // book value
        10_000_000,
        10_000_000,
    );

    let meta = send_harvest(&mut ctx, 1, 0).expect("harvest with fee truncation should succeed");
    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(event.crank, ctx.crank.pubkey(), "YieldHarvested crank must match caller");
    assert_eq!(event.raw_yield, 9_999, "YieldHarvested raw_yield must be 9,999");
    assert_eq!(event.fee, 0, "YieldHarvested fee must be 0 due to truncation");
    assert_eq!(event.prize_pot, 9_999, "YieldHarvested prize_pot must be 9,999");

    let updated_pool = read_pool(&ctx.svm, 1);
    assert_eq!(updated_pool.total_prizes_allocated, 9_999, "Pool total_prizes_allocated must match 9,999");
    assert_eq!(updated_pool.total_fees_accrued, 0, "Pool total_fees_accrued must be 0");
}

#[test]
fn test_harvest_yield_exact_temporal_boundaries() {
    let cycle_end_at = 1_700_050_000i64;

    // Boundary 1: cycle_end_at - 1 must fail with CycleNotEnded
    {
        let mut ctx = setup_happy_with_cycle_end(
            10,
            0,
            100,
            default_prize_tiers(),
            11_000_000,
            10_000_000,
            10_000_000,
            10_000_000,
            cycle_end_at,
        );

        warp_to_timestamp(&mut ctx.svm, cycle_end_at - 1);
        let res = send_harvest(&mut ctx, 1, 0);
        assert_custom_error(res, anchor::error::PremiumBondsError::CycleNotEnded);
    }

    // Boundary 2: cycle_end_at must succeed
    {
        let mut ctx = setup_happy_with_cycle_end(
            10,
            0,
            100,
            default_prize_tiers(),
            11_000_000,
            10_000_000,
            10_000_000,
            10_000_000,
            cycle_end_at,
        );

        warp_to_timestamp(&mut ctx.svm, cycle_end_at);
        let res = send_harvest(&mut ctx, 1, 0);
        assert!(
            res.is_ok(),
            "Harvest at exact cycle_end_at must succeed: {:?}",
            res.err()
        );
    }

    // Boundary 3: cycle_end_at + 1 must succeed
    {
        let mut ctx = setup_happy_with_cycle_end(
            10,
            0,
            100,
            default_prize_tiers(),
            11_000_000,
            10_000_000,
            10_000_000,
            10_000_000,
            cycle_end_at,
        );

        warp_to_timestamp(&mut ctx.svm, cycle_end_at + 1);
        let res = send_harvest(&mut ctx, 1, 0);
        assert!(
            res.is_ok(),
            "Harvest at cycle_end_at + 1 must succeed: {:?}",
            res.err()
        );
    }
}
