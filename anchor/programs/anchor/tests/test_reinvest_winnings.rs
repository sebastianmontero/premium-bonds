//! Integration tests for `reinvest_winnings` (Huma accounting-only).
//!
//! The instruction is pure accounting: increases principal book value
//! and registers new tickets. No token movement, no CPI, no user preference.

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

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_pool(
    svm: &mut LiteSVM,
    id: u32,
    mint: Pubkey,
    reg: Pubkey,
    status: anchor::PoolStatus,
    frozen: bool,
    bond_price: u64,
) -> Pubkey {
    PrizePoolTestBuilder::new(id)
        .with_token_mint(mint)
        .with_ticket_registry(reg)
        .with_status(status)
        .with_frozen(frozen)
        .with_bond_price(bond_price)
        .with_solvency_state(0, 1_000_000_000, 0)
        .inject(svm)
        .0
}

fn inject_payout(svm: &mut LiteSVM, pool_id: u32, cycle_id: u32, winners: Vec<anchor::Winner>) {
    PayoutRegistryTestBuilder::new(pool_id, cycle_id)
        .with_winners(winners)
        .inject(svm);
}

fn mock_winner(
    winner: Pubkey,
    owed: u64,
    tier: u8,
    bonds_bought: u32,
    processed: bool,
) -> anchor::Winner {
    WinnerTestBuilder::new()
        .with_winner(winner)
        .with_amount_owed(owed)
        .with_tier_index(tier)
        .with_bonds_bought(bonds_bought)
        .with_processed(processed)
        .build()
}

// ─── Context + instruction ──────────────────────────────────────────────────

struct ReinvestCtx {
    svm: LiteSVM,
    crank: Keypair,
    winner: Pubkey,
    registry: Pubkey,
}

fn send(
    ctx: &mut ReinvestCtx,
    cycle_id: u32,
    winner_index: u32,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let (pool, _) = pool_pda(1);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.winner);
    let (payout_registry, _) = payout_pda(1, cycle_id);

    let accounts = anchor::accounts::ReinvestWinnings {
        crank: ctx.crank.pubkey(),
        winner: ctx.winner,
        payout_registry,
        pool,
        user_winnings,
        ticket_registry: ctx.registry,
        system_program: anchor_lang::solana_program::system_program::id(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id,
            winner_index,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx)
}

// ─── Setup ───────────────────────────────────────────────────────────────────

fn setup(
    status: anchor::PoolStatus,
    frozen: bool,
    bond_price: u64,
    amount_owed: u64,
    bonds_bought: u32,
) -> ReinvestCtx {
    let (mut svm, _admin) = common::setup_global_config();

    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    let entries = vec![anchor::state::UserEntry {
        owner: winner,
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

    inject_pool(&mut svm, 1, mint, reg, status, frozen, bond_price);
    inject_payout(
        &mut svm,
        1,
        0,
        vec![mock_winner(winner, amount_owed, 0, bonds_bought, false)],
    );
    common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

    ReinvestCtx {
        svm,
        crank,
        winner,
        registry: reg,
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Guard Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reinvest_fails_wrong_winner() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    ctx.winner = Keypair::new().pubkey(); // different from registry entry
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 0, 0, 0, 1);
    let res = send(&mut ctx, 0, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::WinnerMismatch);
}

#[test]
fn test_reinvest_fails_already_paid() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    // Re-inject with processed=true
    inject_payout(
        &mut ctx.svm,
        1,
        0,
        vec![mock_winner(ctx.winner, 3_000_000, 0, 0, true)],
    );
    let res = send(&mut ctx, 0, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::AlreadyClaimed);
}

#[test]
fn test_reinvest_fails_winner_index_out_of_bounds() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    let res = send(&mut ctx, 0, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidWinnerIndex);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-Path Tests (pure accounting — no CPI needed)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reinvest_single_batch_full() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    let meta = send(&mut ctx, 0, 0).expect("reinvest");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, ctx.winner, "Event winner mismatch");
    assert_eq!(event.pool_id, 1, "Event pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "Event cycle_id mismatch");
    assert_eq!(event.winner_index, 0, "Event winner_index mismatch");
    assert_eq!(
        event.bonds_bought, 3,
        "Event bonds_bought must reflect floor(amount_owed / bond_price)"
    );
    assert_eq!(
        event.amount_reinvested, 3_000_000,
        "Event amount_reinvested must match bonds_bought * bond_price"
    );
    assert_eq!(
        event.new_total_deposited_principal, 3_000_000,
        "Event new_total_deposited_principal mismatch"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 0,
        "Event remaining_unclaimed_winnings must be 0 for exact bond multiple"
    );
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "Event crank pubkey mismatch"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(
        winners[0].processed, 1,
        "Winner processed flag must be set to 1"
    );
    assert_eq!(
        winners[0].bonds_bought, 3,
        "Winner bonds_bought in payout registry must be 3"
    );
    assert_eq!(
        pr.payouts_completed, 1,
        "Payouts completed count must increment to 1"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.total_deposited_principal, 3_000_000,
        "Pool principal must increase by reinvested amount"
    );

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(
        uw.unclaimed_non_reinvested_winnings, 0,
        "User unclaimed dust must remain 0"
    );
    assert_eq!(
        uw.total_reinvested, 3_000_000,
        "User total_reinvested must record 3 USDC"
    );
}

