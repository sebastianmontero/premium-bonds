//! Integration tests for `buy_bonds`.
//!
//! # Coverage strategy
//!
//! `buy_bonds` calls into Kamino (a live CPI) after all guard checks pass.
//! LiteSVM does not load Kamino, so the **happy path** cannot be fully exercised
//! — it fails at the CPI boundary with a program error, not a business-logic error.
//!
//! What we *can* verify in LiteSVM is every guard check that runs BEFORE the CPI:
//!   1. Pool must be `Active`  (`PoolNotActive`)
//!   2. Pool must not be frozen  (`AwaitingRandomnessFreeze`)
//!   3. `bonds_to_buy` must be > 0  (`InvalidBondQuantity`)
//!   4. `bonds_to_buy` must not exceed `max_tickets_per_buy` (`MaxTicketsPerBuyExceeded`)
//!
//! Registry capacity is checked AFTER the CPI, so it cannot be reached here.
//!
//! Guard logic is also tested as unit tests on `PrizePool::validate_buy_bonds`
//! and `PrizePool::validate_registry_capacity` in `src/state/pool.rs`.

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

/// Inject a `PrizePool` account with the given parameters into the SVM.
fn inject_pool(
    svm: &mut LiteSVM,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
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
        max_withdrawal_slippage_dust: 0,
        prize_tiers: vec![],
        auto_reinvest_default: false,
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

/// Inject a minimal SPL Mint account.
/// If `mint_authority` is Some, the mint will have that pubkey as its authority
/// (required for minting operations like the mock Kamino's `mint_to`).
fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8, mint_authority: Option<Pubkey>) {
    let mut data = vec![0u8; 82];
    if let Some(auth) = mint_authority {
        data[0..4].copy_from_slice(&1u32.to_le_bytes()); // COption::Some
        data[4..36].copy_from_slice(&auth.to_bytes());
    }
    data[44] = decimals;
    data[45] = 1; // is_initialized = true
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

/// Inject a minimal SPL TokenAccount.
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
    data[108] = 1; // state = Initialized
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

/// Inject a zeroed TicketRegistry account with the correct discriminator.
///
/// Discriminator = sha256("account:TicketRegistry")[0..8]
/// = [58, 169, 167, 230, 107, 202, 126, 54]
fn inject_registry(
    svm: &mut LiteSVM,
    address: Pubkey,
    pool_id: u32,
    capacity: u32,
    active: u32,
    pending: u32,
) {
    let mut data = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]);
    data[8..12].copy_from_slice(&pool_id.to_le_bytes());
    data[12..16].copy_from_slice(&capacity.to_le_bytes());
    data[16..20].copy_from_slice(&active.to_le_bytes());
    data[20..24].copy_from_slice(&pending.to_le_bytes());

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

/// Build a complete `BuyBonds` instruction.
fn build_buy_bonds_ix(
    user: Pubkey,
    pool_id: u32,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
    bonds_to_buy: u32,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault_account, _) = pool_vault_pda(pool_id);
    let (pool_ktokens_vault, _) = pool_ktokens_pda(pool_id);

    let kamino_program = anchor::constants::KAMINO_PROGRAM_ID;
    let dummy = Keypair::new().pubkey();
    let instructions_sysvar = anchor::constants::INSTRUCTIONS_SYSVAR_ID;

    let accounts = anchor::accounts::BuyBonds {
        user,
        global_config,
        pool,
        ticket_registry,
        user_token_account,
        token_mint,
        pool_vault_account,
        pool_ktokens_vault,
        kamino_program,
        reserve: dummy,
        lending_market: dummy,
        lending_market_authority: dummy,
        reserve_liquidity_supply: dummy,
        reserve_collateral_mint,
        token_program: anchor_spl::token::ID,
        ktokens_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        instruction_sysvar_account: instructions_sysvar,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds {
            tickets_to_buy: bonds_to_buy,
        }
        .data(),
    }
}

// ─── Shared setup ────────────────────────────────────────────────────────────

struct BuyBondsCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
}

