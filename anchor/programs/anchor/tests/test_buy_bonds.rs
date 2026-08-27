//! Integration tests for `buy_bonds` (Huma-based).
//!
//! Guard tests verify validation logic before the Huma CPI boundary.
//! Happy-path tests require a mock-huma program and are not included here.

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

mod common;
use common::*;

/// Build a `BuyBonds` instruction with dummy Huma accounts (for guard tests).
fn build_buy_bonds_ix(
    user: Pubkey,
    pool_id: u32,
    token_mint: Pubkey,
    pst_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
    huma_pool_state: Pubkey,
    bonds_to_buy: u32,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_vault_account, _) = pool_vault_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &user);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user,
        user_winnings,
        pool,
        ticket_registry,
        user_token_account,
        token_mint,
        pool_vault_account,
        pool_pst_vault,
        huma_program: anchor::constants::HUMA_PROGRAM_ID,
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: dummy,
        huma_pool_authority: dummy,
        huma_pool_underlying_token: dummy,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
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
    pst_mint: Pubkey,
    user_token_account: Pubkey,
    ticket_registry: Pubkey,
    huma_pool_state: Pubkey,
}

fn setup_buy_bonds(
    pool_status: anchor::PoolStatus,
    is_frozen: bool,
    registry_capacity: u32,
    registry_active: u32,
    registry_pending: u32,
) -> BuyBondsCtx {
    let (mut svm, _admin) = setup_global_config();

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let user_token_account = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        user_token_account,
        token_mint,
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

    // Pool vault and PST vault (PDA token accounts)
    let pool_key = pool_pda(1).0;
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 0);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 0);

    inject_pool(
        &mut svm,
        1,
        token_mint,
        ticket_registry,
        pool_status,
        is_frozen,
    );

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    BuyBondsCtx {
        svm,
        user,
        token_mint,
        pst_mint,
        user_token_account,
        ticket_registry,
        huma_pool_state,
    }
}

fn send_buy_bonds(ctx: &mut BuyBondsCtx, bonds_to_buy: u32) -> Result<(), String> {
    let ix = build_buy_bonds_ix(
        ctx.user.pubkey(),
        1,
        ctx.token_mint,
        ctx.pst_mint,
        ctx.user_token_account,
        ctx.ticket_registry,
        ctx.huma_pool_state,
        bonds_to_buy,
    );
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    match ctx.svm.send_transaction(tx) {
        Ok(_) => Ok(()),
        Err(err) => {
            println!("Transaction failed metadata: {:#?}", err);
            Err(format!("{err:?}"))
        }
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Guard check tests
// ═══════════════════════════════════════════════════════════════════════════════

/// Pool in Paused state must be rejected with `PoolNotActive`.
#[test]
fn test_buy_bonds_fails_pool_paused() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Paused, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("PoolNotActive"),
        "Expected PoolNotActive, got: {err}"
    );
}

/// Pool in Closed state must be rejected with `PoolNotActive`.
#[test]
fn test_buy_bonds_fails_pool_closed() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Closed, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("PoolNotActive"),
        "Expected PoolNotActive, got: {err}"
    );
}

/// Pool frozen for draw must be rejected with `AwaitingRandomnessFreeze`.
#[test]
fn test_buy_bonds_fails_pool_frozen() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, true, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("AwaitingRandomnessFreeze"),
        "Expected AwaitingRandomnessFreeze, got: {err}"
    );
}

/// `bonds_to_buy = 0` must be rejected with `InvalidBondQuantity`.
#[test]
fn test_buy_bonds_fails_zero_quantity() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 0).unwrap_err();
    assert!(
        err.contains("InvalidBondQuantity"),
        "Expected InvalidBondQuantity, got: {err}"
    );
}

/// Valid ticket quantity passes all pre-CPI guards and reaches
/// the token transfer / Huma CPI boundary (which fails in LiteSVM, but NOT
/// with a business-logic error).
#[test]
fn test_buy_bonds_passes_guards() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 1000, 0, 0);
    let err = send_buy_bonds(&mut ctx, 5).unwrap_err();
    // Must NOT be a guard error — it should fail at the CPI/transfer boundary.
    assert!(
        !err.contains("PoolNotActive")
            && !err.contains("AwaitingRandomnessFreeze")
            && !err.contains("InvalidBondQuantity")
            && !err.contains("RegistryFull"),
        "Should have passed all guards and failed only at CPI boundary. Got: {err}"
    );
}