#[test]
fn test_reinvest_single_batch_with_dust() {
    // 3.5M owed, 1M bond_price → 3 bonds (3M reinvested), 500K dust
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_500_000, 0);
    send(&mut ctx, 0, 0).expect("reinvest");

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 3);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 500_000);
    assert_eq!(uw.total_reinvested, 3_000_000);
}

#[test]
fn test_reinvest_tickets_written() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 2_000_000, 0);
    send(&mut ctx, 0, 0).expect("reinvest");

    // Reinvested tickets are added directly to total_active_tickets (starts at 10 + 2 = 12)
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 12);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);
    let entry = common::read_registry_entry(&ctx.svm, ctx.registry, 0);
    assert_eq!(entry.owner, ctx.winner);
    assert_eq!(entry.active, 12);
    assert_eq!(entry.pending, 0);
}

#[test]
fn test_reinvest_principal_increments() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    send(&mut ctx, 0, 0).expect("reinvest");

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 3_000_000);
}

#[test]
fn test_reinvest_populates_bonds_bought() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 5_000_000, 0);
    send(&mut ctx, 0, 0).expect("reinvest");

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 5);
}

#[test]
fn test_reinvest_combines_prior_dust_and_current_prize() {
    // Bond price 100, prize owed 50, prior dust 50 -> total available 100 -> buys 1 bond, dust left 0
    let mut ctx = setup(anchor::PoolStatus::Active, false, 100, 50, 0);

    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 50, 0, 0, 0);

    send(&mut ctx, 0, 0).expect("reinvest");

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 1);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 0);
    assert_eq!(uw.total_reinvested, 100);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reinvest_dust_only_no_bonds() {
    // amount < bond_price → 0 bonds reinvested, dust stays
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 500_000, 0);
    send(&mut ctx, 0, 0).expect("dust only");

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 0);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 0);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 500_000);
}

#[test]
fn test_reinvest_fails_pool_paused() {
    let mut ctx = setup(anchor::PoolStatus::Paused, false, 1_000_000, 3_000_000, 0);
    let res = send(&mut ctx, 0, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolPaused);
}

#[test]
fn test_reinvest_fails_pool_frozen() {
    let mut ctx = setup(anchor::PoolStatus::Active, true, 1_000_000, 3_000_000, 0);
    let res = send(&mut ctx, 0, 0);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

/// Test that a user can reinvest using both their current draw winnings and their accumulated dust.
#[test]
fn test_reinvest_using_accumulated_dust() {
    // Setup pool with 1M bond price, winner owes 500K (from current draw).
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 500_000, 0);

    // Inject 600K accumulated dust in UserWinnings PDA first, pointed to index 0
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 600_000, 0, 0, 0);

    // Reinvest: total available = 500K (current) + 600K (accumulated) = 1.1M.
    // This allows buying 1 bond (1M), leaving 100K dust.
    send(&mut ctx, 0, 0).expect("reinvest");

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 1);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 100_000); // 1.1M - 1M bond = 100K remaining
    assert_eq!(uw.total_reinvested, 1_000_000);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 1_000_000);
}

#[test]
fn test_reinvest_fails_total_reinvested_overflow() {
    // Setup pool with 1M bond price, winner owes 1M (from current draw).
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 1_000_000, 0);

    // Inject u64::MAX total_reinvested in UserWinnings PDA, pointed to index 0
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 0, 0, u64::MAX, 0);

    // Reinvest: total available = 1M (current winnings).
    // This allows buying 1 bond costing 1M, but updating total_reinvested will overflow (u64::MAX + 1M)
    let res = send(&mut ctx, 0, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_reinvest_fails_invalid_user_entry_hint() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    let other_user = Keypair::new().pubkey();
    let entries = vec![
        anchor::state::UserEntry {
            owner: ctx.winner,
            active: 0,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: other_user,
            active: 0,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
    ];
    common::inject_registry_with_entries(&mut ctx.svm, ctx.registry, 1, 1000, &entries);

    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 0, 0, 0, 1);
    inject_payout(
        &mut ctx.svm,
        1,
        0,
        vec![mock_winner(ctx.winner, 3_000_000, 0, 0, false)],
    );

    let res = send(&mut ctx, 0, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidUserEntryHint);
}