fn setup_buy_bonds(
    max_tickets_per_buy: u32,
    pool_status: anchor::PoolStatus,
    is_frozen: bool,
    registry_capacity: u32,
    registry_active: u32,
    registry_pending: u32,
) -> BuyBondsCtx {
    let (mut svm, _admin) = setup_global_config(max_tickets_per_buy);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint_kp = Keypair::new();
    let reserve_collateral_mint_kp = Keypair::new();
    inject_mint(&mut svm, token_mint_kp.pubkey(), 6, None);
    inject_mint(&mut svm, reserve_collateral_mint_kp.pubkey(), 6, None);

    let user_token_account = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        user_token_account,
        token_mint_kp.pubkey(),
        user.pubkey(),
        100_000_000,
    );

    let ticket_registry = Keypair::new().pubkey();
    inject_registry(
        &mut svm,
        ticket_registry,
        1,
        registry_capacity,
        registry_active,
        registry_pending,
    );

    // Pool vault and ktokens vault (PDA token accounts)
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_ktokens, _) = pool_ktokens_pda(1);
    inject_token_account(
        &mut svm,
        pool_vault,
        token_mint_kp.pubkey(),
        pool_pda(1).0,
        0,
    );
    inject_token_account(
        &mut svm,
        pool_ktokens,
        reserve_collateral_mint_kp.pubkey(),
        pool_pda(1).0,
        0,
    );

    inject_pool(
        &mut svm,
        1,
        token_mint_kp.pubkey(),
        ticket_registry,
        pool_status,
        is_frozen,
    );

    BuyBondsCtx {
        svm,
        user,
        token_mint: token_mint_kp.pubkey(),
        reserve_collateral_mint: reserve_collateral_mint_kp.pubkey(),
        user_token_account,
        ticket_registry,
    }
}