/// Buying bonds when registry is full for a new user must fail with `RegistryFull` pre-CPI.
#[test]
fn test_buy_bonds_fails_registry_full_pre_cpi() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 10, 0, 0);
    let dummy_users: Vec<Pubkey> = (0..10).map(|_| Keypair::new().pubkey()).collect();
    inject_registry_with_tickets(&mut ctx.svm, ctx.ticket_registry, 1, 10, 10, 0, &dummy_users);

    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("RegistryFull"),
        "Expected RegistryFull pre-CPI, got: {err}"
    );
}

/// Total pending tickets overflow must fail with `MathOverflow` pre-CPI.
#[test]
fn test_buy_bonds_fails_total_pending_overflow_pre_cpi() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 1000, 0, u32::MAX - 2);
    let err = send_buy_bonds(&mut ctx, 5).unwrap_err();
    assert!(
        err.contains("MathOverflow"),
        "Expected MathOverflow pre-CPI on pending overflow, got: {err}"
    );
}

/// A re-entering user (has user_winnings with UNASSIGNED_ENTRY_INDEX) fails with RegistryFull when capacity is full.
#[test]
fn test_buy_bonds_reentering_user_fails_registry_full() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 10, 0, 0);
    let dummy_users: Vec<Pubkey> = (0..10).map(|_| Keypair::new().pubkey()).collect();
    inject_registry_with_tickets(&mut ctx.svm, ctx.ticket_registry, 1, 10, 10, 0, &dummy_users);

    inject_user_winnings_with_index(
        &mut ctx.svm,
        1,
        ctx.user.pubkey(),
        50,
        200,
        100,
        anchor::state::UserWinnings::UNASSIGNED_ENTRY_INDEX,
    );

    let err = send_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("RegistryFull"),
        "Expected RegistryFull for re-entering user when registry is full, got: {err}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// E2E happy-path tests (with mock-huma program)
// ═══════════════════════════════════════════════════════════════════════════════

// ── E2E Tests ────────────────────────────────────────────────────────────────

/// Happy path: buy 1 bond, verify USDC moves, PST minted, principal updated, ticket registered.
#[test]
fn test_buy_bonds_e2e_single_bond() {
    let mut ctx = setup_e2e();
    let pool_vault = pool_vault_pda(1).0;
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    // Before
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_usdc_account),
        100_000_000
    );
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 0);

    send_e2e_buy_bonds(&mut ctx, 1).expect("buy 1 bond should succeed");

    // After: user pays 1 USDC
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_usdc_account),
        99_000_000
    );
    // Pool vault should be 0 (USDC was forwarded to Huma)
    assert_eq!(read_token_balance(&ctx.svm, pool_vault), 0);
    // PST vault should have 1_000_000 PST (1:1 mock rate)
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 1_000_000);
    // Huma underlying should have received the USDC
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.huma_pool_underlying_token),
        1_000_000
    );

    // State checks
    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 1_000_000);

    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    assert_eq!(pending, 1);

    // Verify user entry
    let winnings = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    let entry_idx = winnings.registry_entry_index;
    assert_ne!(entry_idx, u32::MAX);
    let entry = read_registry_entry(&ctx.svm, ctx.ticket_registry, entry_idx as usize);
    assert_eq!(entry.owner, ctx.user.pubkey());
    assert_eq!(entry.active, 0);
    assert_eq!(entry.pending, 1);
}

/// Buy multiple bonds in one transaction.
#[test]
fn test_buy_bonds_e2e_multiple_bonds() {
    let mut ctx = setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    send_e2e_buy_bonds(&mut ctx, 5).expect("buy 5 bonds should succeed");

    // 5 bonds at 1 USDC each = 5_000_000 lamports
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_usdc_account),
        95_000_000
    );
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 5_000_000);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 5_000_000);

    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    assert_eq!(pending, 5);

    // Verify user entry
    let winnings = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    let entry_idx = winnings.registry_entry_index;
    assert_ne!(entry_idx, u32::MAX);
    let entry = read_registry_entry(&ctx.svm, ctx.ticket_registry, entry_idx as usize);
    assert_eq!(entry.owner, ctx.user.pubkey());
    assert_eq!(entry.active, 0);
    assert_eq!(entry.pending, 5);
}

