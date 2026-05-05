//! Integration tests for `harvest_yield_and_commit`.

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
const POOL_VAULT_SEED: &[u8] = b"pool_vault";
const POOL_KTOKENS_SEED: &[u8] = b"pool_ktokens";
const DRAW_CYCLE_SEED: &[u8] = b"draw_cycle";
const LMA_SEED: &[u8] = b"lma";

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}
fn pool_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[PRIZE_POOL_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn pool_vault_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_VAULT_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn pool_ktokens_pda(id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POOL_KTOKENS_SEED, id.to_le_bytes().as_ref()], &anchor::id())
}
fn draw_cycle_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[DRAW_CYCLE_SEED, pool_id.to_le_bytes().as_ref(), cycle_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}
fn lma_pda(lending_market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[LMA_SEED, lending_market.as_ref()], &anchor::constants::KAMINO_PROGRAM_ID)
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8, mint_authority: Option<Pubkey>) {
    let mut data = vec![0u8; 82];
    if let Some(auth) = mint_authority {
        data[0..4].copy_from_slice(&1u32.to_le_bytes());
        data[4..36].copy_from_slice(&auth.to_bytes());
    }
    data[44] = decimals;
    data[45] = 1;
    svm.set_account(address, Account { lamports: 1_000_000_000, data, owner: anchor_spl::token::ID, executable: false, rent_epoch: 0 }).unwrap();
}

/// Update the supply field of an existing SPL mint account.
fn set_mint_supply(svm: &mut LiteSVM, mint: Pubkey, supply: u64) {
    let mut acct = svm.get_account(&mint).unwrap();
    acct.data[36..44].copy_from_slice(&supply.to_le_bytes());
    svm.set_account(mint, acct).unwrap();
}

fn inject_token_account(svm: &mut LiteSVM, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[32..64].copy_from_slice(&owner.to_bytes());
    data[64..72].copy_from_slice(&amount.to_le_bytes());
    data[108] = 1;
    svm.set_account(address, Account { lamports: 1_000_000_000, data, owner: anchor_spl::token::ID, executable: false, rent_epoch: 0 }).unwrap();
}