fn send_buy_bonds(ctx: &mut BuyBondsCtx, bonds_to_buy: u32) -> Result<(), String> {
    let ix = build_buy_bonds_ix(
        ctx.user.pubkey(),
        1,
        ctx.token_mint,
        ctx.reserve_collateral_mint,
        ctx.user_token_account,
        ctx.ticket_registry,
        bonds_to_buy,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Guard check tests
// ═══════════════════════════════════════════════════════════════════════════════

/// Pool in Paused state must be rejected with `PoolNotActive`.
#[test]
fn test_buy_bonds_fails_pool_paused() {
    let mut ctx = setup_buy_bonds(10, anchor::PoolStatus::Paused, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("PoolNotActive"),
        "Expected PoolNotActive, got: {err}"
    );
}

/// Pool in Closed state must be rejected with `PoolNotActive`.
#[test]
fn test_buy_bonds_fails_pool_closed() {
    let mut ctx = setup_buy_bonds(10, anchor::PoolStatus::Closed, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("PoolNotActive"),
        "Expected PoolNotActive, got: {err}"
    );
}

/// Pool frozen for draw must be rejected with `AwaitingRandomnessFreeze`.
#[test]
fn test_buy_bonds_fails_pool_frozen() {
    let mut ctx = setup_buy_bonds(10, anchor::PoolStatus::Active, true, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("AwaitingRandomnessFreeze"),
        "Expected AwaitingRandomnessFreeze, got: {err}"
    );
}

/// `bonds_to_buy = 0` must be rejected with `InvalidBondQuantity`.
#[test]
fn test_buy_bonds_fails_zero_quantity() {
    let mut ctx = setup_buy_bonds(10, anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 0).unwrap_err();
    assert!(
        err.contains("InvalidBondQuantity"),
        "Expected InvalidBondQuantity, got: {err}"
    );
}

/// Buying more than `max_tickets_per_buy` must be rejected.
#[test]
fn test_buy_bonds_fails_exceeds_max_tickets_per_buy() {
    let mut ctx = setup_buy_bonds(5, anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 6).unwrap_err();
    assert!(
        err.contains("MaxTicketsPerBuyExceeded"),
        "Expected MaxTicketsPerBuyExceeded, got: {err}"
    );
}

/// Buying exactly `max_tickets_per_buy` passes all pre-CPI guards and reaches
/// the token transfer / Kamino CPI boundary (which fails in LiteSVM, but NOT
/// with a business-logic error).
#[test]
fn test_buy_bonds_boundary_at_max_tickets_passes_guards() {
    let mut ctx = setup_buy_bonds(5, anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 5).unwrap_err();
    // Must NOT be a guard error — it should fail at the CPI/transfer boundary.
    assert!(
        !err.contains("MaxTicketsPerBuyExceeded")
            && !err.contains("PoolNotActive")
            && !err.contains("AwaitingRandomnessFreeze")
            && !err.contains("InvalidBondQuantity")
            && !err.contains("RegistryFull"),
        "Should have passed all guards and failed only at CPI boundary. Got: {err}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-path tests (with mock Kamino loaded)
// ═══════════════════════════════════════════════════════════════════════════════

/// Seed for the mock Kamino lending market authority PDA.
const LMA_SEED: &[u8] = b"lma";

/// Derive the mock lending_market_authority PDA.
fn lending_market_authority_pda(lending_market: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[LMA_SEED, lending_market.as_ref()],
        &anchor::constants::KAMINO_PROGRAM_ID,
    )
}

/// Extended context for happy-path tests (includes Kamino accounts).
struct HappyPathCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    reserve_collateral_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
    // Kamino-specific
    reserve: Pubkey,
    lending_market: Pubkey,
    lending_market_authority: Pubkey,
    reserve_liquidity_supply: Pubkey,
}

/// Build a `BuyBonds` instruction with real Kamino account addresses.
fn build_buy_bonds_ix_full(
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
    bonds_to_buy: u32,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault_account, _) = pool_vault_pda(pool_id);
    let (pool_ktokens_vault, _) = pool_ktokens_pda(pool_id);

    let accounts = anchor::accounts::BuyBonds {
        user,
        global_config,
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
        data: anchor::instruction::BuyBonds {
            tickets_to_buy: bonds_to_buy,
        }
        .data(),
    }
}

/// Inject a minimal account owned by a given program (used for lending_market).
fn inject_owned_account(svm: &mut LiteSVM, address: Pubkey, owner: Pubkey, data: &[u8]) {
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data: data.to_vec(),
            owner,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

/// Set up SVM with both programs loaded + all accounts for a full buy_bonds flow.
fn setup_happy_path(
    max_tickets_per_buy: u32,
    registry_capacity: u32,
    registry_active: u32,
    registry_pending: u32,
    reserve_fail_mode: bool,
) -> HappyPathCtx {
    let (mut svm, _admin) = setup_global_config(max_tickets_per_buy);

    // Load mock Kamino program
    let mock_bytes = include_bytes!("../../../target/deploy/mock_kamino.so");
    let _ = svm.add_program(anchor::constants::KAMINO_PROGRAM_ID, mock_bytes);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    // ── Kamino infrastructure ────────────────────────────────────────────
    let lending_market = Keypair::new().pubkey();
    inject_owned_account(
        &mut svm,
        lending_market,
        anchor::constants::KAMINO_PROGRAM_ID,
        &[0u8; 64], // minimal data, mock only uses the key
    );

    let (lending_market_authority, _) = lending_market_authority_pda(&lending_market);
    // LMA PDA is program-derived, no need to inject — it's validated via invoke_signed

    let reserve = Keypair::new().pubkey();
    let reserve_data = if reserve_fail_mode { vec![0xFF; 32] } else { vec![0u8; 32] };
    inject_owned_account(
        &mut svm,
        reserve,
        anchor::constants::KAMINO_PROGRAM_ID,
        &reserve_data,
    );

    // ── Token mints ─────────────────────────────────────────────────────
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6, None);

    // cToken mint — lending_market_authority is the mint authority
    let reserve_collateral_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, reserve_collateral_mint, 6, Some(lending_market_authority));

    // ── Token accounts ──────────────────────────────────────────────────
    let user_token_account = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        user_token_account,
        token_mint,
        user.pubkey(),
        100_000_000, // 100 USDC (6 decimals)
    );

    let (pool_pda_key, _) = pool_pda(1);

    // Pool vault — owned by pool PDA
    let (pool_vault, _) = pool_vault_pda(1);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_pda_key, 0);

    // Pool kTokens vault — owned by pool PDA
    let (pool_ktokens, _) = pool_ktokens_pda(1);
    inject_token_account(&mut svm, pool_ktokens, reserve_collateral_mint, pool_pda_key, 0);

    // Kamino reserve supply vault — receives underlying tokens
    let reserve_liquidity_supply = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        reserve_liquidity_supply,
        token_mint,
        lending_market_authority,
        0,
    );

    // ── Registry & pool ─────────────────────────────────────────────────
    let ticket_registry = Keypair::new().pubkey();
    inject_registry(
        &mut svm,
        ticket_registry,
        1,
        registry_capacity,
        registry_active,
        registry_pending,
    );

    inject_pool(
        &mut svm,
        1,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    HappyPathCtx {
        svm,
        user,
        token_mint,
        reserve_collateral_mint,
        user_token_account,
        ticket_registry,
        reserve,
        lending_market,
        lending_market_authority,
        reserve_liquidity_supply,
    }
}

