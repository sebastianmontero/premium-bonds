//! Integration tests for `buy_bonds`.
//!
//! # Coverage strategy
//!
//! `buy_bonds` calls into Kamino (a live CPI) as its first side-effect after
//! all guard checks pass.  LiteSVM does not load Kamino, so the **happy path**
//! cannot be fully exercised here — it would fail at the CPI boundary with a
//! "missing program" error, not a real business-logic error.
//!
//! What we *can* verify in LiteSVM is every guard check that runs BEFORE the
//! Kamino call:
//!   1. Pool must be `Active`  (`PoolNotActive`)
//!   2. Pool must not be frozen  (`AwaitingRandomnessFreeze`)
//!   3. `bonds_to_buy` must be > 0  (`InvalidBondQuantity`)
//!   4. `bonds_to_buy` must not exceed `max_tickets_per_buy` from GlobalConfig
//!      (`MaxTicketsPerBuyExceeded`)
//!   5. Registry must have enough remaining capacity  (`RegistryFull`)
//!
//! Each failing test drives the program deep enough that the expected error code
//! is emitted, then aborts before the CPI is attempted.

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
    ).unwrap();

    pda
}

/// Inject a minimal SPL Mint account.
fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
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
    ).unwrap();
}

/// Inject a minimal SPL TokenAccount.
fn inject_token_account(svm: &mut LiteSVM, address: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = vec![0u8; 165];
    data[0..32].copy_from_slice(&mint.to_bytes());
    data[32..64].copy_from_slice(&owner.to_bytes());
    // amount at offset 64 (little-endian u64)
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
    ).unwrap();
}

/// Inject a zeroed TicketRegistry account, setting header fields directly.
///
/// The Anchor discriminator for `TicketRegistry` is sha256("account:ticket_registry")[0..8]
/// = [124, 112, 84, 97, 114, 166, 189, 223], which must be present for `AccountLoader`
/// deserialization to succeed.
fn inject_registry(svm: &mut LiteSVM, address: Pubkey, pool_id: u32, capacity: u32, active: u32, pending: u32) {
    // Layout: 8 discriminator | 4 pool_id | 4 capacity | 4 active | 4 pending
    let mut data = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    // Discriminator = sha256("account:ticket_registry")[0..8]
    data[0..8].copy_from_slice(&[124, 112, 84, 97, 114, 166, 189, 223]);
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
    ).unwrap();
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

    // Kamino placeholder accounts — any pubkey will satisfy `UncheckedAccount`
    // constraints. The instruction will fail at the CPI boundary (not from
    // business-logic guards), which is expected for the guard-check tests.
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
        data: anchor::instruction::BuyBonds { tickets_to_buy: bonds_to_buy }.data(),
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
    inject_mint(&mut svm, token_mint_kp.pubkey(), 6);
    inject_mint(&mut svm, reserve_collateral_mint_kp.pubkey(), 6);

    let user_token_account = Keypair::new().pubkey();
    inject_token_account(&mut svm, user_token_account, token_mint_kp.pubkey(), user.pubkey(), 100_000_000);

    let ticket_registry = Keypair::new().pubkey();
    inject_registry(&mut svm, ticket_registry, 1, registry_capacity, registry_active, registry_pending);

    // Pool vault and ktokens vault (needed for Anchor account resolution even though CPI won't run)
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_ktokens, _) = pool_ktokens_pda(1);
    inject_token_account(&mut svm, pool_vault, token_mint_kp.pubkey(), pool_pda(1).0, 0);
    inject_token_account(&mut svm, pool_ktokens, reserve_collateral_mint_kp.pubkey(), pool_pda(1).0, 0);

    inject_pool(&mut svm, 1, token_mint_kp.pubkey(), ticket_registry, pool_status, is_frozen);

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
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm.send_transaction(tx).map(|_| ()).map_err(|e| format!("{e:?}"))
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

/// Buying more than `max_tickets_per_buy` must be rejected with `MaxTicketsPerBuyExceeded`.
#[test]
fn test_buy_bonds_fails_exceeds_max_tickets_per_buy() {
    // GlobalConfig has max_tickets_per_buy = 5; try to buy 6
    let mut ctx = setup_buy_bonds(5, anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 6).unwrap_err();
    assert!(
        err.contains("MaxTicketsPerBuyExceeded"),
        "Expected MaxTicketsPerBuyExceeded, got: {err}"
    );
}

/// Buying exactly `max_tickets_per_buy` is at the boundary — the program proceeds
/// past all pre-CPI guards and reaches the Kamino call (which will fail in
/// LiteSVM, but NOT with a business-logic error).
#[test]
fn test_buy_bonds_boundary_at_max_tickets_per_buy_passes_guards() {
    let mut ctx = setup_buy_bonds(5, anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 5).unwrap_err(); // will fail at Kamino CPI
    // The error must NOT be a business-logic guard error; it should be a CPI/program error.
    assert!(
        !err.contains("MaxTicketsPerBuyExceeded")
            && !err.contains("PoolNotActive")
            && !err.contains("AwaitingRandomnessFreeze")
            && !err.contains("InvalidBondQuantity")
            && !err.contains("RegistryFull"),
        "Should have passed all guards and failed only at CPI boundary. Got: {err}"
    );
}

/// When the registry is completely full (`active + pending == capacity`),
/// buying any bond must be rejected with `RegistryFull`.
#[test]
fn test_buy_bonds_fails_registry_full() {
    // capacity = 10, already 10 active → no room left
    let mut ctx = setup_buy_bonds(10, anchor::PoolStatus::Active, false, 10, 10, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("RegistryFull"),
        "Expected RegistryFull, got: {err}"
    );
}

/// Buying more tickets than available slots should also yield `RegistryFull`,
/// even when there is *some* capacity remaining.
#[test]
fn test_buy_bonds_fails_registry_insufficient_remaining_slots() {
    // capacity = 10, active = 8, pending = 0 → only 2 free slots; buy 3
    let mut ctx = setup_buy_bonds(10, anchor::PoolStatus::Active, false, 10, 8, 0);
    let err = send_buy_bonds(&mut ctx, 3).unwrap_err();
    assert!(
        err.contains("RegistryFull"),
        "Expected RegistryFull when requesting more than remaining capacity, got: {err}"
    );
}