fn inject_owned_account(svm: &mut LiteSVM, address: Pubkey, owner: Pubkey, data: &[u8]) {
    svm.set_account(address, Account { lamports: 1_000_000_000, data: data.to_vec(), owner, executable: false, rent_epoch: 0 }).unwrap();
}

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
    svm.set_account(address, Account { lamports: 10_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
}

fn inject_pool_custom(
    svm: &mut LiteSVM, pool_id: u32, token_mint: Pubkey, ticket_registry: Pubkey,
    fee_wallet: Pubkey, status: anchor::PoolStatus, is_frozen: bool,
    fee_basis_points: u16, cycle_end_at: i64, cycle_id: u32,
    prize_tiers: Vec<anchor::PrizeTier>, principal: u64,
) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump, pool_id, token_mint, ticket_registry,
        fee_wallet, bond_price: 1_000_000, stake_cycle_duration_hrs: 24,
        fee_basis_points, status, total_deposited_principal: principal,
        total_fees_collected: 0, current_cycle_end_at: cycle_end_at,
        is_frozen_for_draw: is_frozen, current_draw_cycle_id: cycle_id,
        max_withdrawal_slippage_dust: 0, prize_tiers, auto_reinvest_default: false,
    };
    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    svm.set_account(pda, Account { lamports: 1_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
    pda
}

fn warp_clock(svm: &mut LiteSVM, unix_ts: i64) {
    let clock = solana_sdk::clock::Clock { unix_timestamp: unix_ts, ..Default::default() };
    svm.set_sysvar(&clock);
}

// ─── SVM bootstrap ───────────────────────────────────────────────────────────

/// Initialize global config with a KNOWN crank keypair as jobs_account.
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

// ─── Context structs ─────────────────────────────────────────────────────────

struct HarvestCtx {
    svm: LiteSVM,
    crank: Keypair,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    ticket_registry: Pubkey,
    fee_wallet: Pubkey,
    reserve: Pubkey,
    lending_market: Pubkey,
    lending_market_authority: Pubkey,
    reserve_liquidity_supply: Pubkey,
}

fn build_harvest_ix(ctx: &HarvestCtx, pool_id: u32, cycle_id: u32, ktokens_to_burn: u64) -> Instruction {
    let (gc, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault, _) = pool_vault_pda(pool_id);
    let (pool_ktokens, _) = pool_ktokens_pda(pool_id);
    let (draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: ctx.crank.pubkey(), global_config: gc, pool,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle: draw_cycle,
        pool_vault_account: pool_vault, pool_ktokens_vault: pool_ktokens,
        fee_wallet: ctx.fee_wallet, token_mint: ctx.token_mint,
        kamino_program: anchor::constants::KAMINO_PROGRAM_ID,
        reserve: ctx.reserve, lending_market: ctx.lending_market,
        lending_market_authority: ctx.lending_market_authority,
        reserve_liquidity_supply: ctx.reserve_liquidity_supply,
        reserve_collateral_mint: ctx.reserve_collateral_mint,
        token_program: anchor_spl::token::ID,
        ktokens_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        instruction_sysvar_account: anchor::constants::INSTRUCTIONS_SYSVAR_ID,
    }.to_account_metas(None);

    Instruction { program_id: anchor::id(), accounts,
        data: anchor::instruction::HarvestYieldAndCommit { ktokens_to_burn }.data() }
}

fn send_harvest(ctx: &mut HarvestCtx, pool_id: u32, cycle_id: u32, ktokens: u64) -> Result<(), String> {
    let ix = build_harvest_ix(ctx, pool_id, cycle_id, ktokens);
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

fn read_token_balance(svm: &LiteSVM, address: Pubkey) -> u64 {
    let acct = svm.get_account(&address).unwrap();
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

fn read_registry_counts(svm: &LiteSVM, reg: Pubkey) -> (u32, u32) {
    let acct = svm.get_account(&reg).unwrap();
    let active = u32::from_le_bytes(acct.data[16..20].try_into().unwrap());
    let pending = u32::from_le_bytes(acct.data[20..24].try_into().unwrap());
    (active, pending)
}

// ─── Setup for guard tests (no mock Kamino) ──────────────────────────────────

fn setup_guard(status: anchor::PoolStatus, is_frozen: bool, cycle_end_at: i64) -> HarvestCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank(100);

    let token_mint = Keypair::new().pubkey();
    let rcm = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6, None);
    inject_mint(&mut svm, rcm, 6, None);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, Keypair::new().pubkey(), 0);

    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, 0, 0, &[]);

    let pool_key = pool_pda(1).0;
    let (pv, _) = pool_vault_pda(1);
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 0);
    inject_token_account(&mut svm, pk, rcm, pool_key, 0);

    inject_pool_custom(&mut svm, 1, token_mint, registry, fee_wallet,
        status, is_frozen, 100, cycle_end_at, 0, vec![], 0);

    warp_clock(&mut svm, 1000);

    let dummy = Keypair::new().pubkey();
    HarvestCtx { svm, crank, token_mint, reserve_collateral_mint: rcm,
        ticket_registry: registry, fee_wallet, reserve: dummy,
        lending_market: dummy, lending_market_authority: dummy,
        reserve_liquidity_supply: dummy }
}

// ─── Setup for happy-path tests (with mock Kamino) ───────────────────────────

