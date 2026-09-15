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

mod common;
use common::*;

/// Pre-computed deterministic nonces mapping seed[0..4] to winner ticket indices 0..29
/// with tier_idx=0, winner_slot=0, cycle_id=0, and ticket_count=30.
pub const DETERMINISTIC_NONCES_0_TO_29: [u32; 30] = [
    21, 29, 24, 62, 13, 97, 19, 2, 33, 11, // Indices 0..9 -> User 1
    55, 37, 15, 48, 22, 46, 9, 104, 39, 0, // Indices 10..19 -> User 3 (User 2 skipped!)
    6, 20, 1, 3, 56, 23, 31, 35, 12, 4, // Indices 20..29 -> User 3
];

pub fn deterministic_seed_for_index(target_index: usize) -> [u8; 32] {
    let mut seed = [0u8; 32];
    seed[0..4].copy_from_slice(&DETERMINISTIC_NONCES_0_TO_29[target_index].to_le_bytes());
    seed
}

// ─── Context + helpers ───────────────────────────────────────────────────────

struct RevealCtx {
    svm: LiteSVM,
    crank: Keypair,
    ticket_registry: Pubkey,
    tickets: Vec<Pubkey>, // known ticket pubkeys for verification
    randomness_account: Pubkey,
}

fn build_reveal_ix(ctx: &RevealCtx, pool_id: u32, cycle_id: u32) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (dc, _) = draw_cycle_pda(pool_id, cycle_id);
    let (payout, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::RevealAndPickWinners {
        crank: ctx.crank.pubkey(),
        current_draw_cycle: dc,
        pool,
        ticket_registry: ctx.ticket_registry,
        randomness_account: ctx.randomness_account,
        payout_registry: payout,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::RevealAndPickWinners {}.data(),
    }
}

fn send_reveal(ctx: &mut RevealCtx, pool_id: u32, cycle_id: u32, seed: [u8; 32]) -> TxResult {
    inject_current_slot_randomness(&mut ctx.svm, ctx.randomness_account, seed);
    let ix = build_reveal_ix(ctx, pool_id, cycle_id);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx)
}

// ─── Setup builders ──────────────────────────────────────────────────────────

fn make_tickets(n: usize) -> Vec<Pubkey> {
    (0..n).map(|_| Keypair::new().pubkey()).collect()
}

fn setup_reveal(
    status: anchor::PoolStatus,
    is_frozen: bool,
    tiers: Vec<anchor::PrizeTier>,
    locked: u32,
    prize_pot: u64,
    num_tickets: usize,
) -> RevealCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let tickets = make_tickets(num_tickets);
    let registry = Keypair::new().pubkey();
    inject_registry_with_tickets(&mut svm, registry, 1, 1000, num_tickets as u32, 0, &tickets);

    PrizePoolTestBuilder::new(1)
        .with_ticket_registry(registry)
        .with_status(status)
        .with_frozen(is_frozen)
        .with_prize_tiers(tiers)
        .with_current_draw_cycle_id(0)
        .with_solvency_state(0, 10_000_000_000, 0)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_randomness_account_data(&mut svm, randomness_account, 0, 0, [0u8; 32]);

    DrawCycleTestBuilder::new(1, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_locked_tickets(locked)
        .with_prize_pot(prize_pot)
        .inject(&mut svm);

    // Also update randomness account reference in draw cycle
    mutate_draw_cycle(&mut svm, 1, 0, |dc| {
        dc.randomness_account = randomness_account;
    });

    RevealCtx {
        svm,
        crank,
        ticket_registry: registry,
        tickets,
        randomness_account,
    }
}

