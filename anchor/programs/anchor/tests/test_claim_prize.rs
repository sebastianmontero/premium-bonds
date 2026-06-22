//! Integration tests for `claim_prize` (Huma-based async redemption).
//!
//! Guard tests verify validation logic before CPI is reached.
//! Happy-path tests require a mock-huma program and are marked #[ignore].

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
const POOL_PST_SEED: &[u8] = b"pool_pst";
const PAYOUT_SEED: &[u8] = b"payout";
const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";

fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn pool_pst_vault_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_PST_SEED, id.to_le_bytes().as_ref()], &anchor::id())
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
fn pending_redemption_pda(pool_id: u32, redemption_id: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            PENDING_REDEMPTION_SEED,
            pool_id.to_le_bytes().as_ref(),
            redemption_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    data[36..44].copy_from_slice(&u64::MAX.to_le_bytes());
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

fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    status: anchor::PoolStatus,
) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        next_redemption_id: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: false,
        current_draw_cycle_id: 0,
        prize_tiers: vec![],
    };
    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
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

fn inject_payout_registry(
    svm: &mut LiteSVM,
    pool_id: u32,
    cycle_id: u32,
    winners: Vec<anchor::Winner>,
) {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let pr = anchor::PayoutRegistry {
        pool_id,
        cycle_id,
        winners_count: winners.len() as u32,
        payouts_completed: 0,
        winners,
    };
    let mut data = vec![];
    pr.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PayoutRegistry::INIT_SPACE, 0);
    svm.set_account(
        pda,
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

fn make_winner(
    pubkey: Pubkey,
    amount_owed: u64,
    tier: u8,
    reinvested: u64,
    paid: bool,
) -> anchor::Winner {
    anchor::Winner {
        winner_pubkey: pubkey,
        amount_owed,
        paid_out: paid,
        tier_index: tier,
        amount_reinvested: reinvested,
    }
}

// ─── Instruction builder ─────────────────────────────────────────────────────

fn build_claim_ix(
    user: Pubkey,
    pool_id: u32,
    cycle_id: u32,
    winner_index: u32,
    pst_mint: Pubkey,
) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (payout, _) = payout_pda(pool_id, cycle_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0); // next_redemption_id=0
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimPrize {
        user,
        pool,
        payout_registry: payout,
        pool_pst_vault,
        pending_redemption,
        huma_program: anchor::constants::HUMA_PROGRAM_ID,
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: dummy,
        huma_mode_config: dummy,
        huma_mode_mint: dummy,
        huma_redemption_request: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: dummy,
        huma_pool_mode_token: dummy,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimPrize {
            cycle_id,
            winner_index,
        }
        .data(),
    }
}

// ─── Setup ───────────────────────────────────────────────────────────────────

struct ClaimCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pst_mint: Pubkey,
}

fn setup_claim_guard(winners: Vec<anchor::Winner>, status: anchor::PoolStatus) -> ClaimCtx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, status);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 0);

    inject_payout_registry(&mut svm, 1, 0, winners);

    ClaimCtx {
        svm,
        user,
        token_mint,
        pst_mint,
    }
}

fn send_claim(
    ctx: &mut ClaimCtx,
    pool_id: u32,
    cycle_id: u32,
    winner_index: u32,
) -> Result<(), String> {
    let ix = build_claim_ix(
        ctx.user.pubkey(),
        pool_id,
        cycle_id,
        winner_index,
        ctx.pst_mint,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests (validation fires before Huma CPI)
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_fails_wrong_user() {
    let real_winner = Keypair::new().pubkey();
    let winners = vec![make_winner(real_winner, 500_000, 0, 0, false)];
    let mut ctx = setup_claim_guard(winners, anchor::PoolStatus::Active);
    let err = send_claim(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("UnauthorizedTicket"), "got: {err}");
}

#[test]
fn test_claim_fails_invalid_winner_index() {
    let user = Keypair::new();
    let winners = vec![make_winner(user.pubkey(), 500_000, 0, 0, false)];
    let mut ctx = setup_claim_guard(winners, anchor::PoolStatus::Active);
    // Override user
    ctx.user = user;
    ctx.svm.airdrop(&ctx.user.pubkey(), 10_000_000_000).unwrap();
    // Only 1 winner (index 0), try index 5
    let err = send_claim(&mut ctx, 1, 0, 5).unwrap_err();
    assert!(err.contains("InvalidIndices"), "got: {err}");
}

#[test]
fn test_claim_fails_already_claimed() {
    let user = Keypair::new();
    let winners = vec![make_winner(user.pubkey(), 500_000, 0, 0, true)]; // paid_out=true
    let mut ctx = setup_claim_guard(winners, anchor::PoolStatus::Active);
    ctx.user = user;
    ctx.svm.airdrop(&ctx.user.pubkey(), 10_000_000_000).unwrap();
    let err = send_claim(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("AlreadyClaimed"), "got: {err}");
}

#[test]
fn test_claim_fails_wrong_cycle_id() {
    let user = Keypair::new();
    let winners = vec![make_winner(user.pubkey(), 500_000, 0, 0, false)];
    let mut ctx = setup_claim_guard(winners, anchor::PoolStatus::Active);
    ctx.user = user;
    ctx.svm.airdrop(&ctx.user.pubkey(), 10_000_000_000).unwrap();
    // Registry exists for cycle_id=0, but we pass cycle_id=99
    let err = send_claim(&mut ctx, 1, 99, 0).unwrap_err();
    assert!(!err.is_empty(), "Wrong cycle_id should fail PDA derivation");
}