#[test]
fn test_reinvest_exited_user_full_registry_fallback() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);

    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 0, 0, 0, u32::MAX);
    inject_payout(
        &mut ctx.svm,
        1,
        0,
        vec![mock_winner(ctx.winner, 3_000_000, 0, 0, false)],
    );

    let entries = vec![anchor::state::UserEntry {
        owner: Keypair::new().pubkey(),
        active: 0,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut ctx.svm, ctx.registry, 1, 1, &entries);

    // Full registry fallback: exited user cannot buy new tickets when registry is full.
    // reinvest_winnings must NOT fail with RegistryFull, but instead route 100% of prize to dust and mark processed.
    let meta = send(&mut ctx, 0, 0).expect("full registry fallback");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, ctx.winner, "event winner matches");
    assert_eq!(event.winner_index, 0, "event winner_index is 0");
    assert_eq!(
        event.bonds_bought, 0,
        "bonds_bought is 0 due to full registry"
    );
    assert_eq!(event.amount_reinvested, 0, "amount_reinvested is 0");
    assert_eq!(
        event.new_total_deposited_principal, 0,
        "new_total_deposited_principal is 0"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 3_000_000,
        "remaining_unclaimed_winnings is full prize"
    );
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "event crank matches caller"
    );

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 3_000_000);
}

#[test]
fn test_reinvest_immediate_draw_eligibility() {
    // Verify that reinvesting prize money immediately increases total_active_tickets and entry.active
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 5_000_000, 0);

    // Initial state: entry.active = 10, total_active = 10, pending = 0
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 10);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);

    // Reinvest 5 bonds
    send(&mut ctx, 0, 0).expect("reinvest");

    // Immediately active: total_active becomes 15, pending remains 0
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 15);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);

    let entry = common::read_registry_entry(&ctx.svm, ctx.registry, 0);
    assert_eq!(entry.active, 15);
    assert_eq!(entry.pending, 0);
}

#[test]
fn test_reinvest_preserves_existing_pending_tickets() {
    // Verify that a user with pending tickets (from buy_bonds) retains pending tickets while reinvestment adds active tickets directly
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    // User has 10 active tickets and 5 pending tickets in cycle 1
    let entries = vec![anchor::state::UserEntry {
        owner: winner,
        active: 10,
        pending: 5,
        merged_through_cycle: 1,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

    // Manually set total_pending_tickets = 5
    mutate_ticket_registry_header(&mut svm, reg, |hdr| {
        hdr.total_pending_tickets = 5;
    });

    inject_pool(
        &mut svm,
        1,
        mint,
        reg,
        anchor::PoolStatus::Active,
        false,
        1_000_000,
    );
    inject_payout(
        &mut svm,
        1,
        1,
        vec![mock_winner(winner, 3_000_000, 0, 0, false)],
    );
    common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner,
        registry: reg,
    };

    send(&mut ctx, 1, 0).expect("reinvest");

    // Total active: 10 (initial active) + 3 (reinvested) = 13
    // Total pending: 5 (from cash deposit) remains unchanged
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 13);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 5);

    let entry = common::read_registry_entry(&ctx.svm, ctx.registry, 0);
    assert_eq!(entry.active, 13);
    assert_eq!(entry.pending, 5);
}

#[test]
fn test_reinvest_exited_user_creates_active_entry() {
    // Verify that an exited user (index = u32::MAX) gets a newly allocated entry with active = bonds_to_buy and pending = 0
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    // Registry is empty
    let entries: Vec<anchor::state::UserEntry> = vec![];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

    inject_pool(
        &mut svm,
        1,
        mint,
        reg,
        anchor::PoolStatus::Active,
        false,
        1_000_000,
    );
    inject_payout(
        &mut svm,
        1,
        0,
        vec![mock_winner(winner, 4_000_000, 0, 0, false)],
    );
    common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, u32::MAX);

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner,
        registry: reg,
    };

    send(&mut ctx, 0, 0).expect("reinvest exited user");

    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 4);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);

    let entry = common::read_registry_entry(&ctx.svm, ctx.registry, 0);
    assert_eq!(entry.owner, winner);
    assert_eq!(entry.active, 4);
    assert_eq!(entry.pending, 0);
}

