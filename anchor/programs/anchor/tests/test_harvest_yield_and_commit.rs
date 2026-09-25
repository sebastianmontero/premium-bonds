//! Integration tests for `harvest_yield_and_commit` (Huma accounting-only).
//!
//! The instruction is now pure accounting: reads $PST price from a Huma PoolState
//! account on-chain, calculates yield, accrues fee to state, creates DrawCycle.
//! No CPI, no token movement.

use anchor_lang::AccountDeserialize;
use solana_keypair::Keypair;
use solana_program::pubkey::Pubkey;
use solana_sdk::account::Account;
use solana_signer::Signer;

mod common;
use common::*;


// ═════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_fails_unauthorized_crank() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let fake_crank = Keypair::new();
    ctx.svm
        .airdrop(&fake_crank.pubkey(), 10_000_000_000)
        .unwrap();
    ctx.crank = fake_crank;
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedCrank);
}

#[test]
fn test_harvest_fails_pool_not_active() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Paused, false)
        .with_cycle_end_at(0)
        .build();
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolNotActive);
}

#[test]
fn test_harvest_fails_pool_frozen() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, true)
        .with_cycle_end_at(0)
        .build();
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

#[test]
fn test_harvest_fails_cycle_not_ended() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(i64::MAX)
        .build();
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::CycleNotEnded);
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy-path tests (accounting-only, no CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_happy_path_zero_yield() {
    // PST balance=0 → current_value=0, yield=0, DrawCycle Complete
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(0, 3)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(0, 0, 0, 0)
        .build();
    let meta = ctx.send_harvest(1, 0).expect("zero yield harvest");
    let event = assert_cpi_event::<anchor::events::DrawSkipped>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawSkipped crank must match caller"
    );
    assert_eq!(event.pool_id, 1, "DrawSkipped pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "DrawSkipped cycle_id must be 0");
    assert_eq!(event.raw_yield, 0, "DrawSkipped raw_yield must be 0");
    assert_eq!(
        event.locked_ticket_count, 0,
        "DrawSkipped locked_ticket_count must be 0"
    );
    assert_eq!(
        event.reason,
        anchor::DrawSkipReason::ZeroActiveTickets,
        "DrawSkipReason must be ZeroActiveTickets"
    );

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Skipped,
        "DrawCycle status must be Skipped"
    );
    assert!(
        dc.initiated_at > 0,
        "DrawCycle initiated_at must be positive"
    );
    assert_eq!(
        dc.completed_at, dc.initiated_at,
        "DrawCycle completed_at must match initiated_at for Skipped"
    );
    assert_eq!(dc.prize_pot, 0, "DrawCycle prize_pot must be 0");
    assert_eq!(
        dc.cycle_fee_collected, 0,
        "DrawCycle cycle_fee_collected must be 0"
    );
    assert_eq!(
        dc.locked_ticket_count, 0,
        "DrawCycle locked_ticket_count must be 0"
    );

    let active = read_registry_active(&ctx.svm, ctx.ticket_registry);
    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    assert_eq!(
        active, 3,
        "Pending tickets must be merged into active tickets"
    );
    assert_eq!(pending, 0, "Pending tickets count must be 0 after merge");
}

#[test]
fn test_harvest_happy_path_yield_no_eligible() {
    // Yield > 0 but active=0 (only pending) → Complete status, fee accrued
    // 1M PST balance, 1M supply, 1.5M total_assets, 1M principal
    // current_value = 1M * 1.5M / 1M = 1.5M
    // yield = 1.5M - 1M (principal) - 0 (accrued) = 500K
    // fee = 500K * 500 / 10000 = 25K
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(0, 2)
        .with_circuit_breaker(0, 500)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(1_000_000, 1_000_000, 1_500_000, 1_000_000)
        .build();
    let meta = ctx.send_harvest(1, 0).expect("yield no eligible harvest");
    let event = assert_cpi_event::<anchor::events::DrawSkipped>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawSkipped crank must match caller"
    );
    assert_eq!(event.pool_id, 1, "DrawSkipped pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "DrawSkipped cycle_id must be 0");
    assert_eq!(
        event.raw_yield, 0,
        "DrawSkipped raw_yield must be 0"
    );
    assert_eq!(
        event.locked_ticket_count, 0,
        "DrawSkipped locked_ticket_count must be 0"
    );
    assert_eq!(
        event.reason,
        anchor::DrawSkipReason::ZeroActiveTickets,
        "DrawSkipReason must be ZeroActiveTickets"
    );

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Skipped,
        "DrawCycle status must be Skipped"
    );
    assert!(
        dc.initiated_at > 0,
        "DrawCycle initiated_at must be positive"
    );
    assert_eq!(
        dc.completed_at, dc.initiated_at,
        "DrawCycle completed_at must match initiated_at"
    );
    assert_eq!(
        dc.cycle_fee_collected, 0,
        "DrawCycle cycle_fee_collected must be 0"
    );
    assert_eq!(dc.prize_pot, 0, "DrawCycle prize_pot must be 0");
    assert_eq!(
        dc.locked_ticket_count, 0,
        "DrawCycle locked_ticket_count must be 0"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_fees_accrued, 0,
        "Pool fees accrued must remain 0 when zero active tickets"
    );
}

