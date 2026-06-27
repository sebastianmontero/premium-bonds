//! Integration tests for `sell_bonds` and `claim_redemption`.
//!
//! Guard tests verify that validation logic (frozen pool, zero quantity,
//! unauthorized tickets, etc.) fires correctly — no Huma CPI is reached.
//! E2E tests verify the complete interaction with the `mock-huma` program,
//! including simulated failures, multiple users, sequential sales, and claim validation.

use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
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

const PENDING_REDEMPTION_SEED: &[u8] = b"pending_redemption";

// ─── Keypair Helper ──────────────────────────────────────────────────────────

fn clone_keypair(keypair: &Keypair) -> Keypair {
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&keypair.to_bytes()[..32]);
    Keypair::new_from_array(seed)
}

// ─── PDA helpers ─────────────────────────────────────────────────────────────

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

// ─── Account injection helper ────────────────────────────────────────────────

fn inject_lender_state(svm: &mut LiteSVM, address: Pubkey, amount: u64) {
    let mut data = vec![0u8; 16];
    data[8..16].copy_from_slice(&amount.to_le_bytes());
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

// ─── E2E Helpers ─────────────────────────────────────────────────────────────

fn send_e2e_sell_bonds_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
    huma_pool_mode_token: Pubkey,
) -> Result<(), String> {
    let (pool_pda_key, _) = pool_pda(1);
    let pool = read_pool_state(&ctx.svm, 1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, pool.next_redemption_id);
    let dummy = Keypair::new().pubkey();
    let huma_lender_state = if huma_lender_state == Pubkey::default() {
        Keypair::new().pubkey()
    } else {
        huma_lender_state
    };

    let accounts = anchor::accounts::SellBonds {
        user: user.pubkey(),
        pool: pool_pda_key,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SellBonds {
            active_indices,
            pending_indices,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

fn send_e2e_claim_redemption_for_user(
    ctx: &mut E2eContext,
    user: &Keypair,
    user_token_account: Pubkey,
    redemption_id: u64,
    huma_config: Pubkey,
    huma_lender_state: Pubkey,
) -> Result<(), String> {
    let (pool_pda_key, _) = pool_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, redemption_id);
    let (pool_vault, _) = pool_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimRedemption {
        user: user.pubkey(),
        pool: pool_pda_key,
        pending_redemption,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        user_token_account,
        huma_program: huma_program_id(),
        huma_config,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_lender_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimRedemption {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

fn send_e2e_harvest_yield_and_commit(ctx: &mut E2eContext) -> Result<(), String> {
    let (global_config, _) = global_config_pda();
    let (pool_key, _) = pool_pda(1);
    let pool = read_pool_state(&ctx.svm, 1);

    // Warp clock to current_cycle_end_at to satisfy time check
    let clock = solana_sdk::clock::Clock {
        unix_timestamp: pool.current_cycle_end_at,
        ..Default::default()
    };
    ctx.svm.set_sysvar(&clock);

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (current_draw_cycle, _) = Pubkey::find_program_address(
        &[
            b"draw_cycle",
            1u32.to_le_bytes().as_ref(),
            pool.current_draw_cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    );

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: ctx.admin.pubkey(),
        global_config,
        pool: pool_key,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle,
        pool_pst_vault,
        pst_mint: ctx.pst_mint,
        huma_pool_state: ctx.huma_pool_state,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ─── Instruction builder (for guard tests) ───────────────────────────────────

fn build_sell_bonds_ix(
    user: Pubkey,
    pool_id: u32,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
) -> Instruction {
    let (pool, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::SellBonds {
        user,
        pool,
        ticket_registry,
        token_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
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
        data: anchor::instruction::SellBonds {
            active_indices,
            pending_indices,
        }
        .data(),
    }
}

// ─── Guard test setup ────────────────────────────────────────────────────────

struct GuardCtx {
    svm: LiteSVM,
    user: Keypair,
    token_mint: Pubkey,
    ticket_registry: Pubkey,
}

fn setup_guard(is_frozen: bool, active: u32, pending: u32, tickets: &[Pubkey]) -> GuardCtx {
    let (mut svm, _admin) = setup_global_config(100);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let pool_key = pool_pda(1).0;

    // Pool PST vault
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 0);

    let ticket_registry = Keypair::new().pubkey();
    inject_registry_with_tickets(&mut svm, ticket_registry, 1, 1000, active, pending, tickets);

    inject_pool(
        &mut svm,
        1,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        is_frozen,
    );

    GuardCtx {
        svm,
        user,
        token_mint,
        ticket_registry,
    }
}

fn send_sell_guard(
    ctx: &mut GuardCtx,
    active_indices: Vec<u32>,
    pending_indices: Vec<u32>,
) -> Result<(), String> {
    let ix = build_sell_bonds_ix(
        ctx.user.pubkey(),
        1,
        ctx.token_mint,
        ctx.ticket_registry,
        active_indices,
        pending_indices,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Guard tests (validation before any CPI)
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_sell_bonds_fails_pool_frozen() {
    let user_pk = Keypair::new().pubkey();
    let mut ctx = setup_guard(true, 1, 0, &[user_pk]);
    let err = send_sell_guard(&mut ctx, vec![0], vec![]).unwrap_err();
    assert!(
        err.contains("AwaitingRandomnessFreeze"),
        "Expected AwaitingRandomnessFreeze, got: {err}"
    );
}

#[test]
fn test_sell_bonds_fails_zero_quantity() {
    let mut ctx = setup_guard(false, 0, 0, &[]);
    let err = send_sell_guard(&mut ctx, vec![], vec![]).unwrap_err();
    assert!(
        err.contains("InvalidBondQuantity"),
        "Expected InvalidBondQuantity, got: {err}"
    );
}

#[test]
fn test_sell_bonds_fails_unauthorized_pending_ticket() {
    let other = Pubkey::new_unique();
    let mut ctx = setup_guard(false, 0, 1, &[other]);
    let err = send_sell_guard(&mut ctx, vec![], vec![0]).unwrap_err();
    assert!(
        err.contains("UnauthorizedTicket"),
        "Expected UnauthorizedTicket, got: {err}"
    );
}

#[test]
fn test_sell_bonds_fails_unauthorized_active_ticket() {
    let other = Pubkey::new_unique();
    let mut ctx = setup_guard(false, 1, 0, &[other]);
    let err = send_sell_guard(&mut ctx, vec![0], vec![]).unwrap_err();
    assert!(
        err.contains("UnauthorizedTicket"),
        "Expected UnauthorizedTicket, got: {err}"
    );
}

#[test]
fn test_sell_bonds_fails_invalid_pending_indices_not_descending() {
    let mut ctx = setup_guard(false, 0, 3, &[]);
    {
        let pk = ctx.user.pubkey();
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        for i in 0..3 {
            let s = 24 + i * 32;
            data[s..s + 32].copy_from_slice(pk.as_ref());
        }
        ctx.svm
            .set_account(ctx.ticket_registry, Account { data, ..acct })
            .unwrap();
    }
    let err = send_sell_guard(&mut ctx, vec![], vec![0, 1]).unwrap_err();
    assert!(
        err.contains("InvalidIndices"),
        "Expected InvalidIndices, got: {err}"
    );
}

#[test]
fn test_sell_bonds_fails_invalid_active_indices_not_descending() {
    let mut ctx = setup_guard(false, 3, 0, &[]);
    {
        let pk = ctx.user.pubkey();
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        for i in 0..3 {
            let s = 24 + i * 32;
            data[s..s + 32].copy_from_slice(pk.as_ref());
        }
        ctx.svm
            .set_account(ctx.ticket_registry, Account { data, ..acct })
            .unwrap();
    }
    let err = send_sell_guard(&mut ctx, vec![0, 1], vec![]).unwrap_err();
    assert!(
        err.contains("InvalidIndices"),
        "Expected InvalidIndices, got: {err}"
    );
}

#[test]
fn test_sell_bonds_fails_math_overflow() {
    let mut ctx = setup_guard(false, 1, 0, &[]);
    {
        let pk = ctx.user.pubkey();
        let acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let mut data = acct.data.clone();
        let s = 24;
        data[s..s + 32].copy_from_slice(pk.as_ref());
        ctx.svm
            .set_account(ctx.ticket_registry, Account { data, ..acct })
            .unwrap();
    }
    let err = send_sell_guard(&mut ctx, vec![0], vec![]).unwrap_err();
    assert!(
        err.contains("MathOverflow"),
        "Expected MathOverflow, got: {err}"
    );
}

// ─── E2E happy-path and integration tests (with mock-huma program) ───────────

#[test]
fn test_sell_bonds_e2e_happy_path() {
    let mut ctx = setup_e2e(10);
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // User A buys 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).expect("buy 10 bonds");
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 10);
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 10_000_000);

    // Clone User A keypair to avoid borrow checker conflict
    let user_a = clone_keypair(&ctx.user);

    // User A sells 3 pending bonds
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![],
        vec![2, 1, 0],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .expect("sell 3 pending bonds");

    // Registry pending count should decrease by 3
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 7);

    // Vault balances: 3_000_000 PST should have moved to huma_pool_mode_token
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 7_000_000);
    assert_eq!(
        read_token_balance(&ctx.svm, huma_pool_mode_token),
        3_000_000
    );

    // A PendingRedemption PDA should be created at ID 0
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    let pending_redemption_account = ctx.svm.get_account(&pending_redemption_key).unwrap();
    let pending_redemption =
        anchor::PendingRedemption::try_deserialize(&mut pending_redemption_account.data.as_slice())
            .unwrap();

    assert_eq!(pending_redemption.user, ctx.user.pubkey());
    assert_eq!(pending_redemption.pool_id, 1);
    assert_eq!(pending_redemption.redemption_id, 0);
    assert_eq!(pending_redemption.amount, 3_000_000);
    assert_eq!(pending_redemption.pst_shares_locked, 3_000_000);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.next_redemption_id, 1);
}

#[test]
fn test_claim_redemption_e2e_happy_path() {
    let mut ctx = setup_e2e(10);

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund Huma underlying token vault with USDC so disburse can complete
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    // Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Sell 3 pending bonds -> redemption_id = 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![],
        vec![2, 1, 0],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 90_000_000);

    // Inject simulated Huma lender state
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);

    // Claim redemption
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("claim redemption");

    // User A should have received 3 USDC back
    assert_eq!(read_token_balance(&ctx.svm, user_a_usdc), 93_000_000);

    // PendingRedemption PDA should be closed
    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_redemption_key).is_none());
}