#[test]
fn test_reinvest_with_lazy_merge_from_past_cycle() {
    // Verify that lazy_merge runs first on stale user entries, converting past pending into active before adding new reinvested active tickets
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    // User entry in cycle 1 has active = 10, pending = 6 from cycle 0 (merged_through_cycle = 0)
    let entries = vec![anchor::state::UserEntry {
        owner: winner,
        active: 10,
        pending: 6,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

    // Set registry total_active_tickets = 16, total_pending_tickets = 0, draw_cycle_id = 1
    mutate_ticket_registry_header(&mut svm, reg, |hdr| {
        hdr.total_active_tickets = 16;
        hdr.total_pending_tickets = 0;
        hdr.draw_cycle_id = 1;
    });

    inject_pool(
        &mut svm,
        1,
        mint,
        reg,
        anchor::PoolStatus::Active,
        false,
        1_000_000,
    );
    inject_payout(
        &mut svm,
        1,
        1,
        vec![mock_winner(winner, 2_000_000, 0, 0, false)],
    );
    common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner,
        registry: reg,
    };

    send(&mut ctx, 1, 0).expect("reinvest with lazy merge");

    // lazy_merge(1) merges pending (6) into active (10 -> 16), pending -> 0
    // Then reinvest adds 2 to active (16 -> 18)
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 18);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);

    let entry = common::read_registry_entry(&ctx.svm, ctx.registry, 0);
    assert_eq!(entry.active, 18);
    assert_eq!(entry.pending, 0);
    assert_eq!(entry.merged_through_cycle, 1);
}

#[test]
fn test_reinvest_fails_payout_timelock_active() {
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    let entries = vec![anchor::state::UserEntry {
        owner: winner,
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

    let pool_pda = inject_pool(
        &mut svm,
        1,
        mint,
        reg,
        anchor::PoolStatus::Active,
        false,
        1_000_000,
    );
    // Set payout_timelock_seconds = 300
    PrizePoolTestBuilder::from_state(&svm, 1)
        .with_payout_timelock_seconds(300)
        .inject(&mut svm);

    // Payout revealed at timestamp 1_700_000_000
    inject_payout(
        &mut svm,
        1,
        0,
        vec![mock_winner(winner, 3_000_000, 0, 0, false)],
    );
    PayoutRegistryTestBuilder::from_state(&svm, 1, 0)
        .with_revealed_at(1_700_000_000)
        .inject(&mut svm);

    common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

    // Current clock is 1_700_000_200 (timelock active until 1_700_000_000 + 300 = 1_700_000_300)
    warp_to_timestamp(&mut svm, 1_700_000_200);

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner,
        registry: reg,
    };
    assert_custom_error(
        send(&mut ctx, 0, 0),
        anchor::error::PremiumBondsError::PayoutTimelockActive,
    );

    // Advance clock to 1_700_000_300 (timelock elapsed)
    warp_to_timestamp(&mut ctx.svm, 1_700_000_300);
    let crank2 = Keypair::new();
    ctx.svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    ctx.crank = crank2;

    let meta = send(&mut ctx, 0, 0).expect("reinvest should succeed after timelock elapsed");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner_index, 0);
    assert_eq!(event.bonds_bought, 3);
    assert_eq!(event.crank, ctx.crank.pubkey());
    assert_eq!(event.new_total_deposited_principal, 3_000_000);
    assert_eq!(event.remaining_unclaimed_winnings, 0);
}

#[test]
fn test_reinvest_fails_draw_voided() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    PayoutRegistryTestBuilder::from_state(&ctx.svm, 1, 0)
        .with_status(anchor::state::PayoutRegistryStatus::Voided)
        .inject(&mut ctx.svm);

    assert_custom_error(
        send(&mut ctx, 0, 0),
        anchor::error::PremiumBondsError::DrawVoided,
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Closed Pool Graceful Fallback Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reinvest_closed_pool_graceful_cash_fallback() {
    let mut ctx = setup(anchor::PoolStatus::Closed, false, 1_000_000, 3_000_000, 0);
    let pool_before = read_pool_state(&ctx.svm, 1);

    let meta = send(&mut ctx, 0, 0).expect("closed pool reinvest");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, ctx.winner, "event winner matches");
    assert_eq!(event.pool_id, 1, "event pool_id is 1");
    assert_eq!(event.cycle_id, 0, "event cycle_id is 0");
    assert_eq!(event.winner_index, 0, "event winner_index is 0");
    assert_eq!(event.bonds_bought, 0, "closed pool bonds_bought is 0");
    assert_eq!(
        event.amount_reinvested, 0,
        "closed pool amount_reinvested is 0"
    );
    assert_eq!(
        event.new_total_deposited_principal, 0,
        "new_total_deposited_principal is 0"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 3_000_000,
        "all winnings routed to unclaimed"
    );
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "event crank matches caller"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 0);
    assert_eq!(pr.payouts_completed, 1);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 3_000_000);
    assert_eq!(uw.total_reinvested, 0);

    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_after.total_deposited_principal, 0);
    // Liability total_prizes_allocated remains committed until claimed
    assert_eq!(
        pool_after.total_prizes_allocated,
        pool_before.total_prizes_allocated
    );

    // Tickets remain unchanged (starts at 10)
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 10);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);
}