fn send_happy_path(ctx: &mut HappyPathCtx, bonds_to_buy: u32) -> Result<(), String> {
    let ix = build_buy_bonds_ix_full(
        ctx.user.pubkey(),
        1,
        ctx.token_mint,
        ctx.reserve_collateral_mint,
        ctx.user_token_account,
        ctx.ticket_registry,
        ctx.reserve,
        ctx.lending_market,
        ctx.lending_market_authority,
        ctx.reserve_liquidity_supply,
        bonds_to_buy,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

/// Send a buy_bonds transaction as a specific user (not ctx.user).
fn send_happy_path_as(
    ctx: &mut HappyPathCtx,
    user: &Keypair,
    user_token_account: Pubkey,
    bonds_to_buy: u32,
) -> Result<(), String> {
    let ix = build_buy_bonds_ix_full(
        user.pubkey(),
        1,
        ctx.token_mint,
        ctx.reserve_collateral_mint,
        user_token_account,
        ctx.ticket_registry,
        ctx.reserve,
        ctx.lending_market,
        ctx.lending_market_authority,
        ctx.reserve_liquidity_supply,
        bonds_to_buy,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

/// Read the u64 `amount` field from a raw SPL TokenAccount (bytes 64..72).
fn read_token_balance(svm: &LiteSVM, address: Pubkey) -> u64 {
    let acct = svm.get_account(&address).expect("account must exist");
    u64::from_le_bytes(acct.data[64..72].try_into().unwrap())
}

/// Read `total_deposited_principal` from a serialized PrizePool account.
/// Offset: 8 (discriminator) + 1 (bump) + 4 (pool_id) + 32 (token_mint)
///        + 32 (ticket_registry) + 32 (fee_wallet) = 109 → next 8 bytes = bond_price
///        + 8 (bond_price) + 8 (stake_cycle) + 2 (fee_bps) + 1+padding (status)
/// We use AccountDeserialize instead for safety.
fn read_pool_principal(svm: &LiteSVM, pool_id: u32) -> u64 {
    let (pda, _) = pool_pda(pool_id);
    let acct = svm.get_account(&pda).expect("pool must exist");
    let pool: anchor::PrizePool =
        anchor_lang::AccountDeserialize::try_deserialize(&mut acct.data.as_slice()).unwrap();
    pool.total_deposited_principal
}

/// Read `pending_tickets_count` from a raw TicketRegistry account.
/// Layout: 8 (disc) + 4 (pool_id) + 4 (capacity) + 4 (active) + 4 (pending)
fn read_registry_pending(svm: &LiteSVM, registry: Pubkey) -> u32 {
    let acct = svm.get_account(&registry).expect("registry must exist");
    u32::from_le_bytes(acct.data[20..24].try_into().unwrap())
}

/// Read a ticket pubkey from the registry at the given slot index.
fn read_registry_ticket(svm: &LiteSVM, registry: Pubkey, idx: usize) -> Pubkey {
    let acct = svm.get_account(&registry).expect("registry must exist");
    let start = 24 + idx * 32; // 24 = header size
    Pubkey::try_from(&acct.data[start..start + 32]).unwrap()
}

// ─── Happy path tests ────────────────────────────────────────────────────────

/// Buy 1 bond: full end-to-end flow through mock Kamino CPI.
#[test]
fn test_buy_bonds_happy_path_single() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, false);
    let bond_price = 1_000_000u64; // from inject_pool

    let user_balance_before = read_token_balance(&ctx.svm, ctx.user_token_account);
    send_happy_path(&mut ctx, 1).expect("buy_bonds should succeed");

    // User debited
    let user_balance_after = read_token_balance(&ctx.svm, ctx.user_token_account);
    assert_eq!(user_balance_before - user_balance_after, bond_price);

    // Pool vault should be empty (forwarded to Kamino)
    let (pool_vault, _) = pool_vault_pda(1);
    assert_eq!(read_token_balance(&ctx.svm, pool_vault), 0);

    // Kamino supply vault received the tokens
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.reserve_liquidity_supply),
        bond_price
    );

    // kTokens minted 1:1 into pool kTokens vault
    let (pool_ktokens, _) = pool_ktokens_pda(1);
    assert_eq!(read_token_balance(&ctx.svm, pool_ktokens), bond_price);

    // Pool state updated
    assert_eq!(read_pool_principal(&ctx.svm, 1), bond_price);

    // Registry: 1 pending ticket with user's pubkey
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 1);
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 0),
        ctx.user.pubkey()
    );
}