#[test]
fn test_sell_bonds_multiple_users_and_sales() {
    let mut ctx = setup_e2e(100);

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund Huma underlying token
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        50_000_000,
    );

    // Setup User B
    let user_b = Keypair::new();
    ctx.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();
    let user_b_usdc =
        create_spl_token_account(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &user_b.pubkey());
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user_b_usdc,
        &ctx.usdc_mint_authority,
        100_000_000,
    );

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // User A buys 3 bonds (pending indices: 0, 1, 2)
    send_e2e_buy_bonds_for_user(&mut ctx, &user_a, user_a_usdc, 3, Pubkey::default()).unwrap();

    // User B buys 2 bonds (pending indices: 3, 4)
    send_e2e_buy_bonds_for_user(&mut ctx, &user_b, user_b_usdc, 2, Pubkey::default()).unwrap();

    // Verify ticket ownership before cycle commit
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 0),
        user_a.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 1),
        user_a.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 2),
        user_a.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 3),
        user_b.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 4),
        user_b.pubkey()
    );

    // Commit cycle to transition pending tickets to active tickets
    send_e2e_harvest_yield_and_commit(&mut ctx).unwrap();

    assert_eq!(read_registry_active(&ctx.svm, ctx.ticket_registry), 5);
    assert_eq!(read_registry_pending(&ctx.svm, ctx.ticket_registry), 0);

    // User A sells active ticket at index 1 (User A owns 0, 1, 2)
    // Swap-and-pop should swap active index 1 (User A) with active index 4 (User B)
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![1],
        vec![],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    // Verify new active list: User B's ticket originally at index 4 is now at index 1.
    assert_eq!(read_registry_active(&ctx.svm, ctx.ticket_registry), 4);
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 0),
        user_a.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 1),
        user_b.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 2),
        user_a.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 3),
        user_b.pubkey()
    );

    // Verification of PendingRedemption 0 user
    let (pending_0, _) = pending_redemption_pda(1, 0);
    let acct_0 = ctx.svm.get_account(&pending_0).unwrap();
    let redemption_0 =
        anchor::PendingRedemption::try_deserialize(&mut acct_0.data.as_slice()).unwrap();
    assert_eq!(redemption_0.user, user_a.pubkey());

    // User B sells active ticket at index 1 (which now belongs to User B)
    // Swap-and-pop should swap active index 1 (User B) with active index 3 (User B)
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_b,
        vec![1],
        vec![],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    // Verify new active list: active count is 3, indices 0 & 2 are User A, index 1 is User B
    assert_eq!(read_registry_active(&ctx.svm, ctx.ticket_registry), 3);
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 0),
        user_a.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 1),
        user_b.pubkey()
    );
    assert_eq!(
        read_registry_ticket(&ctx.svm, ctx.ticket_registry, 2),
        user_a.pubkey()
    );

    // Verification of PendingRedemption 1 user (User B)
    let (pending_1, _) = pending_redemption_pda(1, 1);
    let acct_1 = ctx.svm.get_account(&pending_1).unwrap();
    let redemption_1 =
        anchor::PendingRedemption::try_deserialize(&mut acct_1.data.as_slice()).unwrap();
    assert_eq!(redemption_1.user, user_b.pubkey());
}

