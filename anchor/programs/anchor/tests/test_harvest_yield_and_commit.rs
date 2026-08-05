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

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const POOL_PST_SEED: &[u8] = b"pool_pst";
const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}
fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn pool_pst_vault_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_PST_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn draw_cycle_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            DRAW_CYCLE_SEED,
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

// ─── Account injection helpers ───────────────────────────────────────────────

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

fn inject_registry(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
    tickets: &[Pubkey],
) {
    let mut data = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]); // discriminator
    data[8..12].copy_from_slice(&pool_id.to_le_bytes());
    data[12..16].copy_from_slice(&capacity.to_le_bytes());

    let mut entries = Vec::new();
    if tickets.is_empty() {
        if active > 0 || pending > 0 {
            entries.push(anchor::state::UserEntry {
                owner: Pubkey::new_unique(),
                active,
                pending,
                merged_through_cycle: 0,
                cumulative_active: active,
                version: 1,
                _reserved: [0; 15],
            });
        }
    } else {
        let mut cum = 0;
        for &owner in tickets {
            cum += 1;
            entries.push(anchor::state::UserEntry {
                owner,
                active: 1,
                pending: 0,
                merged_through_cycle: 0,
                cumulative_active: cum,
                version: 1,
                _reserved: [0; 15],
            });
        }
    }

    let user_count = entries.len() as u32;
    data[16..20].copy_from_slice(&user_count.to_le_bytes()); // user_count
    data[20..24].copy_from_slice(&active.to_le_bytes()); // total_active_tickets
    data[24..28].copy_from_slice(&pending.to_le_bytes()); // total_pending_tickets
    data[28..32].copy_from_slice(&0u32.to_le_bytes()); // draw_cycle_id = 0
    data[32..36].copy_from_slice(&user_count.to_le_bytes()); // draw_prepared_up_to = user_count

    for (i, entry) in entries.iter().enumerate() {
        anchor::utils::registry_set_entry(&mut data, i, entry);
    }

    svm.set_account(
        address,
        Account {
            lamports: 10_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_pool_custom(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    fee_wallet: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
    fee_basis_points: u16,
    cycle_end_at: i64,
    cycle_id: u32,
    prize_tiers: Vec<anchor::PrizeTier>,
    principal: u64,
) -> Pubkey {
    use anchor_lang::Discriminator;
    let (pda, bump) = pool_pda(pool_id);
    let mut fixed_tiers = [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10];
    let count = prize_tiers.len().min(10);
    fixed_tiers[..count].copy_from_slice(&prize_tiers[..count]);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry,
        fee_wallet,
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points,
        status: status as u8,
        total_deposited_principal: principal,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        current_cycle_end_at: cycle_end_at,
        is_frozen_for_draw: if is_frozen { 1 } else { 0 },
        current_draw_cycle_id: cycle_id,
        prize_tiers: fixed_tiers,
        prize_tiers_count: count as u8,
        _padding: [0; 1],
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

fn warp_clock(svm: &mut LiteSVM, unix_ts: i64) {
    let clock = solana_sdk::clock::Clock {
        unix_timestamp: unix_ts,
        ..Default::default()
    };
    svm.set_sysvar(&clock);
}

// ─── SVM bootstrap ───────────────────────────────────────────────────────────

fn setup_global_with_crank() -> (LiteSVM, Keypair, Keypair) {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    let admin = Keypair::new();
    let crank = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let (gc, _) = global_config_pda();
    let accounts = anchor::accounts::InitializeGlobal {
        global_config: gc,
        admin: admin.pubkey(),
        jobs_account: crank.pubkey(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("initialize_global");
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
) -> Result<litesvm::types::TransactionMetadata, String> {
    let ix = build_harvest_ix(ctx, pool_id, cycle_id);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map_err(|e| format!("{e:?}"))
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
    inject_mint(&mut svm, token_mint, 6, 0);
    inject_mint(&mut svm, pst_mint, 6, 0);

    let fee_wallet = Keypair::new().pubkey();
    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, 0, 0, &[]);

    let pool_key = pool_pda(1).0;
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 0);

    inject_pool_custom(
        &mut svm,
        1,
        token_mint,
        registry,
        fee_wallet,
        status,
        is_frozen,
        100,
        cycle_end_at,
        0,
        vec![],
        0,
    );

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state, 0);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    warp_clock(&mut svm, 1000);

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
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6, 0);
    inject_mint(&mut svm, pst_mint, 6, pst_supply);

    let fee_wallet = Keypair::new().pubkey();

    let mut tickets = Vec::new();
    for _ in 0..(active + pending) {
        tickets.push(Keypair::new().pubkey());
    }

    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, active, pending, &tickets);

    let pool_key = pool_pda(1).0;
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, pst_balance);

    inject_pool_custom(
        &mut svm,
        1,
        token_mint,
        registry,
        fee_wallet,
        anchor::PoolStatus::Active,
        false,
        fee_bps,
        0,
        0,
        prize_tiers,
        principal,
    );

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state, total_assets);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    warp_clock(&mut svm, 1000);

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
    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("UnauthorizedCrank"),
        "Expected UnauthorizedCrank, got: {err}"
    );
}

