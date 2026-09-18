//! Integration tests for automated on-chain circuit breakers in `harvest_yield_and_commit`.
//!
//! Verifies:
//! 1. Solvency Circuit Breaker: When venue balance is less than book value (deficit > SOLVENCY_DUST_TOLERANCE),
//!    pool is automatically paused, draw cycle marked HaltedInsolvent, and EmergencyInsolvencyDetected emitted.
//! 2. Yield Velocity Circuit Breaker: When yield generated in a single cycle exceeds max_yield_basis_points,
//!    pool is automatically paused, draw cycle marked HaltedYieldSpike, and YieldVelocityBreached emitted.

use {
    anchor_lang::AccountDeserialize,
    solana_signer::Signer,
};

mod common;
use common::*;

#[test]
fn test_solvency_circuit_breaker_halts_when_venue_in_deficit() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_insolvency_deficit(10_000_000, 2_000_000)
        .build();

    let meta = ctx
        .send_harvest(1, 0)
        .expect("Harvest should succeed and commit pause state");

    // Verify EmergencyInsolvencyDetected event was emitted
    let event = assert_cpi_event::<anchor::events::EmergencyInsolvencyDetected>(&meta);
    assert_eq!(event.pool_id, 1, "Event pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "Event cycle_id mismatch");
    assert_eq!(event.crank, ctx.crank.pubkey(), "Event crank mismatch");
    assert_eq!(event.current_value, 8_000_000, "Current value mismatch");
    assert_eq!(event.book_value, 10_000_000, "Book value mismatch");
    assert_eq!(event.deficit, 2_000_000, "Deficit mismatch");
    assert_eq!(event.locked_ticket_count, 10, "Locked tickets mismatch");

    // Verify Pool is now Paused and cycle advanced
    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_after.status,
        anchor::PoolStatus::Paused as u8,
        "Pool should be paused"
    );
    assert_eq!(
        pool_after.is_frozen_for_draw, 0,
        "Pool should not be frozen for draw"
    );
    assert_eq!(
        pool_after.current_draw_cycle_id, 1,
        "Draw cycle ID should advance"
    );

    // Verify DrawCycle is HaltedInsolvent
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(
        dc.status,
        anchor::DrawStatus::HaltedInsolvent,
        "DrawStatus should be HaltedInsolvent"
    );
    assert_eq!(dc.locked_ticket_count, 10, "Locked ticket count mismatch");
    assert_eq!(dc.prize_pot, 0, "Prize pot should be 0");
    assert_eq!(dc.cycle_fee_collected, 0, "Cycle fee should be 0");
    assert!(dc.initiated_at > 0, "Initiated at should be positive");
    assert_eq!(
        dc.completed_at, dc.initiated_at,
        "Completed at should equal initiated at"
    );
}

#[test]
fn test_yield_velocity_circuit_breaker_halts_on_spike() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(500, 100)
        .with_simulated_yield(10_000_000, 2_000_000)
        .build();

    let meta = ctx
        .send_harvest(1, 0)
        .expect("Harvest should succeed and commit pause state on velocity spike");

    // Verify YieldVelocityBreached event was emitted
    let event = assert_cpi_event::<anchor::events::YieldVelocityBreached>(&meta);
    assert_eq!(event.pool_id, 1, "Event pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "Event cycle_id mismatch");
    assert_eq!(event.crank, ctx.crank.pubkey(), "Event crank mismatch");
    assert_eq!(event.yield_generated, 2_000_000, "Yield generated mismatch");
    assert_eq!(
        event.max_allowed_yield, 500_000,
        "Max allowed yield mismatch"
    ); // 5% of 10M
    assert_eq!(
        event.locked_ticket_count, 10,
        "Locked ticket count mismatch"
    );

    // Verify Pool is now Paused and cycle advanced
    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_after.status,
        anchor::PoolStatus::Paused as u8,
        "Pool should be paused"
    );
    assert_eq!(
        pool_after.is_frozen_for_draw, 0,
        "Pool should not be frozen for draw"
    );
    assert_eq!(
        pool_after.current_draw_cycle_id, 1,
        "Draw cycle ID should advance"
    );

    // Verify DrawCycle is HaltedYieldSpike
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(
        dc.status,
        anchor::DrawStatus::HaltedYieldSpike,
        "DrawStatus should be HaltedYieldSpike"
    );
    assert_eq!(dc.locked_ticket_count, 10, "Locked ticket count mismatch");
    assert_eq!(dc.prize_pot, 0, "Prize pot should be 0");
    assert_eq!(dc.cycle_fee_collected, 0, "Cycle fee should be 0");
    assert!(dc.initiated_at > 0, "Initiated at should be positive");
    assert_eq!(
        dc.completed_at, dc.initiated_at,
        "Completed at should equal initiated at"
    );
}