#[test]
fn test_harvest_happy_path_yield_and_eligible() {
    // Yield > 0, active > 0, tiers set → AwaitingRandomness + pool frozen
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 2M PST, 2M supply, 2.5M total_assets, 2M principal
    // yield = 2M * 2.5M / 2M - 2M = 500K
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(2, 1)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(tiers)
        .with_raw_huma_state(2_000_000, 2_000_000, 2_500_000, 2_000_000)
        .build();
    let meta = ctx.send_harvest(1, 0).expect("yield + eligible harvest");
    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "YieldHarvested crank must match caller"
    );
    assert_eq!(event.pool_id, 1, "YieldHarvested pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "YieldHarvested cycle_id must be 0");
    assert_eq!(
        event.raw_yield, 500_000,
        "YieldHarvested raw_yield must be 500,000"
    );
    assert_fee_partition_conserved(event.raw_yield, 100, event.fee, event.prize_pot);
    assert_eq!(
        event.fee + event.prize_pot,
        event.raw_yield,
        "Global mass conservation: fee + prize_pot == raw_yield"
    );
    assert_eq!(
        event.locked_ticket_count, 2,
        "YieldHarvested locked_ticket_count must be 2"
    );

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::AwaitingRandomness,
        "DrawCycle status must be AwaitingRandomness"
    );
    assert!(
        dc.initiated_at > 0,
        "DrawCycle initiated_at must be positive"
    );
    assert_eq!(
        dc.completed_at, 0,
        "DrawCycle completed_at must be 0 while awaiting randomness"
    );
    assert_eq!(
        dc.locked_ticket_count, 2,
        "DrawCycle locked_ticket_count must match active tickets count"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.is_frozen_for_draw, 1, "Pool must be frozen for draw");
    assert_eq!(
        pool.total_prizes_allocated, event.prize_pot,
        "Pool prizes allocated must match prize pot"
    );
    assert_eq!(
        pool.total_fees_accrued, event.fee,
        "Pool fees accrued must match fee collected"
    );
}

#[test]
fn test_harvest_happy_path_fee_exact() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 1M PST, 1M supply, 2M total_assets, 1M principal → yield=1M, fee_bps=250 (2.5%)
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(1, 0)
        .with_circuit_breaker(0, 250)
        .with_prize_tiers(tiers)
        .with_raw_huma_state(1_000_000, 1_000_000, 2_000_000, 1_000_000)
        .build();
    ctx.send_harvest(1, 0).expect("fee exact harvest");

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_fee_partition_conserved(1_000_000, 250, dc.cycle_fee_collected, dc.prize_pot);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_fees_accrued, dc.cycle_fee_collected,
        "Pool total_fees_accrued must match cycle fee"
    );
}

#[test]
fn test_harvest_happy_path_zero_fee_bps() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 1M PST, 1M supply, 1.5M total_assets, 1M principal → yield=500K, fee=0
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(1, 0)
        .with_circuit_breaker(0, 0)
        .with_prize_tiers(tiers)
        .with_raw_huma_state(1_000_000, 1_000_000, 1_500_000, 1_000_000)
        .build();
    ctx.send_harvest(1, 0).expect("zero fee harvest");

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_fee_partition_conserved(500_000, 0, dc.cycle_fee_collected, dc.prize_pot);
    assert_eq!(
        dc.cycle_fee_collected + dc.prize_pot,
        500_000,
        "Global mass conservation: fee + prize_pot == raw_yield"
    );
    assert_eq!(
        dc.cycle_fee_collected, 0,
        "DrawCycle cycle_fee_collected must be 0 with 0 bps fee"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_fees_accrued, 0,
        "Pool total_fees_accrued must be 0"
    );
    assert_eq!(
        pool.total_prizes_allocated, dc.prize_pot,
        "Pool total_prizes_allocated must match prize pot"
    );
}