/// Buy 5 bonds: verify all assertions scale correctly.
#[test]
fn test_buy_bonds_happy_path_multiple() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, false);
    let bond_price = 1_000_000u64;
    let bonds = 5u32;
    let total = bond_price * bonds as u64;

    send_happy_path(&mut ctx, bonds).expect("buy_bonds should succeed");

    // User debited total
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_token_account),
        100_000_000 - total
    );

    // Kamino supply vault received all tokens
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.reserve_liquidity_supply),
        total
    );

    // kTokens minted for full amount
    let (pool_ktokens, _) = pool_ktokens_pda(1);
    assert_eq!(read_token_balance(&ctx.svm, pool_ktokens), total);

    // Pool principal
    assert_eq!(read_pool_principal(&ctx.svm, 1), total);

    // All 5 tickets have the user's pubkey
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), bonds);
    for i in 0..bonds as usize {
        assert_eq!(
            read_registry_ticket(&ctx.svm, ctx.ticket_registry, i),
            ctx.user.pubkey(),
            "Ticket at index {i} should be user's pubkey"
        );
    }
}

/// Buy at exact max capacity boundary — should succeed.
#[test]
fn test_buy_bonds_happy_path_at_max_capacity() {
    // capacity = 5, active = 2, pending = 1, buying 2 → 2+1+2 = 5 = capacity
    let mut ctx = setup_happy_path(10, 5, 2, 1, false);

    send_happy_path(&mut ctx, 2).expect("buy at exact capacity should succeed");
    // pending was 1, now should be 3
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 3);
}

/// Buy that exceeds capacity — now reachable since Kamino CPI succeeds first.
#[test]
fn test_buy_bonds_fails_registry_full() {
    // capacity = 5, active = 2, pending = 2, buying 2 → 2+2+2 = 6 > 5
    let mut ctx = setup_happy_path(10, 5, 2, 2, false);

    let err = send_happy_path(&mut ctx, 2).unwrap_err();
    assert!(
        err.contains("RegistryFull"),
        "Expected RegistryFull, got: {err}"
    );
}

// ─── Kamino CPI failure tests ────────────────────────────────────────────────