#[test]
fn test_harvest_fails_pool_not_active() {
    let mut ctx = setup_guard(anchor::PoolStatus::Paused, false, 0);
    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("PoolNotActive"),
        "Expected PoolNotActive, got: {err}"
    );
}

#[test]
fn test_harvest_fails_pool_frozen() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, true, 0);
    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("AwaitingRandomnessFreeze"),
        "Expected AwaitingRandomnessFreeze, got: {err}"
    );
}

#[test]
fn test_harvest_fails_cycle_not_ended() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, i64::MAX);
    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("CycleNotEnded"),
        "Expected CycleNotEnded, got: {err}"
    );
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
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.raw_yield, 0);

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Skipped);
    assert_eq!(dc.prize_pot, 0);
    assert_eq!(dc.cycle_fee_collected, 0);
    assert_eq!(dc.locked_ticket_count, 0); // no active before merge

    let (active, pending) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active, 3); // pending merged
    assert_eq!(pending, 0);
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
    send_harvest(&mut ctx, 1, 0).expect("yield no eligible harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Skipped);
    assert_eq!(dc.cycle_fee_collected, 0);
    assert_eq!(dc.prize_pot, 0);
    assert_eq!(dc.locked_ticket_count, 0);

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_accrued, 0);
}

#[test]
fn test_harvest_happy_path_yield_and_eligible() {
    // Yield > 0, active > 0, tiers set → AwaitingRandomness + pool frozen
    let tiers = vec![anchor::PrizeTier {
        basis_points: 10000,
        num_winners: 1,
        _padding: [0, 0],
    }];
    // 2M PST, 2M supply, 2.5M total_assets, 2M principal
    // yield = 2M * 2.5M / 2M - 2M = 500K
    let mut ctx = setup_happy(2, 1, 100, tiers, 2_000_000, 2_000_000, 2_500_000, 2_000_000);
    let meta = send_harvest(&mut ctx, 1, 0).expect("yield + eligible harvest");
    let event = assert_cpi_event::<anchor::events::YieldHarvested>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.raw_yield, 500_000);
    assert_eq!(event.fee, 5_000);
    assert_eq!(event.prize_pot, 495_000);
    assert_eq!(event.locked_ticket_count, 2);

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::AwaitingRandomness);
    assert_eq!(dc.locked_ticket_count, 2); // only active, not pending

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.is_frozen_for_draw, 1);
}

#[test]
fn test_harvest_happy_path_fee_exact() {
    // yield=1M, fee_bps=250 (2.5%) → fee=25_000
    let tiers = vec![anchor::PrizeTier {
        basis_points: 10000,
        num_winners: 1,
        _padding: [0, 0],
    }];
    // 1M PST, 1M supply, 2M total_assets, 1M principal → yield=1M
    let mut ctx = setup_happy(1, 0, 250, tiers, 1_000_000, 1_000_000, 2_000_000, 1_000_000);
    send_harvest(&mut ctx, 1, 0).expect("fee exact harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    let expected_fee = 25_000u64;
    assert_eq!(dc.cycle_fee_collected, expected_fee);
    assert_eq!(dc.prize_pot, 1_000_000 - expected_fee);

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_accrued, expected_fee);
}

#[test]
fn test_harvest_happy_path_zero_fee_bps() {
    let tiers = vec![anchor::PrizeTier {
        basis_points: 10000,
        num_winners: 1,
        _padding: [0, 0],
    }];
    // 1M PST, 1M supply, 1.5M total_assets, 1M principal → yield=500K, fee=0
    let mut ctx = setup_happy(1, 0, 0, tiers, 1_000_000, 1_000_000, 1_500_000, 1_000_000);
    send_harvest(&mut ctx, 1, 0).expect("zero fee harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.cycle_fee_collected, 0);
    assert_eq!(dc.prize_pot, 500_000);

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_accrued, 0);
}

#[test]
fn test_harvest_happy_path_pending_merge() {
    // 2 active + 3 pending → after: 5 active, 0 pending
    let mut ctx = setup_happy(2, 3, 100, vec![], 0, 0, 0, 0);
    send_harvest(&mut ctx, 1, 0).expect("merge harvest");

    let (active, pending) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active, 5);
    assert_eq!(pending, 0);

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.locked_ticket_count, 2); // only pre-merge active count
    assert_eq!(dc.status, anchor::DrawStatus::Skipped);
}

