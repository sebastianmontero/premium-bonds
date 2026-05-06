//! Integration tests for `reinvest_winnings`.
use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{account::Account, message::{Message, VersionedMessage}, signature::Keypair, signer::Signer};
use solana_transaction::versioned::VersionedTransaction;

const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const POOL_VAULT_SEED: &[u8] = b"pool_vault";
const POOL_KTOKENS_SEED: &[u8] = b"pool_ktokens";
const PAYOUT_SEED: &[u8] = b"payout";
const USER_PREF_SEED: &[u8] = b"user_pref";
const LMA_SEED: &[u8] = b"lma";

fn pool_pda(id: u32) -> (Pubkey, u8) { Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id()) }
fn pool_vault_pda(id: u32) -> (Pubkey, u8) { Pubkey::find_program_address(&[POOL_VAULT_SEED, id.to_le_bytes().as_ref()], &anchor::id()) }
fn pool_ktokens_pda(id: u32) -> (Pubkey, u8) { Pubkey::find_program_address(&[POOL_KTOKENS_SEED, id.to_le_bytes().as_ref()], &anchor::id()) }
fn payout_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) { Pubkey::find_program_address(&[PAYOUT_SEED, pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()], &anchor::id()) }
fn user_pref_pda(pool_id: u32, user: &Pubkey) -> (Pubkey, u8) { Pubkey::find_program_address(&[USER_PREF_SEED, pool_id.to_le_bytes().as_ref(), user.as_ref()], &anchor::id()) }
fn lma_pda(lm: &Pubkey) -> (Pubkey, u8) { Pubkey::find_program_address(&[LMA_SEED, lm.as_ref()], &anchor::constants::KAMINO_PROGRAM_ID) }
fn ata_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey { Pubkey::find_program_address(&[wallet.as_ref(), anchor_spl::token::ID.as_ref(), mint.as_ref()], &anchor_spl::associated_token::ID).0 }