/// Setup with overridden draw status (for guard tests).
fn setup_reveal_with_dc_status(dc_status: anchor::DrawStatus) -> RevealCtx {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let tickets = make_tickets(5);
    let registry = Keypair::new().pubkey();
    inject_registry_with_tickets(&mut svm, registry, 1, 1000, 5, 0, &tickets);

    PrizePoolTestBuilder::new(1)
        .with_ticket_registry(registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_prize_tiers(tiers)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_randomness_account_data(&mut svm, randomness_account, 0, 0, [0u8; 32]);

    DrawCycleTestBuilder::new(1, 0)
        .with_status(dc_status)
        .with_locked_tickets(5)
        .with_prize_pot(1_000_000)
        .inject(&mut svm);

    mutate_draw_cycle(&mut svm, 1, 0, |dc| {
        dc.randomness_account = randomness_account;
    });

    RevealCtx {
        svm,
        crank,
        ticket_registry: registry,
        tickets,
        randomness_account,
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_permissionless_reveal_succeeds() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![anchor::PrizeTier::default_single_winner()],
        5,
        1_000_000,
        5,
    );
    let arbitrary_signer = Keypair::new();
    ctx.svm
        .airdrop(&arbitrary_signer.pubkey(), 10_000_000_000)
        .unwrap();
    ctx.crank = arbitrary_signer;
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert!(
        res.is_ok(),
        "Arbitrary third party crank should succeed in permissionless reveal: {:?}",
        res.err()
    );
}

#[test]
fn test_reveal_fails_pool_not_active() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Paused,
        true,
        vec![anchor::PrizeTier::default_single_winner()],
        5,
        1_000_000,
        5,
    );
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolNotActive);
}

#[test]
fn test_reveal_fails_invalid_draw_status() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::Complete);
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
}

#[test]
fn test_reveal_fails_unsupported_ticket_registry_version() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![anchor::PrizeTier::default_single_winner()],
        5,
        1_000_000,
        5,
    );
    // Mutate registry account to have unsupported future version
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.version = anchor::state::TicketRegistry::CURRENT_VERSION + 1;
    });

    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::UnsupportedAccountVersion,
    );
}

#[test]
fn test_reveal_fails_prize_tiers_not_configured() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![], // empty tiers
        5,
        1_000_000,
        5,
    );
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidPrizeTierConfig,
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// InvalidDrawState edge guards
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_fails_zero_locked_tickets() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![anchor::PrizeTier::default_single_winner()],
        0,
        1_000_000,
        5, // locked=0
    );
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawState);
}

#[test]
fn test_reveal_fails_zero_prize_pot() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![anchor::PrizeTier::default_single_winner()],
        5,
        0,
        5, // prize_pot=0
    );
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawState);
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_single_tier_single_winner() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 1_000_000, 5);
    let meta = send_reveal(&mut ctx, 1, 0, [42u8; 32]).expect("reveal");
    let event = assert_cpi_event::<anchor::events::DrawCompleted>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawCompleted crank mismatch"
    );
    assert_eq!(event.pool_id, 1, "DrawCompleted pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "DrawCompleted cycle_id mismatch");
    assert_eq!(
        event.prize_pot, 1_000_000,
        "DrawCompleted prize_pot mismatch"
    );
    assert_eq!(
        event.winners_count, 1,
        "DrawCompleted winners_count mismatch"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 1, "PayoutRegistry winners_count mismatch");
    assert_eq!(
        winners[0].amount_owed, 1_000_000,
        "Winner 0 amount_owed must be full 1,000,000 pot"
    );
    assert_eq!(winners[0].processed, 0, "Winner 0 processed flag must be 0");
    assert_eq!(winners[0].tier_index, 0, "Winner 0 tier_index must be 0");
}

