//! Integration tests for `sell_bonds`.

use anchor_lang::{AccountSerialize, InstructionData, Space, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    account::Account,
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

// ─── Seed mirrors ────────────────────────────────────────────────────────────

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PRIZE_POOL_SEED: &[u8] = b"prize_pool";
const POOL_VAULT_SEED: &[u8] = b"pool_vault";
const POOL_KTOKENS_SEED: &[u8] = b"pool_ktokens";
const LMA_SEED: &[u8] = b"lma";

// ─── PDA helpers ─────────────────────────────────────────────────────────────

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn pool_vault_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_VAULT_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn pool_ktokens_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[POOL_KTOKENS_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

fn lending_market_authority_pda(lending_market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[LMA_SEED, lending_market.as_ref()],
        &anchor::constants::KAMINO_PROGRAM_ID,
    )
}

/// Compute the Associated Token Account address.
fn ata_address(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            wallet.as_ref(),
            anchor_spl::token::ID.as_ref(),
            mint.as_ref(),
        ],
        &anchor_spl::associated_token::ID,
    )
    .0
}

// ─── SVM bootstrap ───────────────────────────────────────────────────────────

fn setup_global_config(max_tickets_per_buy: u32) -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    let _ = svm.add_program(anchor::id(), program_bytes);

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account: Keypair::new().pubkey(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal { max_tickets_per_buy }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("initialize_global should succeed");

    (svm, admin)
}

// ─── Account injection helpers ───────────────────────────────────────────────

fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
    max_withdrawal_slippage_dust: u64,
) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint,
        ticket_registry,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        current_cycle_end_at: i64::MAX,
        is_frozen_for_draw: is_frozen,
        current_draw_cycle_id: 0,
        max_withdrawal_slippage_dust,
        prize_tiers: vec![],
        auto_reinvest_default: false,
    };
    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
    svm.set_account(pda, Account { lamports: 1_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
    pda
}

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

/// Inject a registry with specific ticket pubkeys written at slot positions.
/// `tickets` is a flat list: first `active` entries go into active slots,
/// remaining `pending` entries go into pending slots.
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
    data[16..20].copy_from_slice(&active.to_le_bytes());
    data[20..24].copy_from_slice(&pending.to_le_bytes());
    for (i, pk) in tickets.iter().enumerate() {
        let start = 24 + i * 32;
        data[start..start + 32].copy_from_slice(pk.as_ref());
    }
    svm.set_account(address, Account { lamports: 10_000_000_000, data, owner: anchor::id(), executable: false, rent_epoch: 0 }).unwrap();
}

// ─── Instruction builders ────────────────────────────────────────────────────

fn build_sell_bonds_ix(
    user: Pubkey,
    pool_id: u32,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
    reserve: Pubkey,
    lending_market: Pubkey,
    lending_market_authority: Pubkey,
    reserve_liquidity_supply: Pubkey,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
    ktokens_to_burn: u64,
) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault_account, _) = pool_vault_pda(pool_id);
    let (pool_ktokens_vault, _) = pool_ktokens_pda(pool_id);

    let accounts = anchor::accounts::SellBonds {
        user,
        pool,
        ticket_registry,
        user_token_account,
        token_mint,
        pool_vault_account,
        pool_ktokens_vault,
        kamino_program: anchor::constants::KAMINO_PROGRAM_ID,
        reserve,
        lending_market,
        lending_market_authority,
        reserve_liquidity_supply,
        reserve_collateral_mint,
        token_program: anchor_spl::token::ID,
        ktokens_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        instruction_sysvar_account: anchor::constants::INSTRUCTIONS_SYSVAR_ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SellBonds {
            active_indices,
            pending_indices,
            ktokens_to_burn,
        }
        .data(),
    }
}

// ─── Readers ─────────────────────────────────────────────────────────────────