fn inject_mint(svm: &mut LiteSVM, addr: Pubkey, dec: u8, auth: Option<Pubkey>) {
    let mut d = vec![0u8; 82];
    if let Some(a) = auth { d[0..4].copy_from_slice(&1u32.to_le_bytes()); d[4..36].copy_from_slice(&a.to_bytes()); }
    d[44] = dec; d[45] = 1;
    svm.set_account(addr, Account { lamports: 1_000_000_000, data: d, owner: anchor_spl::token::ID, executable: false, rent_epoch: 0 }).unwrap();
}
fn inject_token_account(svm: &mut LiteSVM, addr: Pubkey, mint: Pubkey, owner: Pubkey, amt: u64) {
    let mut d = vec![0u8; 165]; d[0..32].copy_from_slice(&mint.to_bytes()); d[32..64].copy_from_slice(&owner.to_bytes()); d[64..72].copy_from_slice(&amt.to_le_bytes()); d[108] = 1;
    svm.set_account(addr, Account { lamports: 1_000_000_000, data: d, owner: anchor_spl::token::ID, executable: false, rent_epoch: 0 }).unwrap();
}
fn inject_owned(svm: &mut LiteSVM, addr: Pubkey, owner: Pubkey, d: &[u8]) {
    svm.set_account(addr, Account { lamports: 1_000_000_000, data: d.to_vec(), owner, executable: false, rent_epoch: 0 }).unwrap();
}
fn inject_registry(svm: &mut LiteSVM, addr: Pubkey, pool_id: u32, cap: u32, active: u32, pending: u32) {
    let mut d = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    d[0..8].copy_from_slice(&[58,169,167,230,107,202,126,54]);
    d[8..12].copy_from_slice(&pool_id.to_le_bytes()); d[12..16].copy_from_slice(&cap.to_le_bytes());
    d[16..20].copy_from_slice(&active.to_le_bytes()); d[20..24].copy_from_slice(&pending.to_le_bytes());
    svm.set_account(addr, Account { lamports: 10_000_000_000, data: d, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
}
fn inject_pool(svm: &mut LiteSVM, id: u32, mint: Pubkey, reg: Pubkey, status: anchor::PoolStatus, frozen: bool, auto_reinvest: bool, bond_price: u64) -> Pubkey {
    let (pda, bump) = pool_pda(id);
    let p = anchor::PrizePool { vault_authority_bump: bump, pool_id: id, token_mint: mint, ticket_registry: reg, fee_wallet: Pubkey::default(), bond_price, stake_cycle_duration_hrs: 24, fee_basis_points: 100, status, total_deposited_principal: 0, total_fees_collected: 0, current_cycle_end_at: 0, is_frozen_for_draw: frozen, current_draw_cycle_id: 0, max_withdrawal_slippage_dust: 0, prize_tiers: vec![], auto_reinvest_default: auto_reinvest };
    let mut d = vec![]; p.try_serialize(&mut d).unwrap(); d.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    svm.set_account(pda, Account { lamports: 1_000_000_000, data: d, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap(); pda
}
fn inject_payout(svm: &mut LiteSVM, pool_id: u32, cycle_id: u32, winners: Vec<anchor::Winner>) {
    let (pda, _) = payout_pda(pool_id, cycle_id);
    let pr = anchor::PayoutRegistry { pool_id, cycle_id, winners_count: winners.len() as u32, payouts_completed: 0, winners };
    let mut d = vec![]; pr.try_serialize(&mut d).unwrap(); d.resize(8 + anchor::PayoutRegistry::INIT_SPACE, 0);
    svm.set_account(pda, Account { lamports: 10_000_000_000, data: d, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
}
fn inject_user_pref(svm: &mut LiteSVM, pool_id: u32, user: &Pubkey, auto_reinvest: bool) {
    let (pda, _) = user_pref_pda(pool_id, user);
    let up = anchor::UserPreference { pool_id, user: *user, auto_reinvest };
    let mut d = vec![]; up.try_serialize(&mut d).unwrap(); d.resize(8 + anchor::UserPreference::INIT_SPACE, 0);
    svm.set_account(pda, Account { lamports: 1_000_000_000, data: d, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
}
fn w(pk: Pubkey, owed: u64, tier: u8, reinvested: u64, paid: bool) -> anchor::Winner {
    anchor::Winner { winner_pubkey: pk, amount_owed: owed, paid_out: paid, tier_index: tier, amount_reinvested: reinvested }
}

struct Ctx { svm: LiteSVM, crank: Keypair, winner: Pubkey, token_mint: Pubkey, registry: Pubkey, reserve: Pubkey, lending_market: Pubkey, lma: Pubkey, rls: Pubkey, rcm: Pubkey }

fn build_ix(ctx: &Ctx, cycle_id: u32, winner_index: u32, max_bonds: u32, with_pref: bool) -> Instruction {
    let (pool, _) = pool_pda(1); let (payout, _) = payout_pda(1, cycle_id);
    let (pv, _) = pool_vault_pda(1); let (pk, _) = pool_ktokens_pda(1);
    let winner_ata = ata_address(&ctx.winner, &ctx.token_mint);
    let pref = if with_pref { Some(user_pref_pda(1, &ctx.winner).0) } else { None };
    let accounts = anchor::accounts::ReinvestWinnings {
        crank: ctx.crank.pubkey(), winner: ctx.winner, user_preference: pref,
        payout_registry: payout, pool, ticket_registry: ctx.registry,
        user_token_account: winner_ata, token_mint: ctx.token_mint,
        pool_vault_account: pv, pool_ktokens_vault: pk,
        kamino_program: anchor::constants::KAMINO_PROGRAM_ID, reserve: ctx.reserve,
        lending_market: ctx.lending_market, lending_market_authority: ctx.lma,
        reserve_liquidity_supply: ctx.rls, reserve_collateral_mint: ctx.rcm,
        token_program: anchor_spl::token::ID, ktokens_token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
        instruction_sysvar_account: anchor::constants::INSTRUCTIONS_SYSVAR_ID,
    }.to_account_metas(None);
    Instruction { program_id: anchor::id(), accounts, data: anchor::instruction::ReinvestWinnings { cycle_id, winner_index, max_bonds }.data() }
}

fn send(ctx: &mut Ctx, cycle_id: u32, winner_index: u32, max_bonds: u32) -> Result<(), String> {
    send_with_pref(ctx, cycle_id, winner_index, max_bonds, false)
}
fn send_with_pref(ctx: &mut Ctx, cycle_id: u32, winner_index: u32, max_bonds: u32, with_pref: bool) -> Result<(), String> {
    let ix = build_ix(ctx, cycle_id, winner_index, max_bonds, with_pref);
    ctx.svm.expire_blockhash();
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
}

fn read_pool(svm: &LiteSVM) -> anchor::PrizePool { let (p,_) = pool_pda(1); anchor::PrizePool::try_deserialize(&mut svm.get_account(&p).unwrap().data.as_slice()).unwrap() }
fn read_payout(svm: &LiteSVM, cid: u32) -> anchor::PayoutRegistry { let (p,_) = payout_pda(1,cid); anchor::PayoutRegistry::try_deserialize(&mut svm.get_account(&p).unwrap().data.as_slice()).unwrap() }
fn read_bal(svm: &LiteSVM, addr: Pubkey) -> u64 { u64::from_le_bytes(svm.get_account(&addr).unwrap().data[64..72].try_into().unwrap()) }
fn read_reg_pending(svm: &LiteSVM, reg: Pubkey) -> u32 { u32::from_le_bytes(svm.get_account(&reg).unwrap().data[20..24].try_into().unwrap()) }
fn read_reg_ticket(svm: &LiteSVM, reg: Pubkey, idx: usize) -> Pubkey { let d = svm.get_account(&reg).unwrap().data; let s = 24+idx*32; Pubkey::try_from(&d[s..s+32]).unwrap() }

/// Setup for guard tests (no mock Kamino needed).
fn setup_guard(status: anchor::PoolStatus, frozen: bool, auto_default: bool, bond_price: u64, amount_owed: u64) -> Ctx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    let crank = Keypair::new(); svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    let winner = Keypair::new().pubkey();
    let mint = Keypair::new().pubkey(); inject_mint(&mut svm, mint, 6, None);
    let rcm = Keypair::new().pubkey(); inject_mint(&mut svm, rcm, 6, None);
    let reg = Keypair::new().pubkey(); inject_registry(&mut svm, reg, 1, 1000, 0, 0);
    let pool_key = pool_pda(1).0;
    let (pv,_) = pool_vault_pda(1); inject_token_account(&mut svm, pv, mint, pool_key, amount_owed);
    let (pk,_) = pool_ktokens_pda(1); inject_token_account(&mut svm, pk, rcm, pool_key, 0);
    inject_pool(&mut svm, 1, mint, reg, status, frozen, auto_default, bond_price);
    inject_payout(&mut svm, 1, 0, vec![w(winner, amount_owed, 0, 0, false)]);
    let wa = ata_address(&winner, &mint); inject_token_account(&mut svm, wa, mint, winner, 0);
    let dummy = Keypair::new().pubkey();
    Ctx { svm, crank, winner, token_mint: mint, registry: reg, reserve: dummy, lending_market: dummy, lma: dummy, rls: dummy, rcm }
}

/// Setup with mock Kamino loaded for happy-path deposit CPI.
fn setup_happy(amount_owed: u64, reinvested: u64, bond_price: u64, auto_default: bool) -> Ctx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(anchor::id(), include_bytes!("../../../target/deploy/anchor.so"));
    let _ = svm.add_program(anchor::constants::KAMINO_PROGRAM_ID, include_bytes!("../../../target/deploy/mock_kamino.so"));
    let crank = Keypair::new(); svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    let winner = Keypair::new().pubkey();
    let lending_market = Keypair::new().pubkey();
    inject_owned(&mut svm, lending_market, anchor::constants::KAMINO_PROGRAM_ID, &[0u8; 64]);
    let (lma,_) = lma_pda(&lending_market);
    let reserve = Keypair::new().pubkey();
    inject_owned(&mut svm, reserve, anchor::constants::KAMINO_PROGRAM_ID, &[0u8; 32]);
    let mint = Keypair::new().pubkey(); inject_mint(&mut svm, mint, 6, None);
    let rcm = Keypair::new().pubkey(); inject_mint(&mut svm, rcm, 6, Some(lma));
    let reg = Keypair::new().pubkey(); inject_registry(&mut svm, reg, 1, 1000, 0, 0);
    let pool_key = pool_pda(1).0;
    let (pv,_) = pool_vault_pda(1); inject_token_account(&mut svm, pv, mint, pool_key, amount_owed);
    let (pk,_) = pool_ktokens_pda(1); inject_token_account(&mut svm, pk, rcm, pool_key, 0);
    let rls = Keypair::new().pubkey(); inject_token_account(&mut svm, rls, mint, lma, 0);
    inject_pool(&mut svm, 1, mint, reg, anchor::PoolStatus::Active, false, auto_default, bond_price);
    inject_payout(&mut svm, 1, 0, vec![w(winner, amount_owed, 0, reinvested, false)]);
    let wa = ata_address(&winner, &mint); inject_token_account(&mut svm, wa, mint, winner, 0);
    Ctx { svm, crank, winner, token_mint: mint, registry: reg, reserve, lending_market, lma, rls, rcm }
}

// ═══ Guard Tests ═══

#[test]
fn test_reinvest_fails_max_bonds_zero() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, true, 1_000_000, 3_000_000);
    let err = send(&mut ctx, 0, 0, 0).unwrap_err();
    assert!(err.contains("InvalidBondQuantity"), "got: {err}");
}

#[test]
fn test_reinvest_fails_auto_reinvest_disabled_default() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, false, 1_000_000, 3_000_000);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("AutoReinvestNotEnabled"), "got: {err}");
}

#[test]
fn test_reinvest_fails_auto_reinvest_disabled_pref() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, true, 1_000_000, 3_000_000);
    inject_user_pref(&mut ctx.svm, 1, &ctx.winner, false); // pref overrides to false
    let err = send_with_pref(&mut ctx, 0, 0, 10, true).unwrap_err();
    assert!(err.contains("AutoReinvestNotEnabled"), "got: {err}");
}