#[test]
fn test_reveal_multi_tier_multi_winner() {
    let tiers = vec![
        anchor::PrizeTier::new(1, 7000),
        anchor::PrizeTier::new(3, 1000),
    ];
    let prize_pot = 1_000_000u64;
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        tiers.clone(),
        10,
        prize_pot,
        10,
    );
    send_reveal(&mut ctx, 1, 0, [7u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(
        pr.winners_count, 4,
        "PayoutRegistry winners_count must be 4 (1 + 3)"
    );
    assert_prize_tier_distribution(prize_pot, &tiers, &winners, pr.winners_count as usize);
}

#[test]
fn test_reveal_winner_determinism() {
    let tiers = vec![
        anchor::PrizeTier::new(2, 3000),
        anchor::PrizeTier::new(1, 4000),
    ];
    let locked = 8u32;
    let seed = [99u8; 32];
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        tiers,
        locked,
        500_000,
        locked as usize,
    );
    send_reveal(&mut ctx, 1, 0, seed).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(
        pr.winners_count, 3,
        "PayoutRegistry winners count must be 3"
    );

    // Re-run same reveal on fresh state to verify determinism
    let mut ctx2 = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![
            anchor::PrizeTier::new(2, 3000),
            anchor::PrizeTier::new(1, 4000),
        ],
        locked,
        500_000,
        locked as usize,
    );
    // Replace ctx2 tickets with identical tickets from ctx
    ctx2.tickets = ctx.tickets.clone();
    inject_registry_with_tickets(
        &mut ctx2.svm,
        ctx2.ticket_registry,
        1,
        1000,
        locked,
        0,
        &ctx2.tickets,
    );

    send_reveal(&mut ctx2, 1, 0, seed).expect("second reveal with identical seed");
    let winners2 = read_payout_winners(&ctx2.svm, 1, 0);

    assert_eq!(
        winners[0].winner, winners2[0].winner,
        "Winner 0 must be deterministic"
    );
    assert_eq!(
        winners[1].winner, winners2[1].winner,
        "Winner 1 must be deterministic"
    );
    assert_eq!(
        winners[2].winner, winners2[2].winner,
        "Winner 2 must be deterministic"
    );
}

#[test]
fn test_reveal_payout_registry_fields() {
    let tiers = vec![anchor::PrizeTier::new(2, 5000)];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 800_000, 5);
    send_reveal(&mut ctx, 1, 0, [3u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.pool_id, 1, "PayoutRegistry pool_id mismatch");
    assert_eq!(pr.cycle_id, 0, "PayoutRegistry cycle_id mismatch");
    assert_eq!(pr.winners_count, 2, "PayoutRegistry winners_count mismatch");
    assert_eq!(
        pr.payouts_completed, 0,
        "PayoutRegistry payouts_completed mismatch"
    );

    for (i, w) in winners[..pr.winners_count as usize].iter().enumerate() {
        assert_eq!(w.processed, 0, "Winner {i} processed must be 0 initially");
        assert_eq!(
            w.bonds_bought, 0,
            "Winner {i} bonds_bought must be 0 initially"
        );
    }
}

#[test]
fn test_reveal_pool_unfreezes_and_seed_stored() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    let seed = [55u8; 32];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 3, 100_000, 3);

    // Before: frozen
    let pool_before = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_before.is_frozen_for_draw, 1,
        "Pool must be frozen prior to reveal"
    );

    send_reveal(&mut ctx, 1, 0, seed).expect("reveal");

    // After: unfrozen
    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_after.is_frozen_for_draw, 0,
        "Pool must be unfrozen after reveal"
    );

    // DrawCycle: Complete + seed stored
    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::Complete,
        "DrawCycle status must be Complete"
    );
    assert_eq!(
        dc.randomness_seed, seed,
        "DrawCycle randomness_seed must match revealed seed"
    );
    assert!(
        dc.completed_at > 0,
        "DrawCycle completed_at must be positive"
    );
    assert!(
        dc.completed_at >= dc.initiated_at,
        "DrawCycle completed_at must be >= initiated_at"
    );
}

