//! Integration tests for `claim_prize`.

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
const POOL_VAULT_SEED: &[u8] = b"pool_vault";
const PAYOUT_SEED: &[u8] = b"payout";

fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn pool_vault_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_VAULT_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn payout_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PAYOUT_SEED, pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}
fn ata_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), anchor_spl::token::ID.as_ref(), mint.as_ref()],
        &anchor_spl::associated_token::ID,
    ).0
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    // No mint authority needed (we won't mint, just transfer)
    data[36..44].copy_from_slice(&u64::MAX.to_le_bytes()); // large supply
    data[44] = decimals;
    data[45] = 1; // is_initialized
    svm.set_account(address, Account {
        lamports: 1_000_000_000, data, owner: anchor_spl::token::ID,
        executable: false, rent_epoch: 0,
    }).unwrap();
}

fn inject_token_account(svm: &mut LiteSVM, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[32..64].copy_from_slice(&owner.to_bytes());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1; // is_initialized
    svm.set_account(address, Account {
        lamports: 1_000_000_000, data, owner: anchor_spl::token::ID,
        executable: false, rent_epoch: 0,
    }).unwrap();
}

fn inject_pool(svm: &mut LiteSVM, pool_id: u32, token_mint: Pubkey, status: anchor::PoolStatus) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump, pool_id, token_mint,
        ticket_registry: Pubkey::default(), fee_wallet: Pubkey::default(),
        bond_price: 1_000_000, stake_cycle_duration_hrs: 24,
        fee_basis_points: 100, status, total_deposited_principal: 0,
        total_fees_collected: 0, current_cycle_end_at: 0,
        is_frozen_for_draw: false, current_draw_cycle_id: 0,
        max_withdrawal_slippage_dust: 0, prize_tiers: vec![],
        auto_reinvest_default: false,
    };
    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    svm.set_account(pda, Account {
        lamports: 1_000_000_000, data, owner: anchor::id(),
        executable: false, rent_epoch: 0,
    }).unwrap();
    pda
}

fn inject_payout_registry(
    svm: &mut LiteSVM, pool_id: u32, cycle_id: u32,
    winners: Vec<anchor::Winner>,
) {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let pr = anchor::PayoutRegistry {
        pool_id, cycle_id,
        winners_count: winners.len() as u32,
        payouts_completed: 0,
        winners,
    };
    let mut data = vec![];
    pr.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PayoutRegistry::INIT_SPACE, 0);
    svm.set_account(pda, Account {
        lamports: 10_000_000_000, data, owner: anchor::id(),
        executable: false, rent_epoch: 0,
    }).unwrap();
}

fn make_winner(pubkey: Pubkey, amount_owed: u64, tier: u8, reinvested: u64, paid: bool) -> anchor::Winner {
    anchor::Winner {
        winner_pubkey: pubkey, amount_owed, paid_out: paid,
        tier_index: tier, amount_reinvested: reinvested,
    }
}

// ─── Context + helpers ───────────────────────────────────────────────────────

struct ClaimCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    pool_vault: Pubkey,
    user_ata: Pubkey,
}

fn build_claim_ix(ctx: &ClaimCtx, pool_id: u32, cycle_id: u32, winner_index: u32) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (payout, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::ClaimPrize {
        user: ctx.user.pubkey(),
        payout_registry: payout, pool,
        user_token_account: ctx.user_ata,
        token_mint: ctx.token_mint,
        pool_vault_account: ctx.pool_vault,
        token_program: anchor_spl::token::ID,
    }.to_account_metas(None);

    Instruction { program_id: anchor::id(), accounts,
        data: anchor::instruction::ClaimPrize { cycle_id, winner_index }.data() }
}

fn send_claim(ctx: &mut ClaimCtx, pool_id: u32, cycle_id: u32, winner_index: u32) -> Result<(), String> {
    let ix = build_claim_ix(ctx, pool_id, cycle_id, winner_index);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
}

// ─── Readers ─────────────────────────────────────────────────────────────────