fn read_token_balance(svm: &LiteSVM, address: Pubkey) -> u64 {
    let acct = svm.get_account(&address).expect("account must exist");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

fn read_pool_principal(svm: &LiteSVM, pool_id: u32) -> u64 {
    let (pda, _) = pool_pda(pool_id);
    let acct = svm.get_account(&pda).expect("pool must exist");
    let pool: anchor::PrizePool =
        anchor_lang::AccountDeserialize::try_deserialize(&mut acct.data.as_slice()).unwrap();
    pool.total_deposited_principal
}

fn read_registry_pending(svm: &LiteSVM, registry: Pubkey) -> u32 {
    let acct = svm.get_account(&registry).expect("registry must exist");
    u32::from_le_bytes(acct.data[20..24].try_into().unwrap())
}

fn read_registry_active(svm: &LiteSVM, registry: Pubkey) -> u32 {
    let acct = svm.get_account(&registry).expect("registry must exist");
    u32::from_le_bytes(acct.data[16..20].try_into().unwrap())
}

// ─── Guard test setup (no mock Kamino needed) ────────────────────────────────

struct GuardCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
}

fn setup_guard(
    is_frozen: bool,
    active: u32,
    pending: u32,
    tickets: &[Pubkey],
    user_pk: Option<Pubkey>,
) -> GuardCtx {
    let (mut svm, _admin) = setup_global_config(100);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let reserve_collateral_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6, None);
    inject_mint(&mut svm, reserve_collateral_mint, 6, None);

    // User ATA
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 0);

    let ticket_registry = Keypair::new().pubkey();
    inject_registry(&mut svm, ticket_registry, 1, 1000, active, pending, tickets);

    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_ktokens, _) = pool_ktokens_pda(1);
    let pool_key = pool_pda(1).0;
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 0);
    inject_token_account(&mut svm, pool_ktokens, reserve_collateral_mint, pool_key, 0);

    let _ = user_pk; // reserved for future use
    inject_pool(&mut svm, 1, token_mint, ticket_registry, anchor::PoolStatus::Active, is_frozen, 0);

    GuardCtx { svm, user, token_mint, reserve_collateral_mint, user_token_account: user_ata, ticket_registry }
}