/// Two sequential buy_bonds transactions accumulate correctly.
#[test]
fn test_buy_bonds_e2e_sequential_buys() {
    let mut ctx = setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    send_e2e_buy_bonds(&mut ctx, 2).expect("buy 2 bonds");
    send_e2e_buy_bonds(&mut ctx, 3).expect("buy 3 bonds");

    // Total: 5 bonds = 5 USDC
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_usdc_account),
        95_000_000
    );
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 5_000_000);

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 5_000_000);

    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    assert_eq!(pending, 5);

    // Verify user entry
    let winnings = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    let entry_idx = winnings.registry_entry_index;
    assert_ne!(entry_idx, u32::MAX);
    let entry = read_registry_entry(&ctx.svm, ctx.ticket_registry, entry_idx as usize);
    assert_eq!(entry.owner, ctx.user.pubkey());
    assert_eq!(entry.active, 0);
    assert_eq!(entry.pending, 5);
}

/// E2E test verifying multiple users can buy bonds.
#[test]
fn test_buy_bonds_e2e_multiple_users() {
    let mut ctx = setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    // Create User 2
    let user2 = Keypair::new();
    ctx.svm.airdrop(&user2.pubkey(), 50_000_000_000).unwrap();
    let user2_usdc =
        create_spl_token_account(&mut ctx.svm, &user2, &ctx.usdc_mint, &user2.pubkey());
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user2_usdc,
        &ctx.usdc_mint_authority,
        100_000_000,
    );

    // User 1 buys 2 bonds
    send_e2e_buy_bonds(&mut ctx, 2).expect("User 1 buying 2 bonds should succeed");

    // User 2 buys 3 bonds
    send_e2e_buy_bonds_for_user(&mut ctx, &user2, user2_usdc, 3, Pubkey::default())
        .expect("User 2 buying 3 bonds should succeed");

    // User 1 buys 1 more bond
    send_e2e_buy_bonds(&mut ctx, 1).expect("User 1 buying 1 more bond should succeed");

    // User 2 buys 1 more bond
    send_e2e_buy_bonds_for_user(&mut ctx, &user2, user2_usdc, 1, Pubkey::default())
        .expect("User 2 buying 1 more bond should succeed");

    // Total pending tickets count should be 7
    let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    assert_eq!(pending, 7);

    // Verify User 1 entry
    let winnings1 = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    let entry_idx1 = winnings1.registry_entry_index;
    let entry1 = read_registry_entry(&ctx.svm, ctx.ticket_registry, entry_idx1 as usize);
    assert_eq!(entry1.owner, ctx.user.pubkey());
    assert_eq!(entry1.active, 0);
    assert_eq!(entry1.pending, 3); // 2 + 1

    // Verify User 2 entry
    let winnings2 = read_user_winnings_state(&ctx.svm, 1, &user2.pubkey());
    let entry_idx2 = winnings2.registry_entry_index;
    let entry2 = read_registry_entry(&ctx.svm, ctx.ticket_registry, entry_idx2 as usize);
    assert_eq!(entry2.owner, user2.pubkey());
    assert_eq!(entry2.active, 0);
    assert_eq!(entry2.pending, 4); // 3 + 1

    // Verify balances
    assert_eq!(
        read_token_balance(&ctx.svm, ctx.user_usdc_account),
        97_000_000
    );
    assert_eq!(read_token_balance(&ctx.svm, user2_usdc), 96_000_000);
    assert_eq!(read_token_balance(&ctx.svm, pool_pst_vault), 7_000_000);
}