#[test]
fn test_harvest_happy_path_pending_merge() {
    // 2 active + 3 pending → after: 5 active, 0 pending
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(2, 3)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(0, 0, 0, 0)
        .build();
    ctx.send_harvest(1, 0).expect("merge harvest");

    let active = read_registry_active(&ctx.svm, ctx.ticket_registry);
    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    assert_eq!(
        active, 5,
        "Registry active tickets must include merged pending tickets"
    );
    assert_eq!(pending, 0, "Registry pending tickets must be 0 after merge");

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.locked_ticket_count, 2,
        "DrawCycle locked tickets must reflect only pre-merge active tickets"
    );
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Skipped,
        "DrawCycle status must be Skipped when zero yield"
    );
}

#[test]
fn test_harvest_happy_path_cycle_advances() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(0, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(0, 0, 0, 0)
        .build();
    let current_ts = 1_700_001_000i64;
    ctx.send_harvest(1, 0).expect("cycle advance harvest");

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.current_draw_cycle_id, 1,
        "Draw cycle id must increment to 1"
    );
    assert_eq!(
        pool.current_cycle_end_at,
        current_ts + 24 * 3600,
        "Current cycle end at must advance by duration"
    );
}

#[test]
fn test_harvest_fails_prize_tiers_not_configured() {
    // yield > 0, eligible > 0, but prize_tiers empty
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(2, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(1_000_000, 1_000_000, 2_000_000, 1_000_000)
        .build();
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::PrizeTiersNotConfigured,
    );
}

#[test]
fn test_harvest_happy_path_consecutive_cycles() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(0, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(0, 0, 0, 0)
        .build();
    ctx.send_harvest(1, 0).expect("first harvest");

    let pool = read_pool_state(&ctx.svm, 1);
    warp_to_timestamp(&mut ctx.svm, pool.current_cycle_end_at + 1);

    ctx.send_harvest(1, 1).expect("second harvest");

    let pool2 = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool2.current_draw_cycle_id, 2,
        "Draw cycle id must increment to 2"
    );

    let dc0 = read_draw_cycle_state(&ctx.svm, 1, 0);
    let dc1 = read_draw_cycle_state(&ctx.svm, 1, 1);
    assert_eq!(dc0.cycle_id, 0, "First draw cycle id must be 0");
    assert_eq!(dc1.cycle_id, 1, "Second draw cycle id must be 1");
}

#[test]
fn test_harvest_fails_invalid_mint() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(0, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(vec![])
        .with_raw_huma_state(0, 0, 0, 0)
        .build();
    let fake_mint = Keypair::new().pubkey();
    ctx.pst_mint = fake_mint;

    // Inject the fake mint into the SVM
    inject_mint_with_supply(&mut ctx.svm, fake_mint, 6, 0);

    let res = ctx.send_harvest(1, 0);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintTokenMint);
}

#[test]
fn test_harvest_succeeds_with_configured_switchboard_owner() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let configured_randomness = Keypair::new().pubkey();
    inject_randomness_account_data_with_owner(
        &mut ctx.svm,
        configured_randomness,
        0,
        0,
        [0u8; 32],
        anchor::constants::SWITCHBOARD_ON_DEMAND_PID,
    );
    ctx.randomness_account = configured_randomness;
    let res = ctx.send_harvest(1, 0);
    assert!(
        res.is_ok(),
        "Harvest must accept configured Switchboard PID: {:?}",
        res.err()
    );
}

#[test]
fn test_harvest_fails_unconfigured_switchboard_owner() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let unconfigured_randomness = Keypair::new().pubkey();
    inject_unconfigured_randomness_account(&mut ctx.svm, unconfigured_randomness);
    ctx.randomness_account = unconfigured_randomness;
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_harvest_fails_invalid_randomness_account_owner() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let foreign_randomness = Keypair::new().pubkey();
    inject_foreign_owner_randomness_account(
        &mut ctx.svm,
        foreign_randomness,
        Pubkey::default(),
    );
    ctx.randomness_account = foreign_randomness;
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_harvest_fails_invalid_randomness_account_discriminator() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let bad_randomness = Keypair::new().pubkey();
    inject_corrupted_randomness_discriminator(&mut ctx.svm, bad_randomness);
    ctx.randomness_account = bad_randomness;
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_harvest_fails_truncated_randomness_account() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let truncated_randomness = Keypair::new().pubkey();
    inject_truncated_randomness_account(&mut ctx.svm, truncated_randomness);
    ctx.randomness_account = truncated_randomness;
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_harvest_fails_zero_byte_randomness_account() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_status(anchor::PoolStatus::Active, false)
        .with_cycle_end_at(0)
        .build();
    let zero_byte_randomness = Keypair::new().pubkey();
    inject_zero_byte_randomness_account(&mut ctx.svm, zero_byte_randomness);
    ctx.randomness_account = zero_byte_randomness;
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}