#[test]
fn test_reinvest_closed_pool_with_existing_dust() {
    let mut ctx = setup(anchor::PoolStatus::Closed, false, 1_000_000, 2_000_000, 0);

    // User already has 500_000 in unclaimed_non_reinvested_winnings
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 500_000, 0, 0, 0);

    send(&mut ctx, 0, 0).expect("reinvest closed pool with dust");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 0);
    assert_eq!(pr.payouts_completed, 1);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    // 500_000 existing dust + 2_000_000 new prize = 2_500_000 total unclaimed
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 2_500_000);
    assert_eq!(uw.total_reinvested, 0);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 0);
}

#[test]
fn test_reinvest_closed_pool_exited_user() {
    let mut ctx = setup(anchor::PoolStatus::Closed, false, 1_000_000, 4_000_000, 0);

    // Exited user has registry_entry_index = u32::MAX
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 0, 0, 0, u32::MAX);

    let meta = send(&mut ctx, 0, 0).expect("reinvest closed pool exited user");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner_index, 0, "event winner_index is 0");
    assert_eq!(
        event.bonds_bought, 0,
        "exited user on closed pool cannot buy bonds"
    );
    assert_eq!(event.amount_reinvested, 0, "amount_reinvested is 0");
    assert_eq!(
        event.new_total_deposited_principal, 0,
        "new_total_deposited_principal is 0"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 4_000_000,
        "all 4 USDC routed to unclaimed"
    );
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "event crank matches caller"
    );

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 0);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 4_000_000);
    assert_eq!(uw.total_reinvested, 0);
    assert_eq!(uw.registry_entry_index, u32::MAX);

    // Registry total active tickets remains unchanged (10)
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 10);
}

#[test]
fn test_reinvest_closed_pool_fails_when_frozen() {
    let mut ctx = setup(anchor::PoolStatus::Closed, true, 1_000_000, 3_000_000, 0);
    assert_custom_error(
        send(&mut ctx, 0, 0),
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

#[test]
fn test_reinvest_closed_pool_fails_timelock_active() {
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    let entries = vec![anchor::state::UserEntry {
        owner: winner,
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

    let pool_pda = inject_pool(
        &mut svm,
        1,
        mint,
        reg,
        anchor::PoolStatus::Closed,
        false,
        1_000_000,
    );
    // Set payout_timelock_seconds = 300
    PrizePoolTestBuilder::from_state(&svm, 1)
        .with_payout_timelock_seconds(300)
        .inject(&mut svm);

    let (payout_pda, _) = payout_pda(1, 0);
    inject_payout(
        &mut svm,
        1,
        0,
        vec![mock_winner(winner, 3_000_000, 0, 0, false)],
    );
    PayoutRegistryTestBuilder::from_state(&svm, 1, 0)
        .with_revealed_at(1_700_000_000)
        .inject(&mut svm);

    common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

    warp_to_timestamp(&mut svm, 1_700_000_200); // within 300s timelock (1_700_000_000 + 300 = 1_700_000_300)

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner,
        registry: reg,
    };
    assert_custom_error(
        send(&mut ctx, 0, 0),
        anchor::error::PremiumBondsError::PayoutTimelockActive,
    );

    // Advance clock past timelock
    warp_to_timestamp(&mut ctx.svm, 1_700_000_300);
    let crank2 = Keypair::new();
    ctx.svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    ctx.crank = crank2;

    let meta = send(&mut ctx, 0, 0).expect("reinvest should succeed after timelock");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner_index, 0, "event winner_index matches");
    assert_eq!(event.bonds_bought, 0, "bonds_bought is 0");
    assert_eq!(event.amount_reinvested, 0, "amount_reinvested is 0");
    assert_eq!(
        event.new_total_deposited_principal, 0,
        "new_total_deposited_principal is 0"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 3_000_000,
        "remaining_unclaimed_winnings is 3 USDC"
    );
    assert_eq!(event.crank, ctx.crank.pubkey(), "crank matches caller");

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 3_000_000);
}

// ─── Zero-Prize Reinvestment Tests ───────────────────────────────────────────

#[test]
fn test_reinvest_zero_prize_owed_without_prior_dust() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 0, 0);

    let meta = send(&mut ctx, 0, 0).expect("reinvest of 0 prize should succeed");

    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, ctx.winner, "event winner matches");
    assert_eq!(event.winner_index, 0, "winner_index is 0");
    assert_eq!(event.bonds_bought, 0, "bonds_bought is 0");
    assert_eq!(event.amount_reinvested, 0, "amount_reinvested is 0");
    assert_eq!(
        event.new_total_deposited_principal, 0,
        "new_total_deposited_principal is 0"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 0,
        "remaining_unclaimed_winnings is 0"
    );
    assert_eq!(event.crank, ctx.crank.pubkey(), "crank matches caller");

    // Verify PayoutRegistry is marked processed
    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 0);
    assert_eq!(pr.payouts_completed, 1);

    // Verify UserWinnings remains 0
    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 0);
    assert_eq!(uw.total_reinvested, 0);

    // Verify pool principal unchanged
    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 0);

    // Verify ticket registry unchanged
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 10);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);
}