/// Buying bonds when the registry does not have enough slots remaining must fail.
#[test]
fn test_buy_bonds_fails_registry_full() {
    let mut ctx = setup_e2e();

    // The default setup_e2e creates a pool with REGISTRY_INITIAL_SIZE capacity.
    // To trigger RegistryFull efficiently, we manually inject a small registry of capacity 2.
    let small_registry = Keypair::new().pubkey();
    {
        let mut data = vec![0u8; 104 + 2 * 64]; // Header size (104) + 2 UserEntry (64)
        data[0..8].copy_from_slice(&[58, 169, 167, 230, 107, 202, 126, 54]); // Discriminator
        data[8..12].copy_from_slice(&1u32.to_le_bytes()); // pool_id
        data[12..16].copy_from_slice(&2u32.to_le_bytes()); // capacity = 2
        data[16..20].copy_from_slice(&0u32.to_le_bytes()); // user_count = 0
        data[20..24].copy_from_slice(&0u32.to_le_bytes()); // total_active_tickets = 0
        data[24..28].copy_from_slice(&0u32.to_le_bytes()); // total_pending_tickets = 0
        data[28..32].copy_from_slice(&0u32.to_le_bytes()); // draw_cycle_id = 0
        data[32..36].copy_from_slice(&0u32.to_le_bytes()); // draw_prepared_up_to = 0
        data[36] = anchor::state::TicketRegistry::CURRENT_VERSION;

        ctx.svm
            .set_account(
                small_registry,
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

    // Point the prize pool state to our new small registry
    let (pool_pda, _bump) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.ticket_registry = small_registry;

    use anchor_lang::Discriminator;
    let mut serialized_pool = vec![];
    serialized_pool.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    serialized_pool.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda,
            Account {
                lamports: 1_000_000_000,
                data: serialized_pool,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    ctx.ticket_registry = small_registry;

    // User 1 buys 1 bond (succeeds)
    send_e2e_buy_bonds(&mut ctx, 1).expect("User 1 buy should succeed");

    // User 2 buys 1 bond (succeeds)
    let user2 = Keypair::new();
    ctx.svm.airdrop(&user2.pubkey(), 50_000_000_000).unwrap();
    let user2_usdc =
        create_spl_token_account(&mut ctx.svm, &user2, &ctx.usdc_mint, &user2.pubkey());
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user2_usdc,
        &ctx.usdc_mint_authority,
        100_000_000,
    );
    send_e2e_buy_bonds_for_user(&mut ctx, &user2, user2_usdc, 1, Pubkey::default())
        .expect("User 2 buy should succeed");

    // User 3 tries to buy 1 bond (fails because capacity is 2 and user_count is 2)
    let user3 = Keypair::new();
    ctx.svm.airdrop(&user3.pubkey(), 50_000_000_000).unwrap();
    let user3_usdc =
        create_spl_token_account(&mut ctx.svm, &user3, &ctx.usdc_mint, &user3.pubkey());
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user3_usdc,
        &ctx.usdc_mint_authority,
        100_000_000,
    );
    let err = send_e2e_buy_bonds_for_user(&mut ctx, &user3, user3_usdc, 1, Pubkey::default())
        .unwrap_err();
    assert!(
        err.contains("RegistryFull"),
        "Expected RegistryFull, got: {err}"
    );
}

/// Passing a ticket registry account that doesn't match pool.ticket_registry must fail.
#[test]
fn test_buy_bonds_fails_invalid_registry_has_one() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 1000, 0, 0);
    let fake_registry = Keypair::new().pubkey();
    inject_registry(&mut ctx.svm, fake_registry, 1, 10, 0, 0);

    let ix = build_buy_bonds_ix(
        ctx.user.pubkey(),
        1,
        ctx.token_mint,
        ctx.pst_mint,
        ctx.user_token_account,
        fake_registry, // Invalid registry address
        ctx.huma_pool_state,
        1,
    );

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");

    assert!(
        err_str.contains("ConstraintHasOne") || err_str.contains("Raw"),
        "Expected ConstraintHasOne error, got: {err_str}"
    );
}

/// Passing an invalid token mint must fail.
#[test]
fn test_buy_bonds_fails_invalid_token_mint() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 1000, 0, 0);
    let fake_mint = Keypair::new().pubkey();
    inject_mint(&mut ctx.svm, fake_mint, 6);

    let ix = build_buy_bonds_ix(
        ctx.user.pubkey(),
        1,
        fake_mint, // Invalid token mint
        ctx.pst_mint,
        ctx.user_token_account,
        ctx.ticket_registry,
        ctx.huma_pool_state,
        1,
    );

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");

    assert!(
        err_str.contains("ConstraintRaw")
            || err_str.contains("ConstraintAddress")
            || err_str.contains("ConstraintTokenMint")
            || err_str.contains("Raw"),
        "Expected address constraint violation, got: {err_str}"
    );
}