#[test]
fn test_solvency_circuit_breaker_halts_with_zero_active_tickets() {
    let mut ctx = HarvestFixtureBuilder::new()
        .with_tickets(0, 10)
        .with_insolvency_deficit(10_000_000, 3_000_000)
        .build();

    let meta = ctx
        .send_harvest(1, 0)
        .expect("Harvest should halt and pause pool even with 0 active tickets");

    let event = assert_cpi_event::<anchor::events::EmergencyInsolvencyDetected>(&meta);
    assert_eq!(event.pool_id, 1, "Event pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "Event cycle_id mismatch");
    assert_eq!(event.crank, ctx.crank.pubkey(), "Event crank mismatch");
    assert_eq!(event.current_value, 7_000_000, "Current value mismatch");
    assert_eq!(event.book_value, 10_000_000, "Book value mismatch");
    assert_eq!(event.deficit, 3_000_000, "Deficit mismatch");
    assert_eq!(event.locked_ticket_count, 0, "Locked tickets mismatch");

    // Verify Pool is Paused and cycle advanced
    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_after.status,
        anchor::PoolStatus::Paused as u8,
        "Pool should be paused"
    );
    assert_eq!(
        pool_after.current_draw_cycle_id, 1,
        "Draw cycle ID should advance"
    );

    // Verify DrawCycle is HaltedInsolvent and base metadata is present
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(
        dc.status,
        anchor::DrawStatus::HaltedInsolvent,
        "DrawStatus should be HaltedInsolvent"
    );
    assert!(dc.initiated_at > 0, "Initiated at should be positive");
    assert_eq!(
        dc.completed_at, dc.initiated_at,
        "Completed at should equal initiated at"
    );
    assert_eq!(dc.pool_id, 1, "Pool ID mismatch");
    assert_eq!(dc.cycle_id, 0, "Cycle ID mismatch");
    assert_eq!(dc.locked_ticket_count, 0, "Locked ticket count mismatch");
    assert_eq!(dc.prize_pot, 0, "Prize pot should be 0");
    assert_eq!(dc.cycle_fee_collected, 0);
}

#[test]
fn test_solvency_circuit_breaker_exact_dust_tolerance_boundary() {
    // Case 1: Deficit == SOLVENCY_DUST_TOLERANCE (1,000 lamports deficit -> total_assets = 9_999_000)
    // Within dust tolerance -> does NOT halt, stays Active
    let mut ctx_pass = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_insolvency_deficit(10_000_000, 1_000)
        .build();
    let _meta_pass = ctx_pass
        .send_harvest(1, 0)
        .expect("Deficit <= dust tolerance should proceed normally");
    let pool_pass = read_pool_state(&ctx_pass.svm, 1);
    assert_eq!(pool_pass.status, anchor::PoolStatus::Active as u8);

    // Case 2: Deficit == SOLVENCY_DUST_TOLERANCE + 1 (1,001 lamports deficit -> total_assets = 9_998_999)
    // Exceeds dust tolerance -> halts and pauses pool
    let mut ctx_halt = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_insolvency_deficit(10_000_000, 1_001)
        .build();
    let meta_halt = ctx_halt
        .send_harvest(1, 0)
        .expect("Deficit > dust tolerance should halt");
    let event = assert_cpi_event::<anchor::events::EmergencyInsolvencyDetected>(&meta_halt);
    assert_eq!(event.crank, ctx_halt.crank.pubkey());
    assert_eq!(event.deficit, 1001);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.locked_ticket_count, 10);
    let pool_halt = read_pool_state(&ctx_halt.svm, 1);
    assert_eq!(pool_halt.status, anchor::PoolStatus::Paused as u8);
}

#[test]
fn test_yield_velocity_spike_guard_exact_boundary() {
    let max_yield_basis_points = 500u16; // 5.0% = 500,000 lamports max allowed

    // Case 1: Yield == max_allowed_yield (500_000 lamports -> total_assets = 10_500_000)
    // Passes without halting
    let mut ctx_pass = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(max_yield_basis_points, 100)
        .with_simulated_yield(10_000_000, 500_000)
        .build();
    let _meta_pass = ctx_pass
        .send_harvest(1, 0)
        .expect("Yield <= max allowed should proceed normally");
    let pool_pass = read_pool_state(&ctx_pass.svm, 1);
    assert_eq!(pool_pass.status, anchor::PoolStatus::Active as u8);

    // Case 2: Yield == max_allowed_yield + 1 (500_001 lamports -> total_assets = 10_500_001)
    // Exceeds limit by 1 lamport -> halts and pauses pool
    let mut ctx_halt = HarvestFixtureBuilder::new()
        .with_tickets(10, 0)
        .with_circuit_breaker(max_yield_basis_points, 100)
        .with_simulated_yield(10_000_000, 500_001)
        .build();
    let meta_halt = ctx_halt
        .send_harvest(1, 0)
        .expect("Yield > max allowed should halt");
    let event = assert_cpi_event::<anchor::events::YieldVelocityBreached>(&meta_halt);
    assert_eq!(
        event.crank,
        ctx_halt.crank.pubkey(),
        "event crank must match caller"
    );
    assert_eq!(
        event.yield_generated, 500_001,
        "event yield_generated must match breach yield"
    );
    assert_eq!(
        event.max_allowed_yield, 500_000,
        "event max_allowed_yield must match limit"
    );
    assert_eq!(event.cycle_id, 0, "event cycle_id must match current cycle");
    assert_eq!(
        event.locked_ticket_count, 10,
        "event locked_ticket_count must match tickets"
    );
    let pool_halt = read_pool_state(&ctx_halt.svm, 1);
    assert_eq!(
        pool_halt.status,
        anchor::PoolStatus::Paused as u8,
        "pool status must transition to Paused"
    );
}