#[test]
fn test_harvest_fails_math_overflow() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0) // active count > 0 to have yield_generated > 0
        .with_circuit_breaker(0, 100) // fee bps
        .with_prize_tiers(vec![anchor::PrizeTier::default_single_winner()]) // prize tiers not empty
        .with_raw_huma_state(1_000_000, 1_000_000, 2_000_000, 1_000_000)
        .build();

    mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.total_prizes_allocated = u64::MAX;
    });

    let res = ctx.send_harvest(1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_harvest_below_min_yield_threshold_skips_and_rolls_over() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    // 1M PST, 1M supply, 1.5M total_assets, 1M principal → raw yield = 500k
    // min_yield_threshold = 1M (1,000,000 > 500,000 raw yield)
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(5, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(tiers)
        .with_raw_huma_state(1_000_000, 1_000_000, 1_500_000, 1_000_000)
        .with_min_yield_threshold(1_000_000)
        .build();

    // Execute harvest
    let meta = ctx.send_harvest(1, 0).expect("harvest below threshold");
    let event = assert_cpi_event::<anchor::events::DrawSkipped>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawSkipped crank must match caller"
    );
    assert_eq!(event.pool_id, 1, "DrawSkipped pool_id must be 1");
    assert_eq!(event.cycle_id, 0, "DrawSkipped cycle_id must be 0");
    assert_eq!(
        event.raw_yield, 500_000,
        "DrawSkipped raw_yield must be 500,000"
    );
    assert_eq!(
        event.threshold, 1_000_000,
        "DrawSkipped threshold must be 1,000,000"
    );
    assert_eq!(
        event.locked_ticket_count, 5,
        "DrawSkipped locked_ticket_count must be 5"
    );
    assert_eq!(
        event.reason,
        anchor::DrawSkipReason::InsufficientYield,
        "DrawSkipReason must be InsufficientYield"
    );

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Skipped,
        "DrawCycle status must be Skipped"
    );
    assert_eq!(
        dc.locked_ticket_count, 5,
        "DrawCycle locked_ticket_count must be 5"
    );
    assert_eq!(dc.prize_pot, 0, "DrawCycle prize_pot must be 0");
    assert_eq!(
        dc.cycle_fee_collected, 0,
        "DrawCycle cycle_fee_collected must be 0"
    );

    let pool_state = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_state.is_frozen_for_draw, 0,
        "Pool is_frozen_for_draw must be 0 when skipped"
    );
    assert_eq!(
        pool_state.total_fees_accrued, 0,
        "Pool total_fees_accrued must be 0 when skipped"
    );
    assert_eq!(
        pool_state.total_prizes_allocated, 0,
        "Pool total_prizes_allocated must be 0 when skipped"
    );
}

#[test]
fn test_harvest_yield_and_commit_succeeds_immediately_after_create_pool_and_deposit() {
    // End-to-end test verifying that a newly created pool with atomic prize tiers
    // allows deposits and immediately completes a harvest draw cycle without calling set_prize_tiers.
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(default_prize_tiers())
        .with_raw_huma_state(1_000_000, 1_000_000, 2_000_000, 1_000_000)
        .build();

    ctx.send_harvest(1, 0)
        .expect("harvest should succeed immediately with atomic prize tiers");

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::AwaitingRandomness,
        "DrawCycle status must be AwaitingRandomness"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.is_frozen_for_draw, 1, "Pool must be frozen for draw");
    assert_eq!(
        pool.prize_tiers_count, 1,
        "Pool prize_tiers_count must be 1"
    );
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
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(0, 100) // 1% fee
        .with_prize_tiers(default_prize_tiers())
        .with_raw_huma_state(10_005_000, 10_000_000, 10_000_000, 10_000_000)
        .build();

    let meta = ctx.send_harvest(1, 0).expect("harvest with rolled-over dust should succeed");

    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "YieldHarvested crank must match caller"
    );
    // Yield generated = current_value (10_005_000) - book_value (10_000_000) = 5_000
    // Fee = 5_000 * 100 / 10_000 = 50 lamports
    // Prize pot = 4_950 lamports
    assert_eq!(
        event.raw_yield, 5_000,
        "YieldHarvested raw_yield must be 5_000"
    );
    assert_fee_partition_conserved(event.raw_yield, 100, event.fee, event.prize_pot);
    assert_eq!(
        event.fee + event.prize_pot,
        event.raw_yield,
        "Conservation: fee ({}) + prize_pot ({}) must equal raw_yield ({})",
        event.fee,
        event.prize_pot,
        event.raw_yield
    );

    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        updated_pool.total_prizes_allocated, event.prize_pot,
        "Pool total_prizes_allocated must match prize pot"
    );
    assert_eq!(
        updated_pool.total_fees_accrued, event.fee,
        "Pool total_fees_accrued must match fee"
    );
}