/// Attempting to use an incorrect program address for the Huma program constraint must fail.
#[test]
fn test_buy_bonds_fails_invalid_huma_program() {
    let mut ctx = setup_buy_bonds(anchor::PoolStatus::Active, false, 1000, 0, 0);
    let (pool, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let dummy = Keypair::new().pubkey();
    let fake_huma = Keypair::new().pubkey(); // Random key instead of Huma program ID

    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool,
        ticket_registry: ctx.ticket_registry,
        user_token_account: ctx.user_token_account,
        token_mint: ctx.token_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: fake_huma, // Mismatched huma_program address
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: dummy,
        huma_pool_authority: dummy,
        huma_pool_underlying_token: dummy,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds { tickets_to_buy: 1 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");

    assert!(
        err_str.contains("ConstraintAddress") || err_str.contains("Raw"),
        "Expected ConstraintAddress for huma_program, got: {err_str}"
    );
}

/// Buying bonds when the user does not have enough token balance must fail.
#[test]
fn test_buy_bonds_fails_insufficient_user_balance() {
    let mut ctx = setup_e2e();

    // Create a new user with 0 USDC balance
    let poor_user = Keypair::new();
    ctx.svm
        .airdrop(&poor_user.pubkey(), 10_000_000_000)
        .unwrap();
    let poor_user_token_account = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &poor_user.pubkey(),
    );

    // Try to buy 1 bond (costs 1 USDC = 1_000_000 lamports)
    let err = send_e2e_buy_bonds_for_user(
        &mut ctx,
        &poor_user,
        poor_user_token_account,
        1,
        Pubkey::default(),
    )
    .unwrap_err();

    assert!(
        err.contains("InsufficientFunds")
            || err.contains("0x1")
            || err.contains("InstructionError"),
        "Expected token transfer failure due to insufficient funds, got: {err}"
    );
}

/// Buying bonds should fail if the Huma Finance CPI deposit call fails.
#[test]
fn test_buy_bonds_fails_huma_deposit_error() {
    let mut ctx = setup_e2e();

    let bytes = ctx.user.to_bytes();
    let mut secret = [0u8; 32];
    secret.copy_from_slice(&bytes[0..32]);
    let user = Keypair::new_from_array(secret);

    // Try to buy 1 bond using the FAIL_DEPOSIT_PUBKEY as huma_config.
    let user_usdc = ctx.user_usdc_account;
    let err = send_e2e_buy_bonds_for_user(&mut ctx, &user, user_usdc, 1, FAIL_DEPOSIT_PUBKEY)
        .unwrap_err();

    assert!(
        err.contains("SimulatedDepositFailure") || err.contains("6000") || err.contains("0x1770"),
        "Expected SimulatedDepositFailure (6000 or 0x1770), got: {err}"
    );
}

/// E2E test verifying that buying bonds initializes the `UserWinnings` account correctly.
#[test]
fn test_buy_bonds_initializes_user_winnings() {
    let mut ctx = setup_e2e();

    // Before: user_winnings account should not exist
    let (user_winnings_pda, _) = user_winnings_pda(1, &ctx.user.pubkey());
    assert!(ctx.svm.get_account(&user_winnings_pda).is_none());

    let meta = send_e2e_buy_bonds(&mut ctx, 1).expect("buy 1 bond should succeed");
    let event = assert_cpi_event::<anchor::events::BondsPurchased>(&meta);
    assert_eq!(event.user, ctx.user.pubkey());
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.bonds, 1);
    assert_eq!(event.amount, 1_000_000);
    assert_eq!(event.new_total_deposited_principal, 1_000_000);
    assert_eq!(event.user_total_bonds, 1);
    assert!(event.timestamp > 0);

    // After: user_winnings account should exist and be initialized
    let winnings = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(winnings.pool_id, 1);
    assert_eq!(winnings.user, ctx.user.pubkey());
    assert_eq!(winnings.unclaimed_non_reinvested_winnings, 0);
    assert_eq!(winnings.total_claimed, 0);
    assert_eq!(winnings.total_reinvested, 0);
}

