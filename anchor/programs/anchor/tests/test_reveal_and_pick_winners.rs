//! Integration tests for `reveal_and_pick_winners`.

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

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
const PAYOUT_SEED: &[u8] = b"payout";

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}
fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn draw_cycle_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[DRAW_CYCLE_SEED, pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}
fn payout_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PAYOUT_SEED, pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_registry(svm: &mut LiteSVM, address: Pubkey, pool_id: u32, capacity: u32, active: u32, pending: u32, tickets: &[Pubkey]) {
    let mut data = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]);
    data[8..12].copy_from_slice(&pool_id.to_le_bytes());
    data[12..16].copy_from_slice(&capacity.to_le_bytes());
    data[16..20].copy_from_slice(&active.to_le_bytes());
    data[20..24].copy_from_slice(&pending.to_le_bytes());
    for (i, pk) in tickets.iter().enumerate() {
        let s = 24 + i * 32;
        data[s..s + 32].copy_from_slice(pk.as_ref());
    }
    svm.set_account(address, Account {
        lamports: 10_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0,
    }).unwrap();
}

fn inject_pool_custom(
    svm: &mut LiteSVM, pool_id: u32, ticket_registry: Pubkey,
    status: anchor::PoolStatus, is_frozen: bool,
    prize_tiers: Vec<anchor::PrizeTier>, cycle_id: u32,
) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump, pool_id, token_mint: Pubkey::default(),
        ticket_registry, fee_wallet: Pubkey::default(),
        bond_price: 1_000_000, stake_cycle_duration_hrs: 24,
        fee_basis_points: 100, status, total_deposited_principal: 0,
        total_fees_collected: 0, current_cycle_end_at: 0,
        is_frozen_for_draw: is_frozen, current_draw_cycle_id: cycle_id,
        max_withdrawal_slippage_dust: 0, prize_tiers, auto_reinvest_default: false,
    };
    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    svm.set_account(pda, Account {
        lamports: 1_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0,
    }).unwrap();
    pda
}

fn inject_draw_cycle(
    svm: &mut LiteSVM, pool_id: u32, cycle_id: u32,
    status: anchor::DrawStatus, locked_ticket_count: u32, prize_pot: u64,
) {
    let (pda, _) = draw_cycle_pda(pool_id, cycle_id);
    let dc = anchor::DrawCycle {
        pool_id, cycle_id, status, locked_ticket_count,
        randomness_seed: [0u8; 32], prize_pot, cycle_fee_collected: 0,
    };
    let mut data = vec![];
    dc.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::DrawCycle::INIT_SPACE, 0);
    svm.set_account(pda, Account {
        lamports: 1_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0,
    }).unwrap();
}

// ─── SVM bootstrap ───────────────────────────────────────────────────────────

fn setup_global_with_crank(max_tickets: u32) -> (LiteSVM, Keypair, Keypair) {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    let admin = Keypair::new();
    let crank = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let (gc, _) = global_config_pda();
    let accounts = anchor::accounts::InitializeGlobal {
        global_config: gc, admin: admin.pubkey(),
        jobs_account: crank.pubkey(),
        system_program: anchor_lang::system_program::ID,
    }.to_account_metas(None);
    let ix = Instruction { program_id: anchor::id(), accounts,
        data: anchor::instruction::InitializeGlobal { max_tickets_per_buy: max_tickets }.data() };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("initialize_global");
    (svm, admin, crank)
}

// ─── Context + helpers ───────────────────────────────────────────────────────

struct RevealCtx {
    svm: LiteSVM,
    crank: Keypair,
    ticket_registry: Pubkey,
    tickets: Vec<Pubkey>,  // known ticket pubkeys for verification
}