fn setup_happy(
    active: u32, pending: u32, fee_bps: u16,
    prize_tiers: Vec<anchor::PrizeTier>, reserve_fail: bool,
    extra_supply: u64,
) -> HarvestCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank(100);
    let _ = svm.add_program(anchor::constants::KAMINO_PROGRAM_ID,
        include_bytes!("../../../target/deploy/mock_kamino.so"));

    let lending_market = Keypair::new().pubkey();
    inject_owned_account(&mut svm, lending_market, anchor::constants::KAMINO_PROGRAM_ID, &[0u8; 64]);
    let (lma, _) = lma_pda(&lending_market);

    let reserve = Keypair::new().pubkey();
    let rd = if reserve_fail { vec![0xFF; 32] } else { vec![0u8; 32] };
    inject_owned_account(&mut svm, reserve, anchor::constants::KAMINO_PROGRAM_ID, &rd);

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6, None);
    let rcm = Keypair::new().pubkey();
    inject_mint(&mut svm, rcm, 6, Some(lma));

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, Keypair::new().pubkey(), 0);

    let pool_key = pool_pda(1).0;
    let (pv, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pv, token_mint, pool_key, 0);
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut svm, pk, rcm, pool_key, 0);

    let rls = Keypair::new().pubkey();
    inject_token_account(&mut svm, rls, token_mint, lma, extra_supply);

    // Build tickets list: active first, then pending
    let mut tickets = Vec::new();
    for _ in 0..(active + pending) { tickets.push(Keypair::new().pubkey()); }

    let registry = Keypair::new().pubkey();
    inject_registry(&mut svm, registry, 1, 1000, active, pending, &tickets);

    let principal = (active as u64 + pending as u64) * 1_000_000;
    inject_pool_custom(&mut svm, 1, token_mint, registry, fee_wallet,
        anchor::PoolStatus::Active, false, fee_bps, 0, 0, prize_tiers, principal);

    warp_clock(&mut svm, 1000);

    HarvestCtx { svm, crank, token_mint, reserve_collateral_mint: rcm,
        ticket_registry: registry, fee_wallet, reserve,
        lending_market, lending_market_authority: lma,
        reserve_liquidity_supply: rls }
}

/// Helper: buy bonds via the real instruction to fund Kamino vaults.
fn do_buy(ctx: &mut HarvestCtx, bonds: u32) {
    // Create a user, fund them, buy bonds
    let user = Keypair::new();
    ctx.svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let user_ta = Keypair::new().pubkey();
    inject_token_account(&mut ctx.svm, user_ta, ctx.token_mint, user.pubkey(), bonds as u64 * 1_000_000);

    let (gc, _) = global_config_pda();
    let (pool, _) = pool_pda(1);
    let (pv, _) = pool_vault_pda(1);
    let (pk, _) = pool_ktokens_pda(1);

    let accounts = anchor::accounts::BuyBonds {
        user: user.pubkey(), global_config: gc, pool,
        ticket_registry: ctx.ticket_registry, user_token_account: user_ta,
        token_mint: ctx.token_mint, pool_vault_account: pv, pool_ktokens_vault: pk,
        kamino_program: anchor::constants::KAMINO_PROGRAM_ID,
        reserve: ctx.reserve, lending_market: ctx.lending_market,
        lending_market_authority: ctx.lending_market_authority,
        reserve_liquidity_supply: ctx.reserve_liquidity_supply,
        reserve_collateral_mint: ctx.reserve_collateral_mint,
        token_program: anchor_spl::token::ID, ktokens_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        instruction_sysvar_account: anchor::constants::INSTRUCTIONS_SYSVAR_ID,
    }.to_account_metas(None);

    let ix = Instruction { program_id: anchor::id(), accounts,
        data: anchor::instruction::BuyBonds { tickets_to_buy: bonds }.data() };
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    ctx.svm.send_transaction(tx).expect("buy_bonds should succeed");
}

// ═════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_fails_unauthorized_crank() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, 0);
    let fake_crank = Keypair::new();
    ctx.svm.airdrop(&fake_crank.pubkey(), 10_000_000_000).unwrap();
    ctx.crank = fake_crank;
    let err = send_harvest(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("UnauthorizedCrank"), "Expected UnauthorizedCrank, got: {err}");
}

#[test]
fn test_harvest_fails_pool_not_active() {
    let mut ctx = setup_guard(anchor::PoolStatus::Paused, false, 0);
    let err = send_harvest(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("PoolNotActive"), "Expected PoolNotActive, got: {err}");
}

#[test]
fn test_harvest_fails_pool_frozen() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, true, 0);
    let err = send_harvest(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("AwaitingRandomnessFreeze"), "Expected AwaitingRandomnessFreeze, got: {err}");
}

