//! Integration tests for automated on-chain circuit breakers in `harvest_yield_and_commit`.
//!
//! Verifies:
//! 1. Solvency Circuit Breaker: When venue balance is less than book value (deficit > SOLVENCY_DUST_TOLERANCE),
//!    pool is automatically paused, draw cycle marked HaltedInsolvent, and EmergencyInsolvencyDetected emitted.
//! 2. Yield Velocity Circuit Breaker: When yield generated in a single cycle exceeds max_yield_basis_points,
//!    pool is automatically paused, draw cycle marked HaltedYieldSpike, and YieldVelocityBreached emitted.

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::instruction::Instruction,
    solana_sdk::account::Account,
    solana_sdk::message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

struct CircuitBreakerCtx {
    svm: LiteSVM,
    admin: Keypair,
    crank: Keypair,
    pool_pda: Pubkey,
    pst_mint: Pubkey,
    ticket_registry: Pubkey,
    huma_pool_state: Pubkey,
    randomness_account: Pubkey,
}

pub struct CircuitBreakerTestParams {
    pub max_yield_basis_points: u16,
    pub deposited_principal: u64,
    pub pst_shares_amount: u64,
    pub pst_supply: u64,
    pub total_assets: u128,
    pub active_tickets: u32,
    pub pending_tickets: u32,
}

fn setup_circuit_breaker_ctx(
    max_yield_basis_points: u16,
    deposited_principal: u64,
    pst_shares_amount: u64,
    pst_supply: u64,
    total_assets: u128,
) -> CircuitBreakerCtx {
    setup_circuit_breaker_ctx_with_params(CircuitBreakerTestParams {
        max_yield_basis_points,
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        total_assets,
        active_tickets: 10,
        pending_tickets: 0,
    })
}

fn setup_circuit_breaker_ctx_with_params(params: CircuitBreakerTestParams) -> CircuitBreakerCtx {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let (pool_pda, bump) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();

    inject_mint_with_supply(&mut svm, token_mint, 6, 1_000_000_000_000);
    inject_mint_with_supply(&mut svm, pst_mint, 6, params.pst_supply);
    inject_token_account(
        &mut svm,
        pool_pst_vault,
        pst_mint,
        pool_pda,
        params.pst_shares_amount,
    );

    let ticket_registry = Keypair::new().pubkey();
    inject_registry(
        &mut svm,
        ticket_registry,
        pool_id,
        100,
        params.active_tickets,
        params.pending_tickets,
    );

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state_with_assets(&mut svm, huma_pool_state, params.total_assets);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(ticket_registry)
        .with_huma_pool_state(huma_pool_state)
        .with_principal(params.deposited_principal)
        .with_max_yield_basis_points(params.max_yield_basis_points)
        .with_payout_timelock_seconds(300)
        .with_prize_tiers(vec![anchor::PrizeTier::default_single_winner()])
        .inject(&mut svm);

    CircuitBreakerCtx {
        svm,
        admin,
        crank,
        pool_pda,
        pst_mint,
        ticket_registry,
        huma_pool_state,
        randomness_account,
    }
}

fn build_harvest_ix(ctx: &CircuitBreakerCtx, pool_id: u32, cycle_id: u32) -> Instruction {
    let (gc, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);

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
    ctx: &mut CircuitBreakerCtx,
    pool_id: u32,
    cycle_id: u32,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let ix = build_harvest_ix(ctx, pool_id, cycle_id);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx)
}

#[test]
fn test_solvency_circuit_breaker_halts_when_venue_in_deficit() {
    let deposited_principal = 10_000_000; // 10 USDC book value
    let pst_supply = 10_000_000;
    let pst_shares_amount = 10_000_000;
    // Venue suffered a loss: total_assets dropped to 8_000_000 (2 USDC deficit > 1000 dust tolerance)
    let total_assets = 8_000_000u128;

    let mut ctx = setup_circuit_breaker_ctx(
        0, // uncapped velocity
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        total_assets,
    );

    let meta = send_harvest(&mut ctx, 1, 0).expect("Harvest should succeed and commit pause state");

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
    let deposited_principal = 10_000_000; // 10 USDC book value
    let pst_supply = 10_000_000;
    let pst_shares_amount = 10_000_000;
    // Single cycle yield is 2 USDC (20% return).
    // Configured max_yield_basis_points = 500 (5.0% max allowed = 0.5 USDC).
    let total_assets = 12_000_000u128;

    let mut ctx = setup_circuit_breaker_ctx(
        500, // 5% max velocity
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        total_assets,
    );

    let meta = send_harvest(&mut ctx, 1, 0)
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
    let deposited_principal = 10_000_000; // 10 USDC book value
    let pst_supply = 10_000_000;
    let pst_shares_amount = 10_000_000;
    // Venue deficit with 0 active tickets (10 pending tickets)
    let total_assets = 7_000_000u128; // 3 USDC deficit

    let mut ctx = setup_circuit_breaker_ctx_with_params(CircuitBreakerTestParams {
        max_yield_basis_points: 0, // uncapped velocity
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        total_assets,
        active_tickets: 0,   // 0 active tickets!
        pending_tickets: 10, // 10 pending tickets
    });

    let meta = send_harvest(&mut ctx, 1, 0)
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
    let deposited_principal = 10_000_000u64;
    let pst_supply = 10_000_000u64;
    let pst_shares_amount = 10_000_000u64;

    // Case 1: Deficit == SOLVENCY_DUST_TOLERANCE (1,000 lamports deficit -> total_assets = 9_999_000)
    // Within dust tolerance -> does NOT halt, stays Active
    let mut ctx_pass = setup_circuit_breaker_ctx(
        0,
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        9_999_000u128,
    );
    let meta_pass = send_harvest(&mut ctx_pass, 1, 0)
        .expect("Deficit <= dust tolerance should proceed normally");
    let pool_pass = read_pool_state(&ctx_pass.svm, 1);
    assert_eq!(pool_pass.status, anchor::PoolStatus::Active as u8);

    // Case 2: Deficit == SOLVENCY_DUST_TOLERANCE + 1 (1,001 lamports deficit -> total_assets = 9_998_999)
    // Exceeds dust tolerance -> halts and pauses pool
    let mut ctx_halt = setup_circuit_breaker_ctx(
        0,
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        9_998_999u128,
    );
    let meta_halt =
        send_harvest(&mut ctx_halt, 1, 0).expect("Deficit > dust tolerance should halt");
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
    let deposited_principal = 10_000_000u64;
    let pst_supply = 10_000_000u64;
    let pst_shares_amount = 10_000_000u64;
    let max_yield_basis_points = 500u16; // 5.0% = 500,000 lamports max allowed

    // Case 1: Yield == max_allowed_yield (500_000 lamports -> total_assets = 10_500_000)
    // Passes without halting
    let mut ctx_pass = setup_circuit_breaker_ctx(
        max_yield_basis_points,
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        10_500_000u128,
    );
    let meta_pass =
        send_harvest(&mut ctx_pass, 1, 0).expect("Yield <= max allowed should proceed normally");
    let pool_pass = read_pool_state(&ctx_pass.svm, 1);
    assert_eq!(pool_pass.status, anchor::PoolStatus::Active as u8);

    // Case 2: Yield == max_allowed_yield + 1 (500_001 lamports -> total_assets = 10_500_001)
    // Exceeds limit by 1 lamport -> halts and pauses pool
    let mut ctx_halt = setup_circuit_breaker_ctx(
        max_yield_basis_points,
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        10_500_001u128,
    );
    let meta_halt = send_harvest(&mut ctx_halt, 1, 0).expect("Yield > max allowed should halt");
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