#[test]
fn test_harvest_fails_double_harvest_same_cycle() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(default_prize_tiers())
        .with_raw_huma_state(11_000_000, 10_000_000, 10_000_000, 10_000_000)
        .build();

    ctx.send_harvest(1, 0).expect("first harvest should succeed");

    // Second harvest in same cycle should fail
    let res = ctx.send_harvest(1, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

#[test]
fn test_harvest_fails_current_draw_cycle_id_overflow() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(0, 100)
        .with_prize_tiers(default_prize_tiers())
        .with_raw_huma_state(11_000_000, 10_000_000, 10_000_000, 10_000_000)
        .build();

    common::mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.current_draw_cycle_id = u32::MAX;
    });

    let res = ctx.send_harvest(1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_harvest_yield_fee_truncation_rounding() {
    // Setup pool with fee_basis_points = 1 (0.01%) and yield = 9_999 lamports
    // fee = 9_999 * 1 / 10_000 = 0 lamports (truncated)
    // prize_pot = 9_999 - 0 = 9_999 lamports
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(0, 1) // 1 bps fee
        .with_prize_tiers(default_prize_tiers())
        .with_raw_huma_state(10_009_999, 10_000_000, 10_000_000, 10_000_000)
        .build();

    let meta = ctx.send_harvest(1, 0).expect("harvest with fee truncation should succeed");
    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "YieldHarvested crank must match caller"
    );
    assert_eq!(
        event.raw_yield, 9_999,
        "YieldHarvested raw_yield must be 9_999"
    );
    assert_fee_partition_conserved(event.raw_yield, 1, event.fee, event.prize_pot);
    assert_eq!(
        event.fee + event.prize_pot,
        event.raw_yield,
        "Global mass conservation: fee + prize_pot == raw_yield"
    );

    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        updated_pool.total_prizes_allocated, event.prize_pot,
        "Pool total_prizes_allocated must match prize pot"
    );
    assert_eq!(
        updated_pool.total_fees_accrued, event.fee,
        "Pool total_fees_accrued must match fee"
    );
}

#[test]
fn test_harvest_yield_exact_temporal_boundaries() {
    let cycle_end_at = 1_700_050_000i64;

    // Boundary 1: cycle_end_at - 1 must fail with CycleNotEnded
    {
        let mut ctx = HarvestFixtureBuilder::new()
            .with_tickets(10, 0)
            .with_circuit_breaker(0, 100)
            .with_prize_tiers(default_prize_tiers())
            .with_raw_huma_state(11_000_000, 10_000_000, 10_000_000, 10_000_000)
            .with_cycle_end_at(cycle_end_at)
            .build();

        warp_to_timestamp(&mut ctx.svm, cycle_end_at - 1);
        let res = ctx.send_harvest(1, 0);
        assert_custom_error(res, anchor::error::PremiumBondsError::CycleNotEnded);
    }

    // Boundary 2: cycle_end_at must succeed
    {
        let mut ctx = HarvestFixtureBuilder::new()
            .with_tickets(10, 0)
            .with_circuit_breaker(0, 100)
            .with_prize_tiers(default_prize_tiers())
            .with_raw_huma_state(11_000_000, 10_000_000, 10_000_000, 10_000_000)
            .with_cycle_end_at(cycle_end_at)
            .build();

        warp_to_timestamp(&mut ctx.svm, cycle_end_at);
        let res = ctx.send_harvest(1, 0);
        assert!(
            res.is_ok(),
            "Harvest at exact cycle_end_at must succeed: {:?}",
            res.err()
        );
    }

    // Boundary 3: cycle_end_at + 1 must succeed
    {
        let mut ctx = HarvestFixtureBuilder::new()
            .with_tickets(10, 0)
            .with_circuit_breaker(0, 100)
            .with_prize_tiers(default_prize_tiers())
            .with_raw_huma_state(11_000_000, 10_000_000, 10_000_000, 10_000_000)
            .with_cycle_end_at(cycle_end_at)
            .build();

        warp_to_timestamp(&mut ctx.svm, cycle_end_at + 1);
        let res = ctx.send_harvest(1, 0);
        assert!(
            res.is_ok(),
            "Harvest at cycle_end_at + 1 must succeed: {:?}",
            res.err()
        );
    }
}