#[test]
fn test_reveal_duplicate_winner_across_tiers() {
    // 1 ticket, 2 tiers → same pubkey must win both
    let tiers = vec![
        anchor::PrizeTier::new(1, 6000),
        anchor::PrizeTier::new(1, 4000),
    ];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 1, 1_000_000, 1);
    send_reveal(&mut ctx, 1, 0, [10u8; 32]).expect("reveal");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(
        pr.winners_count, 2,
        "PayoutRegistry winners count must be 2"
    );
    assert_eq!(
        winners[0].winner, ctx.tickets[0],
        "Winner 0 must be the sole ticket owner"
    );
    assert_eq!(
        winners[1].winner, ctx.tickets[0],
        "Winner 1 must be the sole ticket owner"
    );
    assert_eq!(
        winners[0].amount_owed, 600_000,
        "Winner 0 amount_owed must be 600,000 (60%)"
    );
    assert_eq!(
        winners[1].amount_owed, 400_000,
        "Winner 1 amount_owed must be 400,000 (40%)"
    );
}

// ═════════════════════════════════════════════════════════════════════════════
// Edge / idempotency tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reveal_fails_double_reveal() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 1_000_000, 5);
    send_reveal(&mut ctx, 1, 0, [1u8; 32]).expect("first reveal");

    ctx.svm.expire_blockhash();
    // Second call: PayoutRegistry PDA is already allocated, so SystemProgram init fails
    let res = send_reveal(&mut ctx, 1, 0, [2u8; 32]);
    assert_custom_code_at(res, 0, 0, "SystemError::AccountAlreadyInUse");
}

#[test]
fn test_reveal_fails_wrong_ticket_registry() {
    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 5, 1_000_000, 5);

    // Create a different registry and swap it in
    let wrong_registry = Keypair::new().pubkey();
    inject_registry_with_tickets(
        &mut ctx.svm,
        wrong_registry,
        99,
        1000,
        5,
        0,
        &make_tickets(5),
    );
    ctx.ticket_registry = wrong_registry;

    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintHasOne);
}

#[test]
fn test_reveal_fails_invalid_randomness_account_key() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::AwaitingRandomness);
    let wrong_randomness_account = Keypair::new().pubkey();
    ctx.randomness_account = wrong_randomness_account;

    inject_randomness_account_data(&mut ctx.svm, wrong_randomness_account, 0, 0, [1u8; 32]);

    let ix = build_reveal_ix(&ctx, 1, 0);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_reveal_fails_invalid_randomness_account_owner() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::AwaitingRandomness);
    ctx.svm
        .set_account(
            ctx.randomness_account,
            Account {
                lamports: 1_000_000_000,
                data: vec![0u8; 100],
                owner: Pubkey::default(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = build_reveal_ix(&ctx, 1, 0);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_reveal_fails_stale_randomness_request_seed_slot() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::AwaitingRandomness);

    mutate_draw_cycle(&mut ctx.svm, 1, 0, |dc| {
        dc.harvest_slot = 10;
    });

    inject_randomness_account_data(&mut ctx.svm, ctx.randomness_account, 5, 5, [1u8; 32]);

    let ix = build_reveal_ix(&ctx, 1, 0);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::StaleRandomnessRequest,
    );
}

#[test]
fn test_reveal_fails_stale_randomness_request_expired() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::AwaitingRandomness);

    inject_randomness_account_data(&mut ctx.svm, ctx.randomness_account, 5, 5, [1u8; 32]);

    ctx.svm.warp_to_slot(1006);

    let ix = build_reveal_ix(&ctx, 1, 0);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::StaleRandomnessRequest,
    );
}

#[test]
fn test_reveal_fails_randomness_not_resolved() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::AwaitingRandomness);

    inject_randomness_account_data(&mut ctx.svm, ctx.randomness_account, 5, 0, [0u8; 32]);

    ctx.svm.warp_to_slot(5);

    let ix = build_reveal_ix(&ctx, 1, 0);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotResolved);
}