#[test]
fn test_reinvest_fails_pool_not_active() {
    let mut ctx = setup_guard(anchor::PoolStatus::Paused, false, true, 1_000_000, 3_000_000);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("PoolNotActive"), "got: {err}");
}

#[test]
fn test_reinvest_fails_pool_frozen() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, true, true, 1_000_000, 3_000_000);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("AwaitingRandomnessFreeze"), "got: {err}");
}

// ═══ Happy-Path Tests ═══

#[test]
fn test_reinvest_single_batch_full() {
    let mut ctx = setup_happy(3_000_000, 0, 1_000_000, true);
    send(&mut ctx, 0, 0, 10).expect("reinvest");
    let pr = read_payout(&ctx.svm, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 3_000_000);
    assert_eq!(pr.payouts_completed, 1);
    let wa = ata_address(&ctx.winner, &ctx.token_mint);
    assert_eq!(read_bal(&ctx.svm, wa), 0); // no dust
}

#[test]
fn test_reinvest_single_batch_with_dust() {
    let mut ctx = setup_happy(3_500_000, 0, 1_000_000, true);
    send(&mut ctx, 0, 0, 10).expect("reinvest");
    let pr = read_payout(&ctx.svm, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 3_000_000);
    let wa = ata_address(&ctx.winner, &ctx.token_mint);
    assert_eq!(read_bal(&ctx.svm, wa), 500_000); // dust
}