#[test]
fn test_sell_bonds_fails_huma_redemption_error() {
    let mut ctx = setup_e2e(10);
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);

    // Attempt to sell with FAIL_REDEMPTION_PUBKEY
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![],
        vec![0],
        FAIL_REDEMPTION_PUBKEY,
        Pubkey::default(),
        huma_pool_mode_token,
    );

    assert!(res.is_err());
    assert!(res.unwrap_err().contains("SimulatedRedemptionFailure"));
}

#[test]
fn test_claim_redemption_fails_huma_disburse_error() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![],
        vec![0],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 1_000_000);

    // Claim with FAIL_DISBURSE_PUBKEY
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        FAIL_DISBURSE_PUBKEY,
        huma_lender_state,
    );

    assert!(res.is_err());
    assert!(res.unwrap_err().contains("SimulatedDisburseFailure"));
}

#[test]
fn test_claim_redemption_fails_not_settled() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![],
        vec![0],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    // Inject lender state with insufficient settled amount (500_000 < 1_000_000)
    inject_lender_state(&mut ctx.svm, huma_lender_state, 500_000);

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert!(res.is_err());
    assert!(res.unwrap_err().contains("HumaRedemptionNotSettled"));
}

#[test]
fn test_claim_redemption_fails_wrong_owner() {
    let mut ctx = setup_e2e(10);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 3).unwrap();

    let user_a = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        vec![],
        vec![0],
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 1_000_000);

    // Setup another user who will try to claim User A's redemption
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let attacker_usdc =
        create_spl_token_account(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &attacker.pubkey());

    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &attacker,
        attacker_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );

    assert!(res.is_err());
    assert!(res.unwrap_err().contains("InvalidRedemptionOwner"));
}