#[test]
fn test_reveal_fails_math_overflow() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![anchor::PrizeTier::new(1, 20000)],
        5,
        1_000_000,
        5,
    );

    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_reveal_multi_winner_dust_accounting_and_event() {
    // Pot of 100_000 USDC with 1 tier of 3 winners (3,333 bps per winner = 9,999 bps total)
    // 100_000 * 3,333 / 10,000 = 33,330 per winner -> total distributed = 99,990, dust = 10
    let tiers = vec![anchor::PrizeTier::new(3, 3_333)];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 10, 100_000, 10);

    let meta = send_reveal(&mut ctx, 1, 0, [42u8; 32]).expect("reveal should succeed");

    // Verify CPI event emission includes exact distributed and cumulative amounts
    let event = assert_cpi_event::<anchor::events::DrawCompleted>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawCompleted crank mismatch"
    );
    assert_eq!(event.pool_id, 1, "DrawCompleted pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "DrawCompleted cycle_id mismatch");
    assert_eq!(event.prize_pot, 100_000, "DrawCompleted prize_pot mismatch");
    assert_eq!(
        event.winners_count, 3,
        "DrawCompleted winners_count mismatch"
    );
    assert_eq!(
        event.total_distributed, 99_990,
        "DrawCompleted total_distributed mismatch"
    );

    // Verify pool on-chain state:
    // Initial total_prizes_allocated was 10_000_000_000; dust of 10 is deducted
    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_prizes_allocated,
        10_000_000_000 - 10,
        "Pool total_prizes_allocated must deduct 10 dust"
    );
}

#[test]
fn test_reveal_fails_when_draw_preparation_incomplete() {
    let mut ctx = setup_reveal(
        anchor::PoolStatus::Active,
        true,
        vec![anchor::PrizeTier::default_single_winner()],
        10,
        1_000_000,
        2,
    );
    // Mutate registry to simulate partial preparation: user_count = 2, but draw_prepared_up_to = 1
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.draw_prepared_up_to = 1;
    });

    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
}

#[test]
fn test_reveal_binary_search_with_interleaved_zero_ticket_users() {
    let user1 = Keypair::new().pubkey();
    let user2 = Keypair::new().pubkey();
    let user3 = Keypair::new().pubkey();

    let entries = vec![
        UserEntryTestBuilder::new()
            .with_owner(user1)
            .with_active(10)
            .with_cumulative_active(10)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user2)
            .with_active(0)
            .with_pending(5)
            .with_cumulative_active(10)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user3)
            .with_active(20)
            .with_cumulative_active(30)
            .build(),
    ];

    let tiers = vec![anchor::PrizeTier::default_single_winner()];

    // Helper closure to run reveal with deterministic seed targeting specific winner index
    let run_reveal_with_seed = |target_index: usize| -> Pubkey {
        let (mut svm, _admin, crank) = setup_global_with_crank();
        let registry = Keypair::new().pubkey();
        inject_registry_with_state(&mut svm, registry, 1, 100, 0, 3, &entries);

        PrizePoolTestBuilder::new(1)
            .with_ticket_registry(registry)
            .with_status(anchor::PoolStatus::Active)
            .with_frozen(true)
            .with_prize_tiers(tiers.clone())
            .with_current_draw_cycle_id(0)
            .inject(&mut svm);

        let randomness_account = Keypair::new().pubkey();
        inject_randomness_account_data(&mut svm, randomness_account, 0, 0, [0u8; 32]);

        DrawCycleTestBuilder::new(1, 0)
            .with_status(anchor::DrawStatus::AwaitingRandomness)
            .with_locked_tickets(30)
            .with_prize_pot(1_000_000)
            .inject(&mut svm);

        mutate_draw_cycle(&mut svm, 1, 0, |dc| {
            dc.randomness_account = randomness_account;
        });

        let mut ctx = RevealCtx {
            svm,
            crank,
            ticket_registry: registry,
            tickets: vec![user1, user2, user3],
            randomness_account,
        };

        let seed = deterministic_seed_for_index(target_index);
        send_reveal(&mut ctx, 1, 0, seed).expect("reveal should succeed");
        let winners = read_payout_winners(&ctx.svm, 1, 0);
        winners[0].winner
    };

    // Index 0 -> User 1
    assert_eq!(run_reveal_with_seed(0), user1, "Index 0 must pick User 1");
    // Index 9 -> User 1
    assert_eq!(run_reveal_with_seed(9), user1, "Index 9 must pick User 1");
    // Index 10 -> User 3 (User 2 skipped!)
    assert_eq!(
        run_reveal_with_seed(10),
        user3,
        "Index 10 must pick User 3 (skipping User 2 with 0 active tickets)"
    );
    // Index 29 -> User 3
    assert_eq!(run_reveal_with_seed(29), user3, "Index 29 must pick User 3");

    // Comprehensive boundary verification: Across all 30 ticket indices, User 2 is NEVER selected
    for idx in 0..10 {
        let winner = run_reveal_with_seed(idx);
        assert_ne!(
            winner, user2,
            "User 2 with 0 active tickets must NEVER be picked as winner (checked at index {idx})"
        );
        assert_eq!(
            winner, user1,
            "Indices 0..10 must pick User 1 (checked at index {idx})"
        );
    }
    for idx in 10..30 {
        let winner = run_reveal_with_seed(idx);
        assert_ne!(
            winner, user2,
            "User 2 with 0 active tickets must NEVER be picked as winner (checked at index {idx})"
        );
        assert_eq!(
            winner, user3,
            "Indices 10..30 must pick User 3 (checked at index {idx})"
        );
    }
}