fn read_token_balance(svm: &LiteSVM, address: Pubkey) -> u64 {
    let acct = svm.get_account(&address).unwrap();
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

fn read_payout_registry(svm: &LiteSVM, pool_id: u32, cycle_id: u32) -> anchor::PayoutRegistry {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let acct = svm.get_account(&pda).unwrap();
    anchor::PayoutRegistry::try_deserialize(&mut acct.data.as_slice()).unwrap()
}

// ─── Setup ───────────────────────────────────────────────────────────────────

fn setup_claim(
    winners: Vec<anchor::Winner>,
    vault_balance: u64,
    status: anchor::PoolStatus,
) -> ClaimCtx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));

    // The user is winners[0].winner_pubkey — we need a Keypair for signing.
    // Instead, create user first, then build winners with that pubkey.
    // Caller must pass the user's pubkey as winners[0].winner_pubkey.
    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, status);

    let (pool_vault, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, vault_balance);

    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);

    inject_payout_registry(&mut svm, 1, 0, winners);

    ClaimCtx { svm, user, token_mint, pool_vault, user_ata }
}

/// Setup with the user as the first winner.
fn setup_with_user_winner(amount_owed: u64, reinvested: u64, vault_balance: u64) -> ClaimCtx {
    let user = Keypair::new();
    let winners = vec![make_winner(user.pubkey(), amount_owed, 0, reinvested, false)];

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Active);

    let (pool_vault, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, vault_balance);

    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);

    inject_payout_registry(&mut svm, 1, 0, winners);

    ClaimCtx { svm, user, token_mint, pool_vault, user_ata }
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_fails_wrong_user() {
    let real_winner = Keypair::new().pubkey();
    let winners = vec![make_winner(real_winner, 500_000, 0, 0, false)];
    let mut ctx = setup_claim(winners, 1_000_000, anchor::PoolStatus::Active);
    // ctx.user is NOT real_winner
    let err = send_claim(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("UnauthorizedTicket"), "got: {err}");
}

#[test]
fn test_claim_fails_invalid_winner_index() {
    let mut ctx = setup_with_user_winner(500_000, 0, 1_000_000);
    // Only 1 winner (index 0), try index 5
    let err = send_claim(&mut ctx, 1, 0, 5).unwrap_err();
    assert!(err.contains("InvalidIndices"), "got: {err}");
}

#[test]
fn test_claim_fails_already_claimed() {
    let user = Keypair::new();
    let winners = vec![make_winner(user.pubkey(), 500_000, 0, 0, true)]; // paid_out=true

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Active);
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 1_000_000);
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);
    inject_payout_registry(&mut svm, 1, 0, winners);

    let mut ctx = ClaimCtx { svm, user, token_mint, pool_vault: pv, user_ata };
    let err = send_claim(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("AlreadyClaimed"), "got: {err}");
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_full_prize() {
    let mut ctx = setup_with_user_winner(500_000, 0, 1_000_000);
    send_claim(&mut ctx, 1, 0, 0).expect("claim");

    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 500_000);
    assert_eq!(read_token_balance(&ctx.svm, ctx.pool_vault), 500_000);

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.payouts_completed, 1);
}

#[test]
fn test_claim_partial_reinvestment() {
    let mut ctx = setup_with_user_winner(500_000, 200_000, 1_000_000);
    send_claim(&mut ctx, 1, 0, 0).expect("claim");

    // claimable = 500K - 200K = 300K
    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 300_000);
    assert_eq!(read_token_balance(&ctx.svm, ctx.pool_vault), 700_000);

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert!(pr.winners[0].paid_out);
}

#[test]
fn test_claim_fully_reinvested() {
    let mut ctx = setup_with_user_winner(500_000, 500_000, 1_000_000);
    send_claim(&mut ctx, 1, 0, 0).expect("claim");

    // claimable = 0, no transfer
    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 0);
    assert_eq!(read_token_balance(&ctx.svm, ctx.pool_vault), 1_000_000);

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.payouts_completed, 1);
}

#[test]
fn test_claim_payouts_completed_increments() {
    let user = Keypair::new();
    let winners = vec![
        make_winner(user.pubkey(), 100_000, 0, 0, false),
        make_winner(user.pubkey(), 200_000, 1, 0, false),
        make_winner(user.pubkey(), 300_000, 1, 0, false),
    ];

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Active);
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 1_000_000);
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);
    inject_payout_registry(&mut svm, 1, 0, winners);

    let mut ctx = ClaimCtx { svm, user, token_mint, pool_vault: pv, user_ata };

    // Claim index 0
    send_claim(&mut ctx, 1, 0, 0).expect("claim 0");
    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.payouts_completed, 1);

    // Claim index 1
    send_claim(&mut ctx, 1, 0, 1).expect("claim 1");
    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.payouts_completed, 2);
}