#[test]
fn test_harvest_happy_path_cycle_advances() {
    let mut ctx = setup_happy(0, 0, 100, vec![], 0, 0, 0, 0);
    send_harvest(&mut ctx, 1, 0).expect("cycle advance harvest");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.current_draw_cycle_id, 1);
    assert_eq!(pool.current_cycle_end_at, 1000 + 24 * 3600);
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
    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("PrizeTiersNotConfigured"),
        "Expected PrizeTiersNotConfigured, got: {err}"
    );
}

#[test]
fn test_harvest_happy_path_consecutive_cycles() {
    let mut ctx = setup_happy(0, 0, 100, vec![], 0, 0, 0, 0);
    send_harvest(&mut ctx, 1, 0).expect("first harvest");

    let pool = read_pool(&ctx.svm, 1);
    warp_clock(&mut ctx.svm, pool.current_cycle_end_at + 1);

    send_harvest(&mut ctx, 1, 1).expect("second harvest");

    let pool2 = read_pool(&ctx.svm, 1);
    assert_eq!(pool2.current_draw_cycle_id, 2);

    let dc0 = read_draw_cycle(&ctx.svm, 1, 0);
    let dc1 = read_draw_cycle(&ctx.svm, 1, 1);
    assert_eq!(dc0.cycle_id, 0);
    assert_eq!(dc1.cycle_id, 1);
}

#[test]
fn test_harvest_fails_invalid_mint() {
    let mut ctx = setup_happy(0, 0, 100, vec![], 0, 0, 0, 0);
    let fake_mint = Keypair::new().pubkey();
    ctx.pst_mint = fake_mint;

    // Inject the fake mint into the SVM
    inject_mint(&mut ctx.svm, fake_mint, 6, 0);

    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("ConstraintMint") || err.contains("ConstraintRaw") || err.contains("0x7de"),
        "Expected constraint error, got: {err}"
    );
}

#[test]
fn test_harvest_fails_invalid_randomness_account() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, 0);
    ctx.randomness_account = Keypair::new().pubkey();
    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("InvalidRandomnessAccount"),
        "Expected InvalidRandomnessAccount, got: {err}"
    );
}

#[test]
fn test_harvest_fails_math_overflow() {
    let mut ctx = setup_happy(
        10, // active count > 0 to have yield_generated > 0
        0,
        100, // fee bps
        vec![anchor::PrizeTier {
            basis_points: 10000,
            num_winners: 1,
            _padding: [0, 0],
        }], // prize tiers not empty
        1_000_000, // pst_balance
        1_000_000, // pst_supply
        2_000_000, // total_assets
        1_000_000, // principal
    );

    let (pool_pda_key, _) = pool_pda(1);
    let mut pool_acct = ctx.svm.get_account(&pool_pda_key).unwrap();
    let mut pool = *bytemuck::from_bytes::<anchor::PrizePool>(&pool_acct.data[8..8 + std::mem::size_of::<anchor::PrizePool>()]);
    pool.total_prizes_allocated = u64::MAX;
    use anchor_lang::Discriminator;
    let mut new_data = vec![];
    new_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    new_data.extend_from_slice(bytemuck::bytes_of(&pool));
    pool_acct.data = new_data;
    ctx.svm.set_account(pool_pda_key, pool_acct).unwrap();

    let err = send_harvest(&mut ctx, 1, 0).unwrap_err();
    assert!(
        err.contains("MathOverflow"),
        "Expected MathOverflow error, got: {err}"
    );
}

#[test]
fn test_harvest_below_min_yield_threshold_skips_and_rolls_over() {
    let tiers = vec![anchor::PrizeTier {
        basis_points: 10000,
        num_winners: 1,
        _padding: [0, 0],
    }];
    // 1M PST, 1M supply, 1.5M total_assets, 1M principal → raw yield = 500k
    let mut ctx = setup_happy(5, 0, 100, tiers, 1_000_000, 1_000_000, 1_500_000, 1_000_000);

    // Set min_yield_threshold to 1M (1,000,000 > 500,000 raw yield)
    let (pool_pda_key, _) = pool_pda(1);
    let mut pool_acct = ctx.svm.get_account(&pool_pda_key).unwrap();
    let mut pool = *bytemuck::from_bytes::<anchor::PrizePool>(&pool_acct.data[8..8 + std::mem::size_of::<anchor::PrizePool>()]);
    pool.min_yield_threshold = 1_000_000;
    let mut new_data = vec![];
    new_data.extend_from_slice(&<anchor::PrizePool as anchor_lang::Discriminator>::DISCRIMINATOR);
    new_data.extend_from_slice(bytemuck::bytes_of(&pool));
    pool_acct.data = new_data;
    ctx.svm.set_account(pool_pda_key, pool_acct).unwrap();

    // Execute harvest
    send_harvest(&mut ctx, 1, 0).expect("harvest below threshold");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Skipped);

    let pool_state = read_pool(&ctx.svm, 1);
    assert_eq!(pool_state.is_frozen_for_draw, 0);
    assert_eq!(pool_state.total_fees_accrued, 0);
    assert_eq!(pool_state.total_prizes_allocated, 0);
}