// ─── Zero-Prize Truncation Tests ─────────────────────────────────────────────

#[test]
fn test_reveal_all_tiers_truncate_to_zero_dust_deduction() {
    const INITIAL_ALLOCATED_PRIZES: u64 = 10_000_000_000;
    // Pot of 5_000 lamports (0.005 USDC) with 1 tier of 1 winner at 1 bps (0.01%)
    // calculate_prize: (5_000 * 1) / 10_000 = 0
    let tiers = vec![anchor::PrizeTier::new(1, 1)];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 10, 5_000, 10);

    let meta = send_reveal(&mut ctx, 1, 0, [42u8; 32]).expect("reveal should succeed");

    let event = assert_cpi_event::<anchor::events::DrawCompleted>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawCompleted crank mismatch"
    );
    assert_eq!(event.pool_id, 1, "DrawCompleted pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "DrawCompleted cycle_id mismatch");
    assert_eq!(event.prize_pot, 5_000, "DrawCompleted prize_pot mismatch");
    assert_eq!(
        event.winners_count, 1,
        "DrawCompleted winners_count mismatch"
    );
    assert_eq!(
        event.total_distributed, 0,
        "DrawCompleted total_distributed must be 0"
    );

    // Verify PayoutRegistry state: winner recorded with amount_owed = 0, processed = 0
    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 1, "PayoutRegistry winners_count mismatch");
    assert_eq!(
        pr.payouts_completed, 0,
        "PayoutRegistry payouts_completed mismatch"
    );
    assert_eq!(winners[0].amount_owed, 0, "Winner 0 amount_owed must be 0");
    assert_eq!(winners[0].processed, 0, "Winner 0 processed must be 0");
    assert_eq!(
        winners[0].bonds_bought, 0,
        "Winner 0 bonds_bought must be 0"
    );

    // Verify pool on-chain state: full pot (5_000) deducted as dust from allocated liabilities
    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_prizes_allocated,
        INITIAL_ALLOCATED_PRIZES - 5_000,
        "Total prizes allocated must deduct 5,000 dust"
    );
}