#[test]
fn test_reinvest_zero_prize_owed_preserves_sub_bond_prior_dust() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 0, 0);
    // Inject 400k lamports of prior dust (< bond_price of 1_000_000)
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 400_000, 0, 0, 0);

    let meta = send(&mut ctx, 0, 0).expect("reinvest of 0 prize with sub-bond dust should succeed");

    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, ctx.winner, "event winner matches");
    assert_eq!(event.winner_index, 0, "winner_index is 0");
    assert_eq!(event.bonds_bought, 0, "bonds_bought is 0");
    assert_eq!(event.amount_reinvested, 0, "amount_reinvested is 0");
    assert_eq!(
        event.new_total_deposited_principal, 0,
        "new_total_deposited_principal is 0"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 400_000,
        "remaining_unclaimed_winnings is 400k"
    );
    assert_eq!(event.crank, ctx.crank.pubkey(), "crank matches caller");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 0);
    assert_eq!(pr.payouts_completed, 1);

    // Verify sub-bond dust is preserved exactly
    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 400_000);
    assert_eq!(uw.total_reinvested, 0);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 0);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);
}

#[test]
fn test_reinvest_zero_prize_owed_with_accumulated_dust_compound() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 0, 0);
    // Inject 1.5 USDC of prior accumulated dust (1_500_000 lamports)
    common::inject_user_winnings_with_index(&mut ctx.svm, 1, ctx.winner, 1_500_000, 0, 0, 0);

    let meta = send(&mut ctx, 0, 0).expect("reinvest should auto-compound prior dust");

    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, ctx.winner, "event winner matches");
    assert_eq!(event.winner_index, 0, "winner_index is 0");
    assert_eq!(event.bonds_bought, 1, "bonds_bought is 1");
    assert_eq!(
        event.amount_reinvested, 1_000_000,
        "amount_reinvested is 1 USDC"
    );
    assert_eq!(
        event.new_total_deposited_principal, 1_000_000,
        "new_total_deposited_principal is 1 USDC"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 500_000,
        "remaining_unclaimed_winnings is 500k"
    );
    assert_eq!(event.crank, ctx.crank.pubkey(), "crank matches caller");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].processed, 1);
    assert_eq!(winners[0].bonds_bought, 1);
    assert_eq!(pr.payouts_completed, 1);

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 500_000);
    assert_eq!(uw.total_reinvested, 1_000_000);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 1_000_000);

    // Verify 1 new active ticket registered from compounding prior dust
    assert_eq!(read_registry_active(&ctx.svm, ctx.registry), 11);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.registry), 0);
}