#[test]
fn test_buy_bonds_fails_invalid_user_entry_hint() {
    let mut ctx = setup_e2e();

    let other_user = Keypair::new().pubkey();
    let entries = vec![anchor::state::UserEntry {
        owner: other_user,
        active: 1,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];
    common::inject_registry_with_entries(&mut ctx.svm, ctx.ticket_registry, 1, 1000, &entries);

    let mut seed = [0u8; 32];
    seed.copy_from_slice(&ctx.user.to_bytes()[..32]);
    let user = Keypair::new_from_array(seed);

    common::inject_user_winnings_with_index(&mut ctx.svm, 1, user.pubkey(), 0, 0, 0, 0);

    let user_usdc = ctx.user_usdc_account;
    let err =
        send_e2e_buy_bonds_for_user(&mut ctx, &user, user_usdc, 1, Pubkey::default()).unwrap_err();
    assert!(
        err.contains("InvalidUserEntryHint"),
        "Expected InvalidUserEntryHint, got: {err}"
    );
}

#[test]
fn test_buy_bonds_fails_math_overflow() {
    let mut ctx = setup_e2e();
    // Inject registry with u32::MAX pending tickets to trigger overflow on addition
    common::inject_registry(&mut ctx.svm, ctx.ticket_registry, 1, 1000, 0, u32::MAX);

    let err = send_e2e_buy_bonds(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("MathOverflow") || err.contains("0x177c"),
        "Expected MathOverflow, got: {err}"
    );
}

/// An existing user with an assigned registry entry can buy more bonds even when user_count == capacity.
#[test]
fn test_buy_bonds_existing_user_succeeds_at_max_capacity() {
    let mut ctx = setup_e2e();
    let user_pubkey = ctx.user.pubkey();

    // 1. Initial purchase creates a slot in registry
    send_e2e_buy_bonds(&mut ctx, 1).expect("initial buy 1 bond should succeed");

    // 2. Artificially set capacity = 1 on the registry account data so user_count (1) == capacity (1)
    let mut account = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    account.data[12..16].copy_from_slice(&1u32.to_le_bytes());
    ctx.svm.set_account(ctx.ticket_registry, account).unwrap();

    // 3. Existing user buying more bonds should succeed because needs_slot is false
    send_e2e_buy_bonds(&mut ctx, 2)
        .expect("existing user should be able to buy bonds when capacity is full");

    let winnings = read_user_winnings_state(&ctx.svm, 1, &user_pubkey);
    let entry = read_registry_entry(
        &ctx.svm,
        ctx.ticket_registry,
        winnings.registry_entry_index as usize,
    );
    assert_eq!(entry.owner, user_pubkey);
    assert_eq!(entry.pending, 3); // 1 + 2
}

/// A re-entering user (has user_winnings with UNASSIGNED_ENTRY_INDEX) successfully acquires a new registry slot
/// and preserves historical claimed/reinvested winnings.
#[test]
fn test_buy_bonds_reentering_user_succeeds_e2e() {
    let mut ctx = setup_e2e();
    let user_pubkey = ctx.user.pubkey();

    // Inject user_winnings with historical data and UNASSIGNED_ENTRY_INDEX
    common::inject_user_winnings_with_index(
        &mut ctx.svm,
        1,
        user_pubkey,
        50_000,
        200_000,
        100_000,
        anchor::state::UserWinnings::UNASSIGNED_ENTRY_INDEX,
    );

    send_e2e_buy_bonds(&mut ctx, 3).expect("re-entering user buy 3 bonds should succeed");

    let winnings = read_user_winnings_state(&ctx.svm, 1, &user_pubkey);
    assert_ne!(
        winnings.registry_entry_index,
        anchor::state::UserWinnings::UNASSIGNED_ENTRY_INDEX
    );
    assert_eq!(winnings.unclaimed_non_reinvested_winnings, 50_000);
    assert_eq!(winnings.total_claimed, 200_000);
    assert_eq!(winnings.total_reinvested, 100_000);

    let entry = read_registry_entry(
        &ctx.svm,
        ctx.ticket_registry,
        winnings.registry_entry_index as usize,
    );
    assert_eq!(entry.owner, user_pubkey);
    assert_eq!(entry.pending, 3);
}

/// MTR-003: Multi-User Deposit Commutativity
/// Verifies that the order of user bond purchases produces identical global aggregates,
/// principal values, PST vault balances, and user-level ticket mass.
#[test]
fn test_mtr003_deposit_order_commutativity() {
    struct RunResult {
        total_pending: u32,
        total_principal: u64,
        user_count: u32,
        pst_vault_balance: u64,
        alice_pending: u32,
        bob_pending: u32,
    }

    let execute_run = |alice_first: bool| -> RunResult {
        let mut ctx = setup_e2e();

        let alice = Keypair::new();
        ctx.svm.airdrop(&alice.pubkey(), 10_000_000_000).unwrap();
        let alice_usdc =
            create_spl_token_account(&mut ctx.svm, &alice, &ctx.usdc_mint, &alice.pubkey());
        mint_tokens(
            &mut ctx.svm,
            &ctx.admin,
            &ctx.usdc_mint,
            &alice_usdc,
            &ctx.usdc_mint_authority,
            100_000_000,
        );

        let bob = Keypair::new();
        ctx.svm.airdrop(&bob.pubkey(), 10_000_000_000).unwrap();
        let bob_usdc =
            create_spl_token_account(&mut ctx.svm, &bob, &ctx.usdc_mint, &bob.pubkey());
        mint_tokens(
            &mut ctx.svm,
            &ctx.admin,
            &ctx.usdc_mint,
            &bob_usdc,
            &ctx.usdc_mint_authority,
            100_000_000,
        );

        if alice_first {
            send_e2e_buy_bonds_for_user(&mut ctx, &alice, alice_usdc, 5, Pubkey::default())
                .expect("Alice buy");
            send_e2e_buy_bonds_for_user(&mut ctx, &bob, bob_usdc, 3, Pubkey::default())
                .expect("Bob buy");
        } else {
            send_e2e_buy_bonds_for_user(&mut ctx, &bob, bob_usdc, 3, Pubkey::default())
                .expect("Bob buy");
            send_e2e_buy_bonds_for_user(&mut ctx, &alice, alice_usdc, 5, Pubkey::default())
                .expect("Alice buy");
        }

        let pool = read_pool_state(&ctx.svm, 1);
        let pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
        let (pool_pst_vault, _) = pool_pst_vault_pda(1);
        let pst_balance = read_token_balance(&ctx.svm, pool_pst_vault);

        let reg_acc = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
        let user_count = u32::from_le_bytes(reg_acc.data[16..20].try_into().unwrap());

        let alice_winnings = read_user_winnings_state(&ctx.svm, 1, &alice.pubkey());
        let alice_entry = read_registry_entry(
            &ctx.svm,
            ctx.ticket_registry,
            alice_winnings.registry_entry_index as usize,
        );

        let bob_winnings = read_user_winnings_state(&ctx.svm, 1, &bob.pubkey());
        let bob_entry = read_registry_entry(
            &ctx.svm,
            ctx.ticket_registry,
            bob_winnings.registry_entry_index as usize,
        );

        RunResult {
            total_pending: pending,
            total_principal: pool.total_deposited_principal,
            user_count,
            pst_vault_balance: pst_balance,
            alice_pending: alice_entry.pending,
            bob_pending: bob_entry.pending,
        }
    };

    let result_a = execute_run(true); // Alice (5) -> Bob (3)
    let result_b = execute_run(false); // Bob (3) -> Alice (5)

    // Metamorphic Invariance: Global aggregates must be perfectly commutative
    assert_eq!(result_a.total_pending, 8);
    assert_eq!(result_b.total_pending, 8);
    assert_eq!(
        result_a.total_pending, result_b.total_pending,
        "MTR-003 broken: total_pending differs"
    );
    assert_eq!(result_a.total_principal, 8_000_000);
    assert_eq!(result_b.total_principal, 8_000_000);
    assert_eq!(
        result_a.total_principal, result_b.total_principal,
        "MTR-003 broken: total_principal differs"
    );
    assert_eq!(result_a.user_count, 2);
    assert_eq!(result_b.user_count, 2);
    assert_eq!(
        result_a.pst_vault_balance, result_b.pst_vault_balance,
        "MTR-003 broken: PST balance differs"
    );
    assert_eq!(result_a.alice_pending, 5);
    assert_eq!(result_b.alice_pending, 5);
    assert_eq!(result_a.bob_pending, 3);
    assert_eq!(result_b.bob_pending, 3);
}