#[test]
fn test_reveal_multi_tier_partial_truncation_to_zero() {
    const INITIAL_ALLOCATED_PRIZES: u64 = 10_000_000_000;
    // Pot of 5_000 lamports:
    // Tier 1: 9_999 bps, 1 winner -> (5_000 * 9_999) / 10_000 = 4_999 lamports
    // Tier 2: 1 bps, 1 winner -> (5_000 * 1) / 10_000 = 0 lamports
    // total_distributed = 4_999, dust = 1
    let tiers = vec![
        anchor::PrizeTier::new(1, 9_999),
        anchor::PrizeTier::new(1, 1),
    ];
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 10, 5_000, 10);

    let meta = send_reveal(&mut ctx, 1, 0, [42u8; 32]).expect("reveal should succeed");

    let event = assert_cpi_event::<anchor::events::DrawCompleted>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawCompleted crank mismatch"
    );
    assert_eq!(
        event.total_distributed, 4_999,
        "DrawCompleted total_distributed mismatch"
    );
    assert_eq!(
        event.winners_count, 2,
        "DrawCompleted winners_count mismatch"
    );

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(
        winners[0].amount_owed, 4_999,
        "Winner 0 amount_owed mismatch"
    );
    assert_eq!(winners[0].processed, 0, "Winner 0 processed mismatch");
    assert_eq!(winners[1].amount_owed, 0, "Winner 1 amount_owed mismatch");
    assert_eq!(winners[1].processed, 0, "Winner 1 processed mismatch");

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_prizes_allocated,
        INITIAL_ALLOCATED_PRIZES - 1,
        "Total prizes allocated must deduct 1 dust"
    );
}

#[test]
fn test_reveal_single_user_all_tickets_wins_all_tiers() {
    let tiers = vec![
        anchor::PrizeTier::new(1, 6_000),
        anchor::PrizeTier::new(2, 2_000),
    ];

    // Single user with 1 ticket (user_count = 1, locked_ticket_count = 1)
    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 1, 10_000_000, 1);

    let meta =
        send_reveal(&mut ctx, 1, 0, [42u8; 32]).expect("reveal should succeed for sole user");
    let event = assert_cpi_event::<anchor::events::DrawCompleted>(&meta);
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawCompleted crank mismatch"
    );
    assert_eq!(
        event.winners_count, 3,
        "DrawCompleted winners_count mismatch"
    );
    assert_eq!(
        event.total_distributed, 10_000_000,
        "DrawCompleted total_distributed mismatch"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 3, "PayoutRegistry winners count mismatch");
    let user_pubkey = ctx.tickets[0];
    assert_eq!(winners[0].winner, user_pubkey, "Winner 0 mismatch");
    assert_eq!(
        winners[0].amount_owed, 6_000_000,
        "Winner 0 amount_owed mismatch"
    );
    assert_eq!(winners[1].winner, user_pubkey, "Winner 1 mismatch");
    assert_eq!(
        winners[1].amount_owed, 2_000_000,
        "Winner 1 amount_owed mismatch"
    );
    assert_eq!(winners[2].winner, user_pubkey, "Winner 2 mismatch");
    assert_eq!(
        winners[2].amount_owed, 2_000_000,
        "Winner 2 amount_owed mismatch"
    );
}