#[test]
fn test_reinvest_sequential_multi_winner_zero_prizes() {
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner0 = Keypair::new().pubkey();
    let winner1 = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    let entries = vec![
        anchor::state::UserEntry {
            owner: winner0,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: winner1,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
    ];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);
    inject_pool(
        &mut svm,
        1,
        Keypair::new().pubkey(),
        reg,
        anchor::PoolStatus::Active,
        false,
        1_000_000,
    );
    inject_payout(
        &mut svm,
        1,
        0,
        vec![
            mock_winner(winner0, 0, 0, 0, false),
            mock_winner(winner1, 0, 1, 0, false),
        ],
    );
    common::inject_user_winnings_with_index(&mut svm, 1, winner0, 0, 0, 0, 0);
    common::inject_user_winnings_with_index(&mut svm, 1, winner1, 0, 0, 0, 0);

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner: winner0,
        registry: reg,
    };

    // Crank winner 0
    let meta0 = send(&mut ctx, 0, 0).expect("crank winner 0 should succeed");
    let event0 = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta0);
    assert_eq!(event0.winner, winner0, "event0 winner matches winner0");
    assert_eq!(event0.winner_index, 0, "event0 winner_index is 0");
    assert_eq!(event0.bonds_bought, 0, "event0 bonds_bought is 0");
    assert_eq!(event0.amount_reinvested, 0, "event0 amount_reinvested is 0");
    assert_eq!(
        event0.new_total_deposited_principal, 0,
        "event0 new_total_deposited_principal is 0"
    );
    assert_eq!(
        event0.remaining_unclaimed_winnings, 0,
        "event0 remaining_unclaimed_winnings is 0"
    );
    assert_eq!(
        event0.crank,
        ctx.crank.pubkey(),
        "event0 crank matches caller"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners0 = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.payouts_completed, 1);
    assert_eq!(winners0[0].processed, 1);
    assert_eq!(winners0[1].processed, 0);

    // Crank winner 1
    ctx.winner = winner1;
    let meta1 = send(&mut ctx, 0, 1).expect("crank winner 1 should succeed");
    let event1 = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta1);
    assert_eq!(event1.winner, winner1, "event1 winner matches winner1");
    assert_eq!(event1.winner_index, 1, "event1 winner_index is 1");
    assert_eq!(event1.bonds_bought, 0, "event1 bonds_bought is 0");
    assert_eq!(event1.amount_reinvested, 0, "event1 amount_reinvested is 0");
    assert_eq!(
        event1.new_total_deposited_principal, 0,
        "event1 new_total_deposited_principal is 0"
    );
    assert_eq!(
        event1.remaining_unclaimed_winnings, 0,
        "event1 remaining_unclaimed_winnings is 0"
    );
    assert_eq!(
        event1.crank,
        ctx.crank.pubkey(),
        "event1 crank matches caller"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners1 = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.payouts_completed, 2);
    assert_eq!(winners1[1].processed, 1);
}

#[test]
fn test_reinvest_fails_if_already_processed_zero_prize() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 0, 0);
    send(&mut ctx, 0, 0).expect("first reinvest should succeed");

    ctx.svm.expire_blockhash();

    assert_custom_error(
        send(&mut ctx, 0, 0),
        anchor::error::PremiumBondsError::AlreadyClaimed,
    );
}

#[test]
fn test_reinvest_fails_pool_principal_overflow() {
    // Setup pool with active status and winner owed 200
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1, 200, 0);

    // Mutate pool total_deposited_principal to near max so checked_add(200) overflows
    common::mutate_pool_state(&mut ctx.svm, 1, |pool| {
        pool.total_deposited_principal = u64::MAX - 100;
        pool.bond_price = 1;
    });

    assert_custom_error(
        send(&mut ctx, 0, 0),
        anchor::error::PremiumBondsError::MathOverflow,
    );
}

#[test]
fn test_reinvest_winnings_with_unit_bond_price() {
    // Setup with bond_price = 1 and prize = 500
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1, 500, 0);

    let initial_reg_active = read_registry_active(&ctx.svm, ctx.registry);
    send(&mut ctx, 0, 0).expect("reinvest with unit bond price should succeed");

    let uw = read_user_winnings_state(&ctx.svm, 1, &ctx.winner);
    assert_eq!(uw.total_reinvested, 500);
    assert_eq!(uw.unclaimed_non_reinvested_winnings, 0);

    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners[0].bonds_bought, 500);
    assert_eq!(winners[0].processed, 1);

    // Registry active tickets increased by exactly 500
    assert_eq!(
        read_registry_active(&ctx.svm, ctx.registry),
        initial_reg_active + 500
    );
}

