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

fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8, supply: u64) {
    let mut data = vec![0u8; 82];
    data[36..44].copy_from_slice(&supply.to_le_bytes());
    data[44] = decimals;
    data[45] = 1;
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_token_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[32..64].copy_from_slice(&owner.to_bytes());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_huma_pool_state_with_assets(
    svm: &mut LiteSVM,
    address: Pubkey,
    _pst_mint: Pubkey,
    total_assets: u128,
) {
    let size = 30 + 16 + 16 + 16 + 8 + 160;
    let mut data = vec![0u8; size];
    data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
    data[30..46].copy_from_slice(&total_assets.to_le_bytes()); // assets (u128) at offset 30
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

fn setup_circuit_breaker_ctx(
    max_yield_basis_points: u16,
    deposited_principal: u64,
    pst_shares_amount: u64,
    pst_supply: u64,
    total_assets: u128,
) -> CircuitBreakerCtx {
    setup_circuit_breaker_ctx_with_tickets(
        max_yield_basis_points,
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        total_assets,
        10,
        0,
    )
}

fn setup_circuit_breaker_ctx_with_tickets(
    max_yield_basis_points: u16,
    deposited_principal: u64,
    pst_shares_amount: u64,
    pst_supply: u64,
    total_assets: u128,
    active_tickets: u32,
    pending_tickets: u32,
) -> CircuitBreakerCtx {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let pool_id = 1;
    let (pool_pda, bump) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();

    inject_mint(&mut svm, token_mint, 6, 1_000_000_000_000);
    inject_mint(&mut svm, pst_mint, 6, pst_supply);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_pda, pst_shares_amount);

    let ticket_registry = Keypair::new().pubkey();
    inject_registry(&mut svm, ticket_registry, pool_id, 100, active_tickets, pending_tickets);

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state_with_assets(&mut svm, huma_pool_state, pst_mint, total_assets);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    use anchor_lang::Discriminator;
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points,
        payout_timelock_seconds: 300,
        status: anchor::PoolStatus::Active as u8,
        total_deposited_principal: deposited_principal,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: 0,
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier { num_winners: 1, basis_points: 10000, _padding: [0, 0] }; 10],
        prize_tiers_count: 1,
        _padding: [0; 3],
        version: 1,
        _reserved: [0; 128],
    };

    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));

    svm.set_account(
        pool_pda,
        Account {
            lamports: 1_000_000_000,
            data: pool_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

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

fn send_harvest(ctx: &mut CircuitBreakerCtx, pool_id: u32, cycle_id: u32) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
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
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.current_value, 8_000_000);
    assert_eq!(event.book_value, 10_000_000);
    assert_eq!(event.deficit, 2_000_000);

    // Verify Pool is now Paused
    let pool_after_acc = ctx.svm.get_account(&ctx.pool_pda).unwrap();
    let pool_after = bytemuck::from_bytes::<anchor::PrizePool>(&pool_after_acc.data[8..]);
    assert_eq!(pool_after.status, anchor::PoolStatus::Paused as u8);
    assert_eq!(pool_after.is_frozen_for_draw, 0);

    // Verify DrawCycle is HaltedInsolvent
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle = anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::HaltedInsolvent);
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

    let meta = send_harvest(&mut ctx, 1, 0).expect("Harvest should succeed and commit pause state on velocity spike");

    // Verify YieldVelocityBreached event was emitted
    let event = assert_cpi_event::<anchor::events::YieldVelocityBreached>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.yield_generated, 2_000_000);
    assert_eq!(event.max_allowed_yield, 500_000); // 5% of 10M

    // Verify Pool is now Paused
    let pool_after_acc = ctx.svm.get_account(&ctx.pool_pda).unwrap();
    let pool_after = bytemuck::from_bytes::<anchor::PrizePool>(&pool_after_acc.data[8..]);
    assert_eq!(pool_after.status, anchor::PoolStatus::Paused as u8);
    assert_eq!(pool_after.is_frozen_for_draw, 0);

    // Verify DrawCycle is HaltedYieldSpike
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle = anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::HaltedYieldSpike);
}

#[test]
fn test_solvency_circuit_breaker_halts_with_zero_active_tickets() {
    let deposited_principal = 10_000_000; // 10 USDC book value
    let pst_supply = 10_000_000;
    let pst_shares_amount = 10_000_000;
    // Venue deficit with 0 active tickets (10 pending tickets)
    let total_assets = 7_000_000u128; // 3 USDC deficit

    let mut ctx = setup_circuit_breaker_ctx_with_tickets(
        0, // uncapped velocity
        deposited_principal,
        pst_shares_amount,
        pst_supply,
        total_assets,
        0,  // 0 active tickets!
        10, // 10 pending tickets
    );

    let meta = send_harvest(&mut ctx, 1, 0)
        .expect("Harvest should halt and pause pool even with 0 active tickets");

    let event = assert_cpi_event::<anchor::events::EmergencyInsolvencyDetected>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.current_value, 7_000_000);
    assert_eq!(event.book_value, 10_000_000);
    assert_eq!(event.deficit, 3_000_000);

    // Verify Pool is Paused
    let pool_after_acc = ctx.svm.get_account(&ctx.pool_pda).unwrap();
    let pool_after = bytemuck::from_bytes::<anchor::PrizePool>(&pool_after_acc.data[8..]);
    assert_eq!(pool_after.status, anchor::PoolStatus::Paused as u8);

    // Verify DrawCycle is HaltedInsolvent and base metadata is present
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc_acc = ctx.svm.get_account(&dc_pda).unwrap();
    let dc: anchor::DrawCycle =
        anchor_lang::AccountDeserialize::try_deserialize(&mut dc_acc.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::HaltedInsolvent);
    assert_eq!(dc.pool_id, 1);
    assert_eq!(dc.cycle_id, 0);
    assert_eq!(dc.locked_ticket_count, 0);
}

