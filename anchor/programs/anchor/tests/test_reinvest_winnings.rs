//! Integration tests for `reinvest_winnings` (Huma accounting-only).
//!
//! The instruction is now pure accounting: increases principal book value
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

const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const PAYOUT_SEED: &[u8] = b"payout";

fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn payout_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PAYOUT_SEED,
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_registry(
    svm: &mut LiteSVM,
    addr: Pubkey,
    pool_id: u32,
    cap: u32,
    active: u32,
    pending: u32,
) {
    let mut d = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    d[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]);
    d[8..12].copy_from_slice(&pool_id.to_le_bytes());
    d[12..16].copy_from_slice(&cap.to_le_bytes());
    d[16..20].copy_from_slice(&active.to_le_bytes());
    d[20..24].copy_from_slice(&pending.to_le_bytes());
    svm.set_account(
        addr,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_pool(
    svm: &mut LiteSVM,
    id: u32,
    mint: Pubkey,
    reg: Pubkey,
    status: anchor::PoolStatus,
    frozen: bool,
    bond_price: u64,
) -> Pubkey {
    let (pda, bump) = pool_pda(id);
    let p = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id: id,
        token_mint: mint,
        ticket_registry: reg,
        fee_wallet: Pubkey::default(),
        bond_price,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        next_redemption_id: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: frozen,
        current_draw_cycle_id: 0,
        prize_tiers: vec![],
    };
    let mut d = vec![];
    p.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    pda
}

fn inject_payout(svm: &mut LiteSVM, pool_id: u32, cycle_id: u32, winners: Vec<anchor::Winner>) {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let pr = anchor::PayoutRegistry {
        pool_id,
        cycle_id,
        winners_count: winners.len() as u32,
        payouts_completed: 0,
        winners,
    };
    let mut d = vec![];
    pr.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::PayoutRegistry::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn w(pk: Pubkey, owed: u64, tier: u8, reinvested: u64, paid: bool) -> anchor::Winner {
    anchor::Winner {
        winner_pubkey: pk,
        amount_owed: owed,
        paid_out: paid,
        tier_index: tier,
        amount_reinvested: reinvested,
    }
}

// ─── Context + instruction ──────────────────────────────────────────────────

struct Ctx {
    svm: LiteSVM,
    crank: Keypair,
    winner: Pubkey,
    registry: Pubkey,
}

fn build_ix(ctx: &Ctx, cycle_id: u32, winner_index: u32, max_bonds: u32) -> Instruction {
    let (pool, _) = pool_pda(1);
    let (payout, _) = payout_pda(1, cycle_id);

    let accounts = anchor::accounts::ReinvestWinnings {
        crank: ctx.crank.pubkey(),
        winner: ctx.winner,
        payout_registry: payout,
        pool,
        ticket_registry: ctx.registry,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id,
            winner_index,
            max_bonds,
        }
        .data(),
    }
}

fn send(ctx: &mut Ctx, cycle_id: u32, winner_index: u32, max_bonds: u32) -> Result<(), String> {
    let ix = build_ix(ctx, cycle_id, winner_index, max_bonds);
    ctx.svm.expire_blockhash();
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ─── Readers ─────────────────────────────────────────────────────────────────

fn read_pool(svm: &LiteSVM) -> anchor::PrizePool {
    let (p, _) = pool_pda(1);
    anchor::PrizePool::try_deserialize(&mut svm.get_account(&p).unwrap().data.as_slice()).unwrap()
}

fn read_payout(svm: &LiteSVM, cid: u32) -> anchor::PayoutRegistry {
    let (p, _) = payout_pda(1, cid);
    anchor::PayoutRegistry::try_deserialize(&mut svm.get_account(&p).unwrap().data.as_slice())
        .unwrap()
}

fn read_reg_pending(svm: &LiteSVM, reg: Pubkey) -> u32 {
    u32::from_le_bytes(
        svm.get_account(&reg).unwrap().data[20..24]
            .try_into()
            .unwrap(),
    )
}

fn read_reg_ticket(svm: &LiteSVM, reg: Pubkey, idx: usize) -> Pubkey {
    let d = svm.get_account(&reg).unwrap().data;
    let s = 24 + idx * 32;
    Pubkey::try_from(&d[s..s + 32]).unwrap()
}

// ─── Setup ───────────────────────────────────────────────────────────────────

fn setup(
    status: anchor::PoolStatus,
    frozen: bool,
    bond_price: u64,
    amount_owed: u64,
    reinvested: u64,
) -> Ctx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );
    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey();
    let reg = Keypair::new().pubkey();
    inject_registry(&mut svm, reg, 1, 1000, 0, 0);

    inject_pool(&mut svm, 1, mint, reg, status, frozen, bond_price);
    inject_payout(
        &mut svm,
        1,
        0,
        vec![w(winner, amount_owed, 0, reinvested, false)],
    );

    Ctx {
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
fn test_reinvest_fails_max_bonds_zero() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    let err = send(&mut ctx, 0, 0, 0).unwrap_err();
    assert!(err.contains("InvalidBondQuantity"), "got: {err}");
}