#[test]
fn test_reinvest_multi_batch() {
    let mut ctx = setup_happy(5_000_000, 0, 1_000_000, true);
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
fn test_reinvest_user_pref_overrides_pool_default() {
    let mut ctx = setup_happy(2_000_000, 0, 1_000_000, false); // pool default=false
    inject_user_pref(&mut ctx.svm, 1, &ctx.winner, true); // pref=true
    send_with_pref(&mut ctx, 0, 0, 10, true).expect("should succeed with pref override");
    assert!(read_payout(&ctx.svm, 0).winners[0].paid_out);
}

#[test]
fn test_reinvest_pool_default_no_pref() {
    let mut ctx = setup_happy(2_000_000, 0, 1_000_000, true); // pool default=true, no pref
    send(&mut ctx, 0, 0, 10).expect("should succeed with pool default");
    assert!(read_payout(&ctx.svm, 0).winners[0].paid_out);
}

#[test]
fn test_reinvest_vault_ktokens_principal() {
    let mut ctx = setup_happy(3_000_000, 0, 1_000_000, true);
    let (pv,_) = pool_vault_pda(1); let (pk,_) = pool_ktokens_pda(1);
    let vault_before = read_bal(&ctx.svm, pv);
    send(&mut ctx, 0, 0, 10).expect("reinvest");
    assert_eq!(read_bal(&ctx.svm, pv), vault_before - 3_000_000);
    assert_eq!(read_bal(&ctx.svm, pk), 3_000_000); // kTokens 1:1 mock
    assert_eq!(read_pool(&ctx.svm).total_deposited_principal, 3_000_000);
}

#[test]
fn test_reinvest_tickets_written() {
    let mut ctx = setup_happy(2_000_000, 0, 1_000_000, true);
    send(&mut ctx, 0, 0, 10).expect("reinvest");
    assert_eq!(read_reg_pending(&ctx.svm, ctx.registry), 2);
    assert_eq!(read_reg_ticket(&ctx.svm, ctx.registry, 0), ctx.winner);
    assert_eq!(read_reg_ticket(&ctx.svm, ctx.registry, 1), ctx.winner);
}

// ═══ Edge Tests ═══

#[test]
fn test_reinvest_fails_wrong_winner() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, true, 1_000_000, 3_000_000);
    ctx.winner = Keypair::new().pubkey(); // different from registry entry
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("UnauthorizedTicket"), "got: {err}");
}