/// When mock Kamino fails, no state should be mutated (transaction atomicity).
#[test]
fn test_buy_bonds_kamino_fails_no_state_mutation() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, true); // fail_mode = true

    let user_balance_before = read_token_balance(&ctx.svm, ctx.user_token_account);
    let principal_before = read_pool_principal(&ctx.svm, 1);
    let pending_before = read_registry_pending(&ctx.svm, ctx.ticket_registry);

    let err = send_happy_path(&mut ctx, 1).unwrap_err();
    assert!(!err.is_empty(), "Should have returned an error");

    // All state must be unchanged (Solana atomic rollback)
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_token_account),
        user_balance_before,
        "User balance must be unchanged after failed tx"
    );
    assert_eq!(
        read_pool_principal(&ctx.svm, 1),
        principal_before,
        "Pool principal must be unchanged after failed tx"
    );
    assert_eq!(
        read_registry_pending(&ctx.svm, ctx.ticket_registry),
        pending_before,
        "Registry pending count must be unchanged after failed tx"
    );
}

/// Verify the error from a Kamino failure is a program error, not a guard error.
#[test]
fn test_buy_bonds_kamino_fails_error_propagation() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, true); // fail_mode = true

    let err = send_happy_path(&mut ctx, 1).unwrap_err();

    // Must not be any of our guard errors
    assert!(!err.contains("PoolNotActive"), "Not a guard error: {err}");
    assert!(!err.contains("AwaitingRandomnessFreeze"), "Not a guard error: {err}");
    assert!(!err.contains("InvalidBondQuantity"), "Not a guard error: {err}");
    assert!(!err.contains("MaxTicketsPerBuyExceeded"), "Not a guard error: {err}");
    assert!(!err.contains("RegistryFull"), "Not a guard error: {err}");
}

/// When the cToken mint has wrong authority, mock can't mint → clean CPI error.
#[test]
fn test_buy_bonds_kamino_fails_bad_mint_authority() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, false);

    // Overwrite the cToken mint with a WRONG mint authority
    inject_mint(&mut ctx.svm, ctx.reserve_collateral_mint, 6, Some(Pubkey::new_unique()));

    let err = send_happy_path(&mut ctx, 1).unwrap_err();
    assert!(!err.is_empty(), "Should fail due to wrong mint authority");

    // Verify no state mutation
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 0);
}

// ─── Additional coverage tests ──────────────────────────────────────────────

/// User tries to buy more bonds than their balance allows.
/// SPL transfer_checked should fail before Kamino CPI.
#[test]
fn test_buy_bonds_fails_insufficient_balance() {
    // User has 100_000_000 (100 USDC), bond_price = 1_000_000 (1 USDC)
    // max_tickets_per_buy = 200 so the guard passes; balance is the bottleneck.
    let mut ctx = setup_happy_path(200, 1000, 0, 0, false);

    let err = send_happy_path(&mut ctx, 101).unwrap_err();

    // Should NOT be any guard error — guards pass, SPL transfer fails
    assert!(!err.contains("PoolNotActive"), "Not a guard error: {err}");
    assert!(!err.contains("InvalidBondQuantity"), "Not a guard error: {err}");
    assert!(!err.contains("MaxTicketsPerBuyExceeded"), "Not a guard error: {err}");

    // State unchanged
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 0);
}

/// Two sequential buys must accumulate principal, pending count, and token flow.
#[test]
fn test_buy_bonds_multi_buy_accumulates_state() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, false);
    let bond_price = 1_000_000u64;

    // First buy: 2 bonds
    send_happy_path(&mut ctx, 2).expect("first buy should succeed");
    assert_eq!(read_pool_principal(&ctx.svm, 1), 2 * bond_price);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 2);

    // Second buy: 3 bonds
    send_happy_path(&mut ctx, 3).expect("second buy should succeed");
    assert_eq!(read_pool_principal(&ctx.svm, 1), 5 * bond_price);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 5);

    // All 5 tickets belong to the same user
    for i in 0..5 {
        assert_eq!(
            read_registry_ticket(&ctx.svm, ctx.ticket_registry, i),
            ctx.user.pubkey(),
            "Ticket at index {i} should be user's pubkey"
        );
    }

    // Cumulative token flow
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_token_account),
        100_000_000 - 5 * bond_price
    );
}