#[test]
fn test_reveal_fails_too_many_winners() {
    // 181 winners exceeds the payout registry capacity of 180
    let tiers = vec![anchor::PrizeTier::new(181, 100)];

    let mut ctx = setup_reveal(anchor::PoolStatus::Active, true, tiers, 10, 10_000_000, 10);

    let res = send_reveal(&mut ctx, 1, 0, [42u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::TooManyWinners);
}

#[test]
fn test_reveal_winner_selection_with_zero_ticket_users() {
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let user_0 = Keypair::new().pubkey(); // 0 active tickets (cumulative: 0)
    let user_1 = Keypair::new().pubkey(); // 10 active tickets (cumulative: 10)
    let user_2 = Keypair::new().pubkey(); // 0 active tickets (cumulative: 10, intermediate duplicate)
    let user_3 = Keypair::new().pubkey(); // 20 active tickets (cumulative: 30)
    let user_4 = Keypair::new().pubkey(); // 0 active tickets (cumulative: 30, trailing duplicate)

    let entries = vec![
        UserEntryTestBuilder::new()
            .with_owner(user_0)
            .with_active(0)
            .with_cumulative_active(0)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user_1)
            .with_active(10)
            .with_cumulative_active(10)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user_2)
            .with_active(0)
            .with_cumulative_active(10)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user_3)
            .with_active(20)
            .with_cumulative_active(30)
            .build(),
        UserEntryTestBuilder::new()
            .with_owner(user_4)
            .with_active(0)
            .with_cumulative_active(30)
            .build(),
    ];

    let registry = Keypair::new().pubkey();
    inject_registry_with_state(&mut svm, registry, 1, 100, 0, 5, &entries);

    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    PrizePoolTestBuilder::new(1)
        .with_ticket_registry(registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_prize_tiers(tiers)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_randomness_account_data(&mut svm, randomness_account, 0, 0, [0u8; 32]);

    DrawCycleTestBuilder::new(1, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_locked_tickets(30)
        .with_prize_pot(10_000_000)
        .inject(&mut svm);

    mutate_draw_cycle(&mut svm, 1, 0, |dc| {
        dc.randomness_account = randomness_account;
    });

    let mut ctx = RevealCtx {
        svm,
        crank,
        ticket_registry: registry,
        tickets: vec![user_0, user_1, user_2, user_3, user_4],
        randomness_account,
    };

    // Test with index 5 (maps to User 1)
    let seed_for_5 = deterministic_seed_for_index(5);
    let res = send_reveal(&mut ctx, 1, 0, seed_for_5);
    assert!(res.is_ok(), "reveal failed: {:?}", res.err());

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    let winner = winners[0].winner;
    assert_eq!(winner, user_1, "Index 5 must select user_1");
    assert_ne!(winner, user_0, "user_0 (0 tickets) should never win");
    assert_ne!(winner, user_2, "user_2 (0 tickets) should never win");
    assert_ne!(winner, user_4, "user_4 (0 tickets) should never win");
}

#[test]
fn test_reveal_fails_invalid_winner_index() {
    let (mut svm, _admin, crank) = setup_global_with_crank();

    // Registry entries where cumulative_active is 0 for all users
    let user_0 = Keypair::new().pubkey();
    let entries = vec![UserEntryTestBuilder::new()
        .with_owner(user_0)
        .with_active(0)
        .build()];

    let registry = Keypair::new().pubkey();
    inject_registry_with_state(&mut svm, registry, 1, 100, 0, 1, &entries);

    let tiers = vec![anchor::PrizeTier::default_single_winner()];
    PrizePoolTestBuilder::new(1)
        .with_ticket_registry(registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_prize_tiers(tiers)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let randomness_account = Keypair::new().pubkey();
    inject_randomness_account_data(&mut svm, randomness_account, 0, 0, [42u8; 32]);

    DrawCycleTestBuilder::new(1, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_locked_tickets(10)
        .with_prize_pot(10_000_000)
        .inject(&mut svm);

    mutate_draw_cycle(&mut svm, 1, 0, |dc| {
        dc.randomness_account = randomness_account;
    });

    let mut ctx = RevealCtx {
        svm,
        crank,
        ticket_registry: registry,
        tickets: vec![user_0],
        randomness_account,
    };

    let res = send_reveal(&mut ctx, 1, 0, [42u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidWinnerIndex);
}

#[test]
fn test_reveal_freshness_slot_difference_1000_succeeds() {
    let mut ctx = setup_reveal_with_dc_status(anchor::DrawStatus::AwaitingRandomness);

    // Randomness committed at seed_slot = 5, resolved at reveal_slot = 1005
    inject_randomness_account_data(&mut ctx.svm, ctx.randomness_account, 5, 1005, [1u8; 32]);

    // Set clock to slot 1005 -> 1005 - 5 = 1000 (exact boundary)
    ctx.svm.warp_to_slot(1005);

    let ix = build_reveal_ix(&ctx, 1, 0);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "reveal should succeed at exactly 1000 slot diff: {:?}",
        res.err()
    );
}