fn build_reveal_ix(ctx: &RevealCtx, pool_id: u32, cycle_id: u32, seed: [u8; 32]) -> Instruction {
    let (gc, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (dc, _) = draw_cycle_pda(pool_id, cycle_id);
    let (payout, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::RevealAndPickWinners {
        crank: ctx.crank.pubkey(), global_config: gc,
        current_draw_cycle: dc, pool,
        ticket_registry: ctx.ticket_registry,
        payout_registry: payout,
        system_program: anchor_lang::system_program::ID,
    }.to_account_metas(None);

    Instruction { program_id: anchor::id(), accounts,
        data: anchor::instruction::RevealAndPickWinners { random_seed: seed }.data() }
}

fn send_reveal(ctx: &mut RevealCtx, pool_id: u32, cycle_id: u32, seed: [u8; 32]) -> Result<(), String> {
    let ix = build_reveal_ix(ctx, pool_id, cycle_id, seed);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
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

fn read_payout_registry(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::PayoutRegistry {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let acct = svm.get_account(&pda).unwrap();
    anchor::PayoutRegistry::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

/// Recompute derive_random_index locally (mirrors program logic).
fn local_derive_random_index(seed: &[u8; 32], tier_idx: u32, winner_slot: u32, cycle_id: u32, ticket_count: u32) -> u64 {
    let hash = solana_program::hash::hashv(&[
        seed,
        &tier_idx.to_le_bytes(),
        &winner_slot.to_le_bytes(),
        &cycle_id.to_le_bytes(),
    ]).to_bytes();
    let mut buf = [0u8; 8];
    buf.copy_from_slice(&hash[0..8]);
    u64::from_le_bytes(buf) % (ticket_count as u64)
}

// ─── Setup builders ──────────────────────────────────────────────────────────

fn make_tickets(n: usize) -> Vec<Pubkey> {
    (0..n).map(|_| Keypair::new().pubkey()).collect()
}

fn setup_reveal(
    status: anchor::PoolStatus, is_frozen: bool,
    tiers: Vec<anchor::PrizeTier>, locked: u32, prize_pot: u64,
    num_tickets: usize,
) -> RevealCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank(100);

    let tickets = make_tickets(num_tickets);
    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, num_tickets as u32, 0, &tickets);

    inject_pool_custom(&mut svm, 1, registry, status, is_frozen, tiers, 0);
    inject_draw_cycle(&mut svm, 1, 0, anchor::DrawStatus::AwaitingRandomness, locked, prize_pot);

    RevealCtx { svm, crank, ticket_registry: registry, tickets }
}

/// Setup with overridden draw status (for guard tests).
fn setup_reveal_with_dc_status(dc_status: anchor::DrawStatus) -> RevealCtx {
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let (mut svm, _admin, crank) = setup_global_with_crank(100);

    let tickets = make_tickets(5);
    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, 5, 0, &tickets);
    inject_pool_custom(&mut svm, 1, registry, anchor::PoolStatus::Active, true, tiers, 0);
    inject_draw_cycle(&mut svm, 1, 0, dc_status, 5, 1_000_000);

    RevealCtx { svm, crank, ticket_registry: registry, tickets }
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_fails_unauthorized_crank() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active, true,
        vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }],
        5, 1_000_000, 5,
    );
    let fake = Keypair::new();
    ctx.svm.airdrop(&fake.pubkey(), 10_000_000_000).unwrap();
    ctx.crank = fake;
    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    assert!(err.contains("UnauthorizedCrank"), "got: {err}");
}

#[test]
fn test_reveal_fails_pool_not_active() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Paused, true,
        vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }],
        5, 1_000_000, 5,
    );
    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    assert!(err.contains("PoolNotActive"), "got: {err}");
}

#[test]
fn test_reveal_fails_invalid_draw_status() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::Complete);
    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    assert!(err.contains("InvalidDrawStatus"), "got: {err}");
}

#[test]
fn test_reveal_fails_prize_tiers_not_configured() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active, true, vec![], // empty tiers
        5, 1_000_000, 5,
    );
    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    assert!(err.contains("PrizeTiersNotConfigured"), "got: {err}");
}

// ═════════════════════════════════════════════════════════════════════════════
// InvalidDrawState edge guards
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_fails_zero_locked_tickets() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active, true,
        vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }],
        0, 1_000_000, 5, // locked=0
    );
    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    assert!(err.contains("InvalidDrawState"), "got: {err}");
}

#[test]
fn test_reveal_fails_zero_prize_pot() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active, true,
        vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }],
        5, 0, 5, // prize_pot=0
    );
    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    assert!(err.contains("InvalidDrawState"), "got: {err}");
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_single_tier_single_winner() {
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 1_000_000, 5);
    send_reveal(&mut ctx, 1, 0, [42u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 1);
    assert_eq!(pr.winners.len(), 1);
    assert_eq!(pr.winners[0].amount_owed, 1_000_000); // 10000bps of 1M
    assert!(!pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].tier_index, 0);
}