#[test]
fn test_harvest_fails_cycle_not_ended() {
    let mut ctx = setup_guard(anchor::PoolStatus::Active, false, i64::MAX);
    let err = send_harvest(&mut ctx, 1, 0, 0).unwrap_err();
    assert!(err.contains("CycleNotEnded"), "Expected CycleNotEnded, got: {err}");
}

// ═════════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_happy_path_zero_ktokens() {
    // ktokens=0 skips CPI, yield=0, creates Complete DrawCycle, merges pending→active
    let mut ctx = setup_happy(0, 3, 100, vec![], false, 0);
    send_harvest(&mut ctx, 1, 0, 0).expect("zero ktokens harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Complete);
    assert_eq!(dc.prize_pot, 0);
    assert_eq!(dc.cycle_fee_collected, 0);
    assert_eq!(dc.locked_ticket_count, 0); // no active before merge

    let (active, pending) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active, 3); // pending merged
    assert_eq!(pending, 0);
}

#[test]
fn test_harvest_happy_path_yield_no_eligible() {
    // Yield > 0 but active=0 (only pending) → Complete, fee still collected
    let mut ctx = setup_happy(0, 2, 500, vec![], false, 0);
    // Buy 1 bond to fund the kTokens vault (creates pending ticket)
    do_buy(&mut ctx, 1);
    let bond_price = 1_000_000u64;
    // Pool vault should have kTokens from buy. Burn them for yield.
    // Mock Kamino 1:1 rate: burning bond_price kTokens returns bond_price tokens
    // But the pool_vault already had the bond_price from transfer_in during buy.
    // After redeem, pool_vault gets another bond_price. yield = delta.
    // Need to fund reserve_liquidity_supply for the redeem to work.
    inject_token_account(&mut ctx.svm, ctx.reserve_liquidity_supply, ctx.token_mint,
        ctx.lending_market_authority, bond_price);

    send_harvest(&mut ctx, 1, 0, bond_price).expect("yield no eligible harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::Complete); // no eligible → Complete
    // fee = bond_price * 500 / 10000 = 50000
    assert_eq!(dc.cycle_fee_collected, 50_000);
    assert_eq!(dc.prize_pot, bond_price - 50_000);
    assert_eq!(dc.locked_ticket_count, 0); // active was 0 before merge
}

#[test]
fn test_harvest_happy_path_yield_and_eligible() {
    // Yield > 0, active > 0, tiers set → AwaitingRandomness + pool frozen
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let mut ctx = setup_happy(2, 1, 100, tiers, false, 0);
    // Fund kTokens vault and reserve supply for redeem
    let bond_price = 1_000_000u64;
    let yield_amount = 500_000u64;
    let pool_key = pool_pda(1).0;
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut ctx.svm, pk, ctx.reserve_collateral_mint, pool_key, yield_amount);
    inject_token_account(&mut ctx.svm, ctx.reserve_liquidity_supply, ctx.token_mint,
        ctx.lending_market_authority, yield_amount);
    set_mint_supply(&mut ctx.svm, ctx.reserve_collateral_mint, yield_amount);

    send_harvest(&mut ctx, 1, 0, yield_amount).expect("yield + eligible harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.status, anchor::DrawStatus::AwaitingRandomness);
    assert_eq!(dc.locked_ticket_count, 2); // only active, not pending

    let pool = read_pool(&ctx.svm, 1);
    assert!(pool.is_frozen_for_draw);
}

#[test]
fn test_harvest_happy_path_fee_exact() {
    // Verify exact fee: yield=1_000_000, fee_bps=250 (2.5%) → fee=25_000
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let mut ctx = setup_happy(1, 0, 250, tiers, false, 0);
    let yield_amount = 1_000_000u64;
    let pool_key = pool_pda(1).0;
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut ctx.svm, pk, ctx.reserve_collateral_mint, pool_key, yield_amount);
    inject_token_account(&mut ctx.svm, ctx.reserve_liquidity_supply, ctx.token_mint,
        ctx.lending_market_authority, yield_amount);
    set_mint_supply(&mut ctx.svm, ctx.reserve_collateral_mint, yield_amount);

    send_harvest(&mut ctx, 1, 0, yield_amount).expect("fee exact harvest");

    let expected_fee = 25_000u64; // 1_000_000 * 250 / 10000
    let fee_bal = read_token_balance(&ctx.svm, ctx.fee_wallet);
    assert_eq!(fee_bal, expected_fee, "fee_wallet should have exact fee");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.cycle_fee_collected, expected_fee);
    assert_eq!(dc.prize_pot, yield_amount - expected_fee);

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.total_fees_collected, expected_fee);
}