fn send_sell_guard(ctx: &mut GuardCtx, active_indices: Vec<u32>, pending_indices: Vec<u32>, ktokens: u64) -> Result<(), String> {
    let dummy = Keypair::new().pubkey();
    let ix = build_sell_bonds_ix(
        ctx.user.pubkey(), 1, ctx.token_mint, ctx.reserve_collateral_mint,
        ctx.user_token_account, ctx.ticket_registry,
        dummy, dummy, dummy, dummy,
        active_indices, pending_indices, ktokens,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Guard tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_sell_bonds_fails_pool_frozen() {
    let user_pk = Keypair::new().pubkey();
    let mut ctx = setup_guard(true, 1, 0, &[user_pk], None);
    // Override user for ticket ownership — use a user whose ticket is in the registry
    // But the frozen guard fires first, so ownership doesn't matter here
    let err = send_sell_guard(&mut ctx, vec![0], vec![], 1_000_000).unwrap_err();
    assert!(err.contains("AwaitingRandomnessFreeze"), "Expected AwaitingRandomnessFreeze, got: {err}");
}

#[test]
fn test_sell_bonds_fails_zero_quantity() {
    let mut ctx = setup_guard(false, 0, 0, &[], None);
    let err = send_sell_guard(&mut ctx, vec![], vec![], 0).unwrap_err();
    assert!(err.contains("InvalidBondQuantity"), "Expected InvalidBondQuantity, got: {err}");
}

#[test]
fn test_sell_bonds_fails_unauthorized_pending_ticket() {
    let other = Pubkey::new_unique();
    let mut ctx = setup_guard(false, 0, 1, &[other], None);
    let err = send_sell_guard(&mut ctx, vec![], vec![0], 1_000_000).unwrap_err();
    assert!(err.contains("UnauthorizedTicket"), "Expected UnauthorizedTicket, got: {err}");
}

#[test]
fn test_sell_bonds_fails_unauthorized_active_ticket() {
    let other = Pubkey::new_unique();
    let mut ctx = setup_guard(false, 1, 0, &[other], None);
    let err = send_sell_guard(&mut ctx, vec![0], vec![], 1_000_000).unwrap_err();
    assert!(err.contains("UnauthorizedTicket"), "Expected UnauthorizedTicket, got: {err}");
}

#[test]
fn test_sell_bonds_fails_invalid_pending_indices_not_descending() {
    let mut ctx = setup_guard(false, 0, 3, &[], None);
    // Write user's pubkey at all 3 pending slots
    {
        let pk = ctx.user.pubkey();
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        for i in 0..3 { let s = 24 + i * 32; data[s..s+32].copy_from_slice(pk.as_ref()); }
        ctx.svm.set_account(ctx.ticket_registry, Account { data, ..acct }).unwrap();
    }
    // Indices must be strictly descending; ascending [0, 1] should fail
    let err = send_sell_guard(&mut ctx, vec![], vec![0, 1], 2_000_000).unwrap_err();
    assert!(err.contains("InvalidIndices"), "Expected InvalidIndices, got: {err}");
}

#[test]
fn test_sell_bonds_fails_invalid_active_indices_not_descending() {
    let mut ctx = setup_guard(false, 3, 0, &[], None);
    {
        let pk = ctx.user.pubkey();
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        for i in 0..3 { let s = 24 + i * 32; data[s..s+32].copy_from_slice(pk.as_ref()); }
        ctx.svm.set_account(ctx.ticket_registry, Account { data, ..acct }).unwrap();
    }
    let err = send_sell_guard(&mut ctx, vec![0, 1], vec![], 2_000_000).unwrap_err();
    assert!(err.contains("InvalidIndices"), "Expected InvalidIndices, got: {err}");
}

#[test]
fn test_sell_bonds_fails_wrong_ticket_registry() {
    let mut ctx = setup_guard(false, 1, 0, &[Pubkey::new_unique()], None);
    let wrong_registry = Keypair::new().pubkey();
    inject_registry(&mut ctx.svm, wrong_registry, 1, 1000, 0, 0, &[]);
    let dummy = Keypair::new().pubkey();
    let ix = build_sell_bonds_ix(
        ctx.user.pubkey(), 1, ctx.token_mint, ctx.reserve_collateral_mint,
        ctx.user_token_account, wrong_registry,
        dummy, dummy, dummy, dummy,
        vec![0], vec![], 1_000_000,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let err = ctx.svm.send_transaction(tx).map_err(|e| format!("{e:?}")).unwrap_err();
    assert!(!err.contains("AwaitingRandomnessFreeze") && !err.contains("InvalidBondQuantity"),
        "Should be constraint error, got: {err}");
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-path setup (mock Kamino + buy_bonds pre-population)
// ═══════════════════════════════════════════════════════════════════════════════

struct HappyCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
    reserve: Pubkey,
    lending_market: Pubkey,
    lending_market_authority: Pubkey,
    reserve_liquidity_supply: Pubkey,
}

/// Build a `BuyBonds` instruction with real Kamino accounts.
fn build_buy_bonds_ix(ctx: &HappyCtx, bonds: u32) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_ktokens, _) = pool_ktokens_pda(1);

    // buy_bonds uses token::authority (not ATA), so we can pass any token account
    // But here user_token_account is the ATA, which also satisfies token::authority
    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        global_config,
        pool,
        ticket_registry: ctx.ticket_registry,
        user_token_account: ctx.user_token_account,
        token_mint: ctx.token_mint,
        pool_vault_account: pool_vault,
        pool_ktokens_vault: pool_ktokens,
        kamino_program: anchor::constants::KAMINO_PROGRAM_ID,
        reserve: ctx.reserve,
        lending_market: ctx.lending_market,
        lending_market_authority: ctx.lending_market_authority,
        reserve_liquidity_supply: ctx.reserve_liquidity_supply,
        reserve_collateral_mint: ctx.reserve_collateral_mint,
        token_program: anchor_spl::token::ID,
        ktokens_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        instruction_sysvar_account: anchor::constants::INSTRUCTIONS_SYSVAR_ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds { tickets_to_buy: bonds }.data(),
    }
}