#[test]
fn test_reinvest_fails_wrong_winner() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    ctx.winner = Keypair::new().pubkey(); // different from registry entry
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("UnauthorizedTicket"), "got: {err}");
}

#[test]
fn test_reinvest_fails_already_paid() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    // Re-inject with paid_out=true
    inject_payout(
        &mut ctx.svm,
        1,
        0,
        vec![w(ctx.winner, 3_000_000, 0, 0, true)],
    );
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("AlreadyClaimed"), "got: {err}");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-Path Tests (pure accounting — no CPI needed)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reinvest_single_batch_full() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    send(&mut ctx, 0, 0, 10).expect("reinvest");

    let pr = read_payout(&ctx.svm, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 3_000_000);
    assert_eq!(pr.payouts_completed, 1);

    let pool = read_pool(&ctx.svm);
    assert_eq!(pool.total_deposited_principal, 3_000_000);
}

#[test]
fn test_reinvest_single_batch_with_dust() {
    // 3.5M owed, 1M bond_price → 3 bonds (3M reinvested), 500K dust
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_500_000, 0);
    send(&mut ctx, 0, 0, 10).expect("reinvest");

    let pr = read_payout(&ctx.svm, 0);
    // Dust stays as claimable via claim_prize, so paid_out is false
    assert!(!pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 3_000_000);
}

#[test]
fn test_reinvest_multi_batch() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 5_000_000, 0);

    // Batch 1: max_bonds=2
    send(&mut ctx, 0, 0, 2).expect("batch 1");
    let pr = read_payout(&ctx.svm, 0);
    assert!(!pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 2_000_000);

    // Batch 2: max_bonds=2
    send(&mut ctx, 0, 0, 2).expect("batch 2");
    let pr = read_payout(&ctx.svm, 0);
    assert!(!pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 4_000_000);

    // Batch 3: final (1 bond remaining)
    send(&mut ctx, 0, 0, 2).expect("batch 3");
    let pr = read_payout(&ctx.svm, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 5_000_000);
}

#[test]
fn test_reinvest_tickets_written() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 2_000_000, 0);
    send(&mut ctx, 0, 0, 10).expect("reinvest");

    assert_eq!(read_reg_pending(&ctx.svm, ctx.registry), 2);
    assert_eq!(read_reg_ticket(&ctx.svm, ctx.registry, 0), ctx.winner);
    assert_eq!(read_reg_ticket(&ctx.svm, ctx.registry, 1), ctx.winner);
}

#[test]
fn test_reinvest_principal_increments() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 3_000_000, 0);
    send(&mut ctx, 0, 0, 10).expect("reinvest");

    let pool = read_pool(&ctx.svm);
    assert_eq!(pool.total_deposited_principal, 3_000_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// Edge Tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_reinvest_dust_only_no_bonds() {
    // amount < bond_price → 0 bonds reinvested, dust stays
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 500_000, 0);
    send(&mut ctx, 0, 0, 10).expect("dust only");

    let pr = read_payout(&ctx.svm, 0);
    // Dust remains claimable via claim_prize, paid_out stays false
    assert!(!pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 0);

    let pool = read_pool(&ctx.svm);
    assert_eq!(pool.total_deposited_principal, 0);
}

#[test]
fn test_reinvest_fails_registry_full() {
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 2_000_000, 0);
    // Re-inject registry at capacity
    inject_registry(&mut ctx.svm, ctx.registry, 1, 10, 10, 0);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("RegistryFull"), "got: {err}");
}