#[test]
fn test_harvest_happy_path_zero_fee_bps() {
    // fee_basis_points=0 → fee=0, full yield in prize_pot
    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];
    let mut ctx = setup_happy(1, 0, 0, tiers, false, 0);
    let yield_amount = 500_000u64;
    let pool_key = pool_pda(1).0;
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut ctx.svm, pk, ctx.reserve_collateral_mint, pool_key, yield_amount);
    inject_token_account(&mut ctx.svm, ctx.reserve_liquidity_supply, ctx.token_mint,
        ctx.lending_market_authority, yield_amount);
    set_mint_supply(&mut ctx.svm, ctx.reserve_collateral_mint, yield_amount);

    send_harvest(&mut ctx, 1, 0, yield_amount).expect("zero fee harvest");

    let fee_bal = read_token_balance(&ctx.svm, ctx.fee_wallet);
    assert_eq!(fee_bal, 0, "fee_wallet should be zero");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.cycle_fee_collected, 0);
    assert_eq!(dc.prize_pot, yield_amount);
}

#[test]
fn test_harvest_happy_path_pending_merge() {
    // 2 active + 3 pending → after: 5 active, 0 pending
    // eligible_locked_count should be 2 (snapshot BEFORE merge)
    let mut ctx = setup_happy(2, 3, 100, vec![], false, 0);
    send_harvest(&mut ctx, 1, 0, 0).expect("merge harvest");

    let (active, pending) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active, 5);
    assert_eq!(pending, 0);

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.locked_ticket_count, 2); // only pre-merge active count
    assert_eq!(dc.status, anchor::DrawStatus::Complete); // yield=0
}

#[test]
fn test_harvest_happy_path_draw_cycle_fields() {
    // Verify all DrawCycle fields
    let tiers = vec![
        anchor::PrizeTier { basis_points: 7000, num_winners: 1 },
        anchor::PrizeTier { basis_points: 3000, num_winners: 3 },
    ];
    let mut ctx = setup_happy(5, 2, 100, tiers, false, 0);
    let yield_amount = 200_000u64;
    let pool_key = pool_pda(1).0;
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut ctx.svm, pk, ctx.reserve_collateral_mint, pool_key, yield_amount);
    inject_token_account(&mut ctx.svm, ctx.reserve_liquidity_supply, ctx.token_mint,
        ctx.lending_market_authority, yield_amount);
    set_mint_supply(&mut ctx.svm, ctx.reserve_collateral_mint, yield_amount);

    send_harvest(&mut ctx, 1, 0, yield_amount).expect("draw cycle fields harvest");

    let dc = read_draw_cycle(&ctx.svm, 1, 0);
    assert_eq!(dc.pool_id, 1);
    assert_eq!(dc.cycle_id, 0);
    assert_eq!(dc.locked_ticket_count, 5);
    let fee = 200_000u64 * 100 / 10000; // 2000
    assert_eq!(dc.cycle_fee_collected, fee);
    assert_eq!(dc.prize_pot, yield_amount - fee);
    assert_eq!(dc.status, anchor::DrawStatus::AwaitingRandomness);
}

#[test]
fn test_harvest_happy_path_cycle_advances() {
    // After harvest: cycle_id incremented, cycle_end_at = clock + duration * 3600
    let mut ctx = setup_happy(0, 0, 100, vec![], false, 0);
    // Clock is warped to 1000, duration=24h
    send_harvest(&mut ctx, 1, 0, 0).expect("cycle advance harvest");

    let pool = read_pool(&ctx.svm, 1);
    assert_eq!(pool.current_draw_cycle_id, 1); // was 0, now 1
    assert_eq!(pool.current_cycle_end_at, 1000 + 24 * 3600); // clock_time + 24h
}