#[test]
fn test_reinvest_fails_already_paid() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, true, 1_000_000, 3_000_000);
    // Re-inject with paid_out=true
    inject_payout(&mut ctx.svm, 1, 0, vec![w(ctx.winner, 3_000_000, 0, 0, true)]);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("AlreadyClaimed"), "got: {err}");
}

#[test]
fn test_reinvest_fails_registry_full() {
    let mut ctx = setup_happy(2_000_000, 0, 1_000_000, true);
    // Re-inject registry at capacity
    inject_registry(&mut ctx.svm, ctx.registry, 1, 10, 10, 0);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("RegistryFull"), "got: {err}");
}

#[test]
fn test_reinvest_dust_only_no_bonds() {
    let mut ctx = setup_happy(500_000, 0, 1_000_000, true); // amount < bond_price
    send(&mut ctx, 0, 0, 10).expect("dust only");
    let pr = read_payout(&ctx.svm, 0);
    assert!(pr.winners[0].paid_out);
    assert_eq!(pr.winners[0].amount_reinvested, 0);
    let wa = ata_address(&ctx.winner, &ctx.token_mint);
    assert_eq!(read_bal(&ctx.svm, wa), 500_000);
}

#[test]
fn test_reinvest_dust_only_pool_paused() {
    let mut ctx = setup_happy(500_000, 0, 1_000_000, true);
    // Override pool to Paused
    inject_pool(&mut ctx.svm, 1, ctx.token_mint, ctx.registry, anchor::PoolStatus::Paused, false, true, 1_000_000);
    send(&mut ctx, 0, 0, 10).expect("dust-only should succeed even when paused");
    assert!(read_payout(&ctx.svm, 0).winners[0].paid_out);
}