fn setup_happy(
    registry_capacity: u32,
    max_withdrawal_slippage_dust: u64,
    reserve_fail_mode: bool,
    pool_status: anchor::PoolStatus,
) -> HappyCtx {
    let (mut svm, _admin) = setup_global_config(100);

    let mock_bytes = include_bytes!("../../../target/deploy/mock_kamino.so");
    let _ = svm.add_program(anchor::constants::KAMINO_PROGRAM_ID, mock_bytes);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    // Kamino infrastructure
    let lending_market = Keypair::new().pubkey();
    inject_owned_account(&mut svm, lending_market, anchor::constants::KAMINO_PROGRAM_ID, &[0u8; 64]);

    let (lending_market_authority, _) = lending_market_authority_pda(&lending_market);

    let reserve = Keypair::new().pubkey();
    let reserve_data = if reserve_fail_mode { vec![0xFF; 32] } else { vec![0u8; 32] };
    inject_owned_account(&mut svm, reserve, anchor::constants::KAMINO_PROGRAM_ID, &reserve_data);

    // Token mints
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6, None);

    let reserve_collateral_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, reserve_collateral_mint, 6, Some(lending_market_authority));

    // Token accounts — user ATA
    let user_ata = ata_address(&user.pubkey(), &token_mint);
    inject_token_account(&mut svm, user_ata, token_mint, user.pubkey(), 100_000_000);

    let pool_key = pool_pda(1).0;
    let (pool_vault, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 0);

    let (pool_ktokens, _) = pool_ktokens_pda(1);
    inject_token_account(&mut svm, pool_ktokens, reserve_collateral_mint, pool_key, 0);

    let reserve_liquidity_supply = Keypair::new().pubkey();
    inject_token_account(&mut svm, reserve_liquidity_supply, token_mint, lending_market_authority, 0);

    let ticket_registry = Keypair::new().pubkey();
    inject_registry(&mut svm, ticket_registry, 1, registry_capacity, 0, 0, &[]);

    inject_pool(&mut svm, 1, token_mint, ticket_registry, pool_status, false, max_withdrawal_slippage_dust);

    HappyCtx {
        svm, user, token_mint, reserve_collateral_mint,
        user_token_account: user_ata, ticket_registry,
        reserve, lending_market, lending_market_authority, reserve_liquidity_supply,
    }
}

/// Execute buy_bonds to pre-populate registry.
fn do_buy(ctx: &mut HappyCtx, bonds: u32) {
    let ix = build_buy_bonds_ix(ctx, bonds);
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm.send_transaction(tx).expect("buy_bonds should succeed");
}

fn send_sell(
    ctx: &mut HappyCtx,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
    ktokens_to_burn: u64,
) -> Result<(), String> {
    let ix = build_sell_bonds_ix(
        ctx.user.pubkey(), 1, ctx.token_mint, ctx.reserve_collateral_mint,
        ctx.user_token_account, ctx.ticket_registry,
        ctx.reserve, ctx.lending_market, ctx.lending_market_authority, ctx.reserve_liquidity_supply,
        active_indices, pending_indices, ktokens_to_burn,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_sell_bonds_happy_path_sell_pending_only() {
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    // Buy 1 bond (creates 1 pending ticket)
    do_buy(&mut ctx, 1);
    let user_bal_after_buy = read_token_balance(&ctx.svm, ctx.user_token_account);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 1);

    // Sell the pending ticket (index 0)
    send_sell(&mut ctx, vec![], vec![0], bond_price).expect("sell should succeed");

    // User got principal back
    assert_eq!(read_token_balance(&ctx.svm, ctx.user_token_account), user_bal_after_buy + bond_price);
    // Pool principal back to 0
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
    // Registry cleared
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 0);
}

#[test]
fn test_sell_bonds_happy_path_sell_active_only() {
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    // Buy 1 bond then manually promote it to active by updating registry counts
    do_buy(&mut ctx, 1);
    {
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        // Change: active=1, pending=0 (promote the pending ticket)
        data[16..20].copy_from_slice(&1u32.to_le_bytes());
        data[20..24].copy_from_slice(&0u32.to_le_bytes());
        ctx.svm.set_account(ctx.ticket_registry, Account { data, ..acct }).unwrap();
    }
    let user_bal = read_token_balance(&ctx.svm, ctx.user_token_account);

    send_sell(&mut ctx, vec![0], vec![], bond_price).expect("sell should succeed");

    assert_eq!(read_token_balance(&ctx.svm, ctx.user_token_account), user_bal + bond_price);
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
    assert_eq!(read_registry_active(&ctx.svm, ctx.ticket_registry), 0);
}