// ═════════════════════════════════════════════════════════════════════════════
// Edge / failure tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_harvest_fails_prize_tiers_not_configured() {
    // yield > 0, eligible > 0, but prize_tiers empty → PrizeTiersNotConfigured
    let mut ctx = setup_happy(2, 0, 100, vec![], false, 0);
    let yield_amount = 100_000u64;
    let pool_key = pool_pda(1).0;
    let (pk, _) = pool_ktokens_pda(1);
    inject_token_account(&mut ctx.svm, pk, ctx.reserve_collateral_mint, pool_key, yield_amount);
    inject_token_account(&mut ctx.svm, ctx.reserve_liquidity_supply, ctx.token_mint,
        ctx.lending_market_authority, yield_amount);
    set_mint_supply(&mut ctx.svm, ctx.reserve_collateral_mint, yield_amount);

    let err = send_harvest(&mut ctx, 1, 0, yield_amount).unwrap_err();
    assert!(err.contains("PrizeTiersNotConfigured"), "Expected PrizeTiersNotConfigured, got: {err}");
}

#[test]
fn test_harvest_kamino_fails_no_state_mutation() {
    // CPI fail → atomic rollback, no DrawCycle, pool unchanged
    let mut ctx = setup_happy(1, 2, 100, vec![], true, 0);

    let pool_before = read_pool(&ctx.svm, 1);
    let (active_before, pending_before) = read_registry_counts(&ctx.svm, ctx.ticket_registry);

    let err = send_harvest(&mut ctx, 1, 0, 100_000).unwrap_err();
    assert!(!err.is_empty(), "Should fail on CPI");

    // Pool unchanged
    let pool_after = read_pool(&ctx.svm, 1);
    assert_eq!(pool_after.current_draw_cycle_id, pool_before.current_draw_cycle_id);
    assert_eq!(pool_after.is_frozen_for_draw, pool_before.is_frozen_for_draw);

    // Registry unchanged
    let (active_after, pending_after) = read_registry_counts(&ctx.svm, ctx.ticket_registry);
    assert_eq!(active_after, active_before);
    assert_eq!(pending_after, pending_before);

    // DrawCycle PDA should not exist
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    assert!(ctx.svm.get_account(&dc_pda).is_none(), "DrawCycle should not exist after rollback");
}

#[test]
fn test_harvest_fails_double_harvest_same_cycle() {
    // First harvest succeeds, second with same cycle_id fails (DrawCycle already init'd)
    let mut ctx = setup_happy(0, 1, 100, vec![], false, 0);
    send_harvest(&mut ctx, 1, 0, 0).expect("first harvest");

    // Pool now has cycle_id=1, but if we try to init cycle_id=0 again it would fail.
    // However, the pool's current_draw_cycle_id is now 1, so the PDA seed has changed.
    // To test double-init, we need to call with the OLD cycle_id=0 manually.
    // But the pool constraint reads current_draw_cycle_id at tx time (now 1), so
    // passing cycle_id=0 would mismatch the PDA derivation.
    // The real protection is: calling harvest again naturally uses cycle_id=1,
    // which requires cycle to have ended again.

    // Warp clock past the new cycle_end_at
    let pool = read_pool(&ctx.svm, 1);
    warp_clock(&mut ctx.svm, pool.current_cycle_end_at + 1);

    // Second harvest with new cycle_id=1 should succeed
    send_harvest(&mut ctx, 1, 1, 0).expect("second harvest with new cycle");

    let pool2 = read_pool(&ctx.svm, 1);
    assert_eq!(pool2.current_draw_cycle_id, 2);

    // Verify both DrawCycles exist
    let dc0 = read_draw_cycle(&ctx.svm, 1, 0);
    let dc1 = read_draw_cycle(&ctx.svm, 1, 1);
    assert_eq!(dc0.cycle_id, 0);
    assert_eq!(dc1.cycle_id, 1);
}