#[test]
fn test_reveal_multi_tier_multi_winner() {
    let tiers = vec![
        anchor::PrizeTier { basis_points: 7000, num_winners: 1 },
        anchor::PrizeTier { basis_points: 3000, num_winners: 3 },
    ];
    let prize_pot = 1_000_000u64;
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 10, prize_pot, 10);
    send_reveal(&mut ctx, 1, 0, [7u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 4); // 1 + 3
    assert_eq!(pr.winners.len(), 4);

    // Tier 0: 7000bps of 1M = 700_000
    assert_eq!(pr.winners[0].amount_owed, 700_000);
    assert_eq!(pr.winners[0].tier_index, 0);

    // Tier 1: 3000bps of 1M = 300_000 per winner
    for i in 1..4 {
        assert_eq!(pr.winners[i].amount_owed, 300_000);
        assert_eq!(pr.winners[i].tier_index, 1);
    }
}

#[test]
fn test_reveal_winner_determinism() {
    let tiers = vec![
        anchor::PrizeTier { basis_points: 5000, num_winners: 2 },
        anchor::PrizeTier { basis_points: 5000, num_winners: 1 },
    ];
    let locked = 8u32;
    let seed = [99u8; 32];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, locked, 500_000, locked as usize);
    send_reveal(&mut ctx, 1, 0, seed).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.winners.len(), 3);

    // Recompute expected winners
    let idx0 = local_derive_random_index(&seed, 0, 0, 0, locked) as usize;
    let idx1 = local_derive_random_index(&seed, 0, 1, 0, locked) as usize;
    let idx2 = local_derive_random_index(&seed, 1, 0, 0, locked) as usize;

    assert_eq!(pr.winners[0].winner_pubkey, ctx.tickets[idx0]);
    assert_eq!(pr.winners[1].winner_pubkey, ctx.tickets[idx1]);
    assert_eq!(pr.winners[2].winner_pubkey, ctx.tickets[idx2]);
}

#[test]
fn test_reveal_payout_registry_fields() {
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 2 }];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 800_000, 5);
    send_reveal(&mut ctx, 1, 0, [3u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.pool_id, 1);
    assert_eq!(pr.cycle_id, 0);
    assert_eq!(pr.winners_count, 2);
    assert_eq!(pr.payouts_completed, 0);

    for w in &pr.winners {
        assert!(!w.paid_out);
        assert_eq!(w.amount_reinvested, 0);
    }
}

#[test]
fn test_reveal_pool_unfreezes_and_seed_stored() {
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let seed = [55u8; 32];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 3, 100_000, 3);

    // Before: frozen
    let pool_before = read_pool(&ctx.svm, 1);
    assert!(pool_before.is_frozen_for_draw);

    send_reveal(&mut ctx, 1, 0, seed).expect("reveal");

    // After: unfrozen
    let pool_after = read_pool(&ctx.svm, 1);
    assert!(!pool_after.is_frozen_for_draw);

    // DrawCycle: Complete + seed stored
    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Complete);
    assert_eq!(dc.randomness_seed, seed);
}

#[test]
fn test_reveal_duplicate_winner_across_tiers() {
    // 1 ticket, 2 tiers → same pubkey must win both
    let tiers = vec![
        anchor::PrizeTier { basis_points: 6000, num_winners: 1 },
        anchor::PrizeTier { basis_points: 4000, num_winners: 1 },
    ];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 1, 1_000_000, 1);
    send_reveal(&mut ctx, 1, 0, [10u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.winners.len(), 2);
    assert_eq!(pr.winners[0].winner_pubkey, ctx.tickets[0]);
    assert_eq!(pr.winners[1].winner_pubkey, ctx.tickets[0]);
    assert_eq!(pr.winners[0].amount_owed, 600_000);
    assert_eq!(pr.winners[1].amount_owed, 400_000);
}

// ═════════════════════════════════════════════════════════════════════════════
// Edge / idempotency tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_fails_double_reveal() {
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 1_000_000, 5);
    send_reveal(&mut ctx, 1, 0, [1u8; 32]).expect("first reveal");

    // Second call: PayoutRegistry PDA already exists + DrawCycle is now Complete
    let err = send_reveal(&mut ctx, 1, 0, [2u8; 32]).unwrap_err();
    assert!(!err.is_empty(), "double reveal should fail");
}

#[test]
fn test_reveal_fails_wrong_ticket_registry() {
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 1_000_000, 5);

    // Create a different registry and swap it in
    let wrong_registry = Keypair::new().pubkey();
    inject_registry(&mut ctx.svm, wrong_registry, 99, 1000, 5, 0, &make_tickets(5));
    ctx.ticket_registry = wrong_registry;

    let err = send_reveal(&mut ctx, 1, 0, [1u8; 32]).unwrap_err();
    // has_one constraint should reject it
    assert!(!err.contains("InvalidDrawStatus") && !err.contains("PoolNotActive"),
        "Should be constraint error, got: {err}");
}