#[test]
fn test_reinvest_nonzero_winner_index_with_bonds() {
    let (mut svm, _admin) = common::setup_global_config();
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner0 = Keypair::new().pubkey();
    let winner1 = Keypair::new().pubkey();
    let winner2 = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();

    let entries = vec![
        anchor::state::UserEntry {
            owner: winner0,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: winner1,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: winner2,
            active: 10,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
    ];
    common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);
    inject_pool(
        &mut svm,
        1,
        Keypair::new().pubkey(),
        reg,
        anchor::PoolStatus::Active,
        false,
        1_000_000,
    );
    inject_payout(
        &mut svm,
        1,
        0,
        vec![
            mock_winner(winner0, 0, 0, 0, false),
            mock_winner(winner1, 0, 1, 0, false),
            mock_winner(winner2, 4_000_000, 2, 0, false),
        ],
    );
    common::inject_user_winnings_with_index(&mut svm, 1, winner0, 0, 0, 0, 0);
    common::inject_user_winnings_with_index(&mut svm, 1, winner1, 0, 0, 0, 1);
    common::inject_user_winnings_with_index(&mut svm, 1, winner2, 0, 0, 0, 2);

    let mut ctx = ReinvestCtx {
        svm,
        crank,
        winner: winner2,
        registry: reg,
    };

    let meta = send(&mut ctx, 0, 2).expect("crank winner 2 should succeed");
    let event = assert_cpi_event::<anchor::events::WinningsReinvested>(&meta);
    assert_eq!(event.winner, winner2, "event winner matches winner2");
    assert_eq!(event.pool_id, 1, "event pool_id is 1");
    assert_eq!(event.cycle_id, 0, "event cycle_id is 0");
    assert_eq!(event.winner_index, 2, "event winner_index is 2");
    assert_eq!(event.bonds_bought, 4, "event bonds_bought is 4");
    assert_eq!(
        event.amount_reinvested, 4_000_000,
        "event amount_reinvested is 4 USDC"
    );
    assert_eq!(
        event.new_total_deposited_principal, 4_000_000,
        "new_total_deposited_principal is 4 USDC"
    );
    assert_eq!(
        event.remaining_unclaimed_winnings, 0,
        "remaining_unclaimed_winnings is 0"
    );
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "event crank matches caller"
    );

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.payouts_completed, 1, "payouts_completed is 1");
    assert_eq!(winners[0].processed, 0, "winner 0 not processed yet");
    assert_eq!(winners[1].processed, 0, "winner 1 not processed yet");
    assert_eq!(winners[2].processed, 1, "winner 2 marked processed");
    assert_eq!(winners[2].bonds_bought, 4, "winner 2 bought 4 bonds");
}

#[test]
fn test_reinvest_exact_timelock_boundaries() {
    fn setup_timelock_test(clock_ts: i64) -> (ReinvestCtx, u32) {
        let (mut svm, _admin) = common::setup_global_config();
        let crank = Keypair::new();
        svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

        let winner = Keypair::new().pubkey();
        let mint = Keypair::new().pubkey();
        let reg = Keypair::new().pubkey();

        let entries = vec![anchor::state::UserEntry {
            owner: winner,
            active: 10,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        }];
        common::inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

        inject_pool(
            &mut svm,
            1,
            mint,
            reg,
            anchor::PoolStatus::Active,
            false,
            1_000_000,
        );
        PrizePoolTestBuilder::from_state(&svm, 1)
            .with_payout_timelock_seconds(300)
            .inject(&mut svm);

        inject_payout(
            &mut svm,
            1,
            0,
            vec![mock_winner(winner, 3_000_000, 0, 0, false)],
        );
        PayoutRegistryTestBuilder::from_state(&svm, 1, 0)
            .with_revealed_at(1_700_000_000)
            .inject(&mut svm);

        common::inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

        warp_to_timestamp(&mut svm, clock_ts);

        (
            ReinvestCtx {
                svm,
                crank,
                winner,
                registry: reg,
            },
            1,
        )
    }

    // Boundary 1: revealed_at (1_700_000_000) + timelock (300) - 1 = 1_700_000_299 -> fails with PayoutTimelockActive
    {
        let (mut ctx, _) = setup_timelock_test(1_700_000_299);
        assert_custom_error(
            send(&mut ctx, 0, 0),
            anchor::error::PremiumBondsError::PayoutTimelockActive,
        );
    }

    // Boundary 2: revealed_at (1_700_000_000) + timelock (300) = 1_700_000_300 -> succeeds
    {
        let (mut ctx, _) = setup_timelock_test(1_700_000_300);
        let res = send(&mut ctx, 0, 0);
        assert!(
            res.is_ok(),
            "Reinvest at exact timelock boundary (1_700_000_300) must succeed: {:?}",
            res.err()
        );
    }

    // Boundary 3: revealed_at (1_700_000_000) + timelock (300) + 1 = 1_700_000_301 -> succeeds
    {
        let (mut ctx, _) = setup_timelock_test(1_700_000_301);
        let res = send(&mut ctx, 0, 0);
        assert!(
            res.is_ok(),
            "Reinvest at timelock + 1 (1_700_000_301) must succeed: {:?}",
            res.err()
        );
    }
}