/// Two different users buy bonds; verify ticket owner isolation.
#[test]
fn test_buy_bonds_two_users_ticket_isolation() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, false);

    // User A (ctx.user) buys 2 bonds
    send_happy_path(&mut ctx, 2).expect("user A buy should succeed");

    // Create User B with their own token account
    let user_b = Keypair::new();
    ctx.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();
    let user_b_token_account = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        user_b_token_account,
        ctx.token_mint,
        user_b.pubkey(),
        50_000_000,
    );

    // User B buys 3 bonds
    send_happy_path_as(&mut ctx, &user_b, user_b_token_account, 3)
        .expect("user B buy should succeed");

    // 5 total pending tickets
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 5);

    // Tickets 0-1 belong to User A
    for i in 0..2 {
        assert_eq!(
            read_registry_ticket(&ctx.svm, ctx.ticket_registry, i),
            ctx.user.pubkey(),
            "Ticket {i} should belong to User A"
        );
    }

    // Tickets 2-4 belong to User B
    for i in 2..5 {
        assert_eq!(
            read_registry_ticket(&ctx.svm, ctx.ticket_registry, i),
            user_b.pubkey(),
            "Ticket {i} should belong to User B"
        );
    }
}

/// Passing a registry account that doesn't match pool.ticket_registry
/// must be rejected by Anchor's `has_one` constraint.
#[test]
fn test_buy_bonds_fails_wrong_ticket_registry() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, false);

    // Inject a valid-looking registry that is NOT the one stored in the pool
    let wrong_registry = Keypair::new().pubkey();
    inject_registry(&mut ctx.svm, wrong_registry, 1, 1000, 0, 0);

    // Build instruction referencing the wrong registry
    let ix = build_buy_bonds_ix_full(
        ctx.user.pubkey(),
        1,
        ctx.token_mint,
        ctx.reserve_collateral_mint,
        ctx.user_token_account,
        wrong_registry,
        ctx.reserve,
        ctx.lending_market,
        ctx.lending_market_authority,
        ctx.reserve_liquidity_supply,
        1,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx =
        VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let err = ctx.svm
        .send_transaction(tx)
        .map_err(|e| format!("{e:?}"))
        .unwrap_err();

    // Must fail with a constraint error, not a business-logic error
    assert!(!err.contains("PoolNotActive"), "Should be constraint, got: {err}");
    assert!(!err.contains("InvalidBondQuantity"), "Should be constraint, got: {err}");

    // No state mutation on the real registry
    assert_eq!(read_pool_principal(&ctx.svm, 1), 0);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 0);
}

/// When Kamino CPI fails, pool_vault, pool_ktokens, and Kamino supply vault
/// balances must all remain unchanged (extends no_state_mutation test).
#[test]
fn test_buy_bonds_kamino_fails_vault_balances_unchanged() {
    let mut ctx = setup_happy_path(10, 1000, 0, 0, true); // fail_mode = true

    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_ktokens, _) = pool_ktokens_pda(1);

    let vault_before = read_token_balance(&ctx.svm, pool_vault);
    let ktokens_before = read_token_balance(&ctx.svm, pool_ktokens);
    let supply_before = read_token_balance(&ctx.svm, ctx.reserve_liquidity_supply);

    let err = send_happy_path(&mut ctx, 1).unwrap_err();
    assert!(!err.is_empty(), "Should have returned an error");

    assert_eq!(
        read_token_balance(&ctx.svm, pool_vault),
        vault_before,
        "Pool vault balance must be unchanged after failed tx"
    );
    assert_eq!(
        read_token_balance(&ctx.svm, pool_ktokens),
        ktokens_before,
        "Pool kTokens vault must be unchanged after failed tx"
    );
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.reserve_liquidity_supply),
        supply_before,
        "Kamino supply vault must be unchanged after failed tx"
    );
}