#[test]
fn test_sell_bonds_happy_path_sell_mixed() {
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    // Buy 3 bonds → 3 pending
    do_buy(&mut ctx, 3);
    // Promote 1 to active: active=1, pending=2
    {
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        data[16..20].copy_from_slice(&1u32.to_le_bytes());
        data[20..24].copy_from_slice(&2u32.to_le_bytes());
        ctx.svm.set_account(ctx.ticket_registry, Account { data, ..acct }).unwrap();
    }
    let user_bal = read_token_balance(&ctx.svm, ctx.user_token_account);

    // Sell 1 active (idx 0) + 1 pending (idx 0) = 2 bonds
    send_sell(&mut ctx, vec![0], vec![0], 2 * bond_price).expect("sell should succeed");

    assert_eq!(read_token_balance(&ctx.svm, ctx.user_token_account), user_bal + 2 * bond_price);
    assert_eq!(read_pool_principal(&ctx.svm, 1), bond_price); // 1 remaining
    assert_eq!(read_registry_active(&ctx.svm, ctx.ticket_registry), 0);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 1);
}

#[test]
fn test_sell_bonds_succeeds_pool_paused() {
    // Use Active status for setup so buy_bonds works, then switch pool to Paused
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    // Buy 1 bond (works because pool is Active)
    do_buy(&mut ctx, 1);

    // Now switch pool status to Paused
    {
        let (pda, _) = pool_pda(1);
        let acct = ctx.svm.get_account(&pda).unwrap();
        let mut pool: anchor::PrizePool =
            anchor_lang::AccountDeserialize::try_deserialize(&mut acct.data.as_slice()).unwrap();
        pool.status = anchor::PoolStatus::Paused;
        let mut data = vec![];
        pool.try_serialize(&mut data).unwrap();
        data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);
        ctx.svm.set_account(pda, Account { data, owner: anchor::id(), ..acct }).unwrap();
    }

    send_sell(&mut ctx, vec![], vec![0], bond_price).expect("sell should succeed even when paused");
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
}

#[test]
fn test_sell_bonds_sell_all_empties_state() {
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    let user_bal_initial = read_token_balance(&ctx.svm, ctx.user_token_account);

    // Buy 3 bonds
    do_buy(&mut ctx, 3);

    // Sell all 3 pending (indices descending: 2, 1, 0)
    send_sell(&mut ctx, vec![], vec![2, 1, 0], 3 * bond_price).expect("sell all should succeed");

    assert_eq!(read_token_balance(&ctx.svm, ctx.user_token_account), user_bal_initial);
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI failure / slippage tests
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_sell_bonds_kamino_fails_no_state_mutation() {
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    do_buy(&mut ctx, 2);

    // Flip reserve to fail mode
    inject_owned_account(&mut ctx.svm, ctx.reserve, anchor::constants::KAMINO_PROGRAM_ID, &[0xFF; 32]);

    let user_bal = read_token_balance(&ctx.svm, ctx.user_token_account);
    let principal = read_pool_principal(&ctx.svm, 1);
    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);

    let err = send_sell(&mut ctx, vec![], vec![0], bond_price).unwrap_err();
    assert!(!err.is_empty());

    // All state unchanged (atomic rollback)
    assert_eq!(read_token_balance(&ctx.svm, ctx.user_token_account), user_bal);
    assert_eq!(read_pool_principal(&ctx.svm, 1), principal);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), pending);
}

#[test]
fn test_sell_bonds_fails_insufficient_liquidity_received() {
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    do_buy(&mut ctx, 1);

    // Pass ktokens_to_burn less than expected_principal
    // Mock returns 1:1, so received = bond_price - 1 < expected_principal
    let err = send_sell(&mut ctx, vec![], vec![0], bond_price - 1).unwrap_err();
    assert!(err.contains("InvalidCollateralAmount"), "Expected InvalidCollateralAmount, got: {err}");
}

#[test]
fn test_sell_bonds_fails_excessive_ktokens_burned() {
    // max_withdrawal_slippage_dust = 0, so any excess triggers ExcessiveKtokensBurned
    let mut ctx = setup_happy(1000, 0, false, anchor::PoolStatus::Active);
    let bond_price = 1_000_000u64;

    // Buy 2 bonds so the vault has 2*bond_price kTokens
    do_buy(&mut ctx, 2);

    // Sell only 1 bond but pass ktokens_to_burn = bond_price + 1
    // Mock returns 1:1, so received = bond_price + 1 > expected_principal + 0 (dust)
    let err = send_sell(&mut ctx, vec![], vec![0], bond_price + 1).unwrap_err();
    assert!(err.contains("ExcessiveKtokensBurned"), "Expected ExcessiveKtokensBurned, got: {err}");
}