#[test]
fn test_claim_all_winners() {
    let user = Keypair::new();
    let winners = vec![
        make_winner(user.pubkey(), 400_000, 0, 0, false),
        make_winner(user.pubkey(), 600_000, 1, 0, false),
    ];

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Active);
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 1_000_000);
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);
    inject_payout_registry(&mut svm, 1, 0, winners);

    let mut ctx = ClaimCtx { svm, user, token_mint, pool_vault: pv, user_ata };

    send_claim(&mut ctx, 1, 0, 0).expect("claim 0");
    send_claim(&mut ctx, 1, 0, 1).expect("claim 1");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert_eq!(pr.payouts_completed, 2);
    assert_eq!(pr.winners_count, 2);
    assert!(pr.winners.iter().all(|w| w.paid_out));

    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 1_000_000);
    assert_eq!(read_token_balance(&ctx.svm, ctx.pool_vault), 0);
}

#[test]
fn test_claim_different_tiers() {
    let user = Keypair::new();
    let winners = vec![
        make_winner(user.pubkey(), 700_000, 0, 0, false),
        make_winner(user.pubkey(), 100_000, 1, 0, false),
    ];

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Active);
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 1_000_000);
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);
    inject_payout_registry(&mut svm, 1, 0, winners);

    let mut ctx = ClaimCtx { svm, user, token_mint, pool_vault: pv, user_ata };

    send_claim(&mut ctx, 1, 0, 0).expect("tier 0");
    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 700_000);

    send_claim(&mut ctx, 1, 0, 1).expect("tier 1");
    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 800_000);
}

// ═════════════════════════════════════════════════════════════════════════════
// Edge / design tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_claim_fails_insufficient_vault() {
    let mut ctx = setup_with_user_winner(500_000, 0, 100); // vault only has 100
    let err = send_claim(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(!err.is_empty(), "Should fail on insufficient funds");
}

#[test]
fn test_claim_does_not_affect_other_winners() {
    let user = Keypair::new();
    let other = Keypair::new().pubkey();
    let winners = vec![
        make_winner(user.pubkey(), 300_000, 0, 0, false),
        make_winner(other, 200_000, 1, 0, false),
    ];

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Active);
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 1_000_000);
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);
    inject_payout_registry(&mut svm, 1, 0, winners);

    let mut ctx = ClaimCtx { svm, user, token_mint, pool_vault: pv, user_ata };
    send_claim(&mut ctx, 1, 0, 0).expect("claim index 0");

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    assert!(pr.winners[0].paid_out);
    // Other winner untouched
    assert!(!pr.winners[1].paid_out);
    assert_eq!(pr.winners[1].amount_owed, 200_000);
    assert_eq!(pr.winners[1].winner_pubkey, other);
}

#[test]
fn test_claim_succeeds_pool_paused() {
    let user = Keypair::new();
    let winners = vec![make_winner(user.pubkey(), 500_000, 0, 0, false)];

    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    let pool_key = pool_pda(1).0;
    inject_pool(&mut svm, 1, token_mint, anchor::PoolStatus::Paused); // Paused!
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 1_000_000);
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);
    inject_payout_registry(&mut svm, 1, 0, winners);

    let mut ctx = ClaimCtx { svm, user, token_mint, pool_vault: pv, user_ata };
    send_claim(&mut ctx, 1, 0, 0).expect("claim should succeed even when paused");

    assert_eq!(read_token_balance(&ctx.svm, ctx.user_ata), 500_000);
}

#[test]
fn test_claim_fails_wrong_cycle_id() {
    let mut ctx = setup_with_user_winner(500_000, 0, 1_000_000);
    // Registry exists for cycle_id=0, but we pass cycle_id=99
    let err = send_claim(&mut ctx, 1, 99, 0).unwrap_err();
    assert!(!err.is_empty(), "Wrong cycle_id should fail PDA derivation");
}
