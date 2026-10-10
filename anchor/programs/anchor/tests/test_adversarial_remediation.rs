//! Comprehensive test suite for adversarial security hardening remediations:
//! - SEC-01: Huma State Pinning & Venue Integrity
//! - SEC-03: Unified Full Liabilities Solvency Guards & Anti-Bank Run Ordering
//! - SEC-05: Supported Mint Extensions Whitelist Filter
//!
//! Run with:
//!   NO_DNA=1 cargo test --test test_adversarial_remediation -- --nocapture

use {
    anchor::error::PremiumBondsError,
    anchor_lang::{Discriminator, InstructionData, Space, ToAccountMetas},
    anchor_spl::token_2022::spl_token_2022::extension::{
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::{account::Account, signature::Signer},
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

// ═══════════════════════════════════════════════════════════════════════════
// SEC-01: Huma State Pinning Spoofing Defense
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_buy_bonds_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let ix = BuyBondsBuilder::new(&ctx)
        .with_huma_pool_state(spoofed_huma_state)
        .build_ix(10);
    let res = send_user_tx(&mut ctx.svm, &ctx.user, ix);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_harvest_yield_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut ctx.svm, randomness_account);

    let ix = HarvestYieldAndCommitBuilder::new(&ctx)
        .with_huma_pool_state(spoofed_huma_state)
        .with_randomness_account(randomness_account)
        .build_ix();
    let res = send_user_tx(&mut ctx.svm, &ctx.admin, ix);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_initialize_huma_lender_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let ix =
        InitializeHumaLenderBuilder::new(ctx.admin.pubkey(), 1, spoofed_huma_state, ctx.pst_mint)
            .build_ix();
    let res = send_user_tx(&mut ctx.svm, &ctx.admin, ix);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEC-03: Unified Full Liabilities Solvency Guards
// ═══════════════════════════════════════════════════════════════════════════



#[test]
fn test_solvency_dust_tolerance_boundary() {
    let mut pool = PrizePoolTestBuilder::new(1)
        .with_principal(10_000_000)
        .build();
    pool.total_fees_accrued = 1_000_000;
    pool.total_fees_withdrawn = 0;
    pool.total_prizes_allocated = 5_000_000;
    // Book value = 10M + 1M + 5M = 16,000,000

    // Tolerance on 16M book value at 1 bps is 1,600, clamped to MIN_SOLVENCY_TOLERANCE (10_000)
    let tolerance = pool.calculate_solvency_tolerance(16_000_000).unwrap();
    assert_eq!(tolerance, 10_000);

    // Deficit of tolerance (current_value = 16_000_000 - tolerance) -> within tolerance -> OK
    pool.assert_solvent(16_000_000 - tolerance)
        .expect("Deficit within tolerance must be accepted");

    // Deficit of tolerance + 1 -> exceeds tolerance -> error
    assert_eq!(
        pool.assert_solvent(16_000_000 - (tolerance + 1)).unwrap_err(),
        PremiumBondsError::YieldVenueInsolvent.into()
    );
}



// ═══════════════════════════════════════════════════════════════════════════
// SEC-05: Token Extension Whitelist Filter Tests
// ═══════════════════════════════════════════════════════════════════════════

fn assert_create_pool_rejects_extension(
    extension: ExtensionType,
    expected_error: PremiumBondsError,
) {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let mint = Keypair::new().pubkey();
    inject_token_2022_mint(&mut svm, mint, 6, Some(extension));

    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_2022_account(&mut svm, fee_wallet, mint, admin.pubkey(), 0);

    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token_2022::ID,
        anchor_spl::token::ID,
    );

    let res = send_user_tx(&mut svm, &admin, ix);
    assert_custom_error(res, expected_error);
}

#[test]
fn test_create_pool_rejects_transfer_fee_mint() {
    assert_create_pool_rejects_extension(
        ExtensionType::TransferFeeConfig,
        PremiumBondsError::TransferFeeNotSupported,
    );
}

#[test]
fn test_create_pool_rejects_transfer_hook_mint() {
    assert_create_pool_rejects_extension(
        ExtensionType::TransferHook,
        PremiumBondsError::TransferHookNotSupported,
    );
}

#[test]
fn test_create_pool_rejects_permanent_delegate_mint() {
    assert_create_pool_rejects_extension(
        ExtensionType::PermanentDelegate,
        PremiumBondsError::InvalidTokenMint,
    );
}

#[test]
fn test_create_pool_rejects_mint_close_authority_mint() {
    assert_create_pool_rejects_extension(
        ExtensionType::MintCloseAuthority,
        PremiumBondsError::InvalidTokenMint,
    );
}

#[test]
fn test_create_pool_rejects_uninitialized_huma_pool_state() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);

    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Huma pool state owned by Huma program but uninitialized / empty data (vec_len = 0)
    let bad_huma_state = Keypair::new().pubkey();
    svm.set_account(
        bad_huma_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 100], // vec_len at offset 26 is 0
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = build_create_pool_instruction(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        token_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        bad_huma_state,
    );

    let res = send_user_tx(&mut svm, &admin, ix);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolData);
}

#[test]
fn test_create_pool_accepts_standard_spl_and_token_2022() {
    let (mut svm, admin) = setup_global_config();

    // 1. Standard SPL mint
    let usdc_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, usdc_mint, 6);

    // 2. Clean Token-2022 mint without forbidden extensions
    let pst_mint = Keypair::new().pubkey();
    inject_token_2022_mint(&mut svm, pst_mint, 6, None);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, usdc_mint, admin.pubkey(), 0);

    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        1,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        usdc_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token::ID,
        anchor_spl::token_2022::ID,
    );

    let res = send_user_tx(&mut svm, &admin, ix);
    assert!(
        res.is_ok(),
        "Clean Token-2022 and SPL mints should succeed: {res:?}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAL 7-VECTOR EFFICIENCY, SOLVENCY & REALLOC INVARIANT TEST MATRIX
// ═══════════════════════════════════════════════════════════════════════════

// ─── Vector 1: Value & Boundary Extremes ───────────────────────────────────

#[test]
fn test_v1_sell_bonds_rejects_zero_quantity() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let res = SellBondsBuilder::new(&ctx)
        .with_shares(0, 0)
        .send(&mut ctx.svm, &ctx.user);
    assert_custom_error(res, PremiumBondsError::InvalidBondQuantity);
}

#[test]
fn test_v1_sell_bonds_dust_single_bond() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // Sell exactly 1 dust bond (pending)
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .expect("Dust bond sale should succeed");

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 9_000_000);
    assert_eq!(pool.total_pending_redemptions, 1_000_000);
    assert_eq!(pool.next_redemption_id, 1);

    let pending = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(pending.amount, 1_000_000);
    assert_eq!(pending.user, user_a.pubkey());
}

#[test]
fn test_v1_registry_full_rejects_new_buyer_allows_existing_topup() {
    let mut ctx = setup_e2e();

    // Inject small registry with capacity = 2 for pool 1
    let small_registry = Keypair::new().pubkey();
    inject_registry_with_entries(&mut ctx.svm, small_registry, 1, 2, &[]);

    // Update pool.ticket_registry = small_registry
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_ticket_registry(small_registry)
        .inject(&mut ctx.svm);
    ctx.ticket_registry = small_registry;

    // Helper to buy bonds for a user
    let buy_for_user = |ctx: &mut E2eContext, user: &Keypair, tickets: u32| {
        ctx.svm.expire_blockhash();
        let user_token =
            create_spl_token_account(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &user.pubkey());
        mint_tokens(
            &mut ctx.svm,
            &ctx.admin,
            &ctx.usdc_mint,
            &user_token,
            &ctx.usdc_mint_authority,
            (tickets as u64) * 1_000_000,
        );

        let ix = BuyBondsBuilder::new(ctx)
            .with_user(&user.pubkey(), user_token)
            .with_ticket_registry(ctx.ticket_registry)
            .build_ix(tickets);
        send_user_tx(&mut ctx.svm, user, ix)
    };

    let user_1 = Keypair::new();
    let user_2 = Keypair::new();
    let user_3 = Keypair::new();
    ctx.svm.airdrop(&user_1.pubkey(), 10_000_000_000).unwrap();
    ctx.svm.airdrop(&user_2.pubkey(), 10_000_000_000).unwrap();
    ctx.svm.airdrop(&user_3.pubkey(), 10_000_000_000).unwrap();

    // User 1 fills slot 0
    assert!(buy_for_user(&mut ctx, &user_1, 5).is_ok());
    assert_eq!(read_registry_user_count(&ctx.svm, ctx.ticket_registry), 1);

    // User 2 fills slot 1 (registry is now at capacity 2)
    assert!(buy_for_user(&mut ctx, &user_2, 3).is_ok());
    assert_eq!(read_registry_user_count(&ctx.svm, ctx.ticket_registry), 2);

    // User 3 (new user needing slot) must be rejected with RegistryFull
    let res_user_3 = buy_for_user(&mut ctx, &user_3, 1);
    assert_custom_error(res_user_3, PremiumBondsError::RegistryFull);

    // Existing User 1 (already assigned slot 0) must succeed on top-up
    let res_user_1_topup = buy_for_user(&mut ctx, &user_1, 2);
    assert!(
        res_user_1_topup.is_ok(),
        "Existing user top-up should succeed even at full capacity"
    );
    let entry_1 = read_registry_entry(&ctx.svm, ctx.ticket_registry, 0);
    assert_eq!(entry_1.pending, 7); // 5 + 2
    assert_eq!(read_registry_user_count(&ctx.svm, ctx.ticket_registry), 2);
}

// ─── Vector 2: State Lifecycle & Fail-Fast ─────────────────────────────────

#[test]
fn test_v2_sell_bonds_fail_fast_on_paused_pool_with_spoofed_huma() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Pause the pool
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_status(anchor::PoolStatus::Paused)
        .inject(&mut ctx.svm);

    let res = SellBondsBuilder::new(&ctx)
        .with_shares(1, 0)
        .send(&mut ctx.svm, &ctx.user);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

#[test]
fn test_v2_claim_winnings_fail_fast_on_frozen_pool() {
    let mut ctx = setup_e2e();

    // Inject claimable winnings for user
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 1_000_000, 0, 0);

    // Freeze pool for draw
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_frozen(true)
        .with_prizes_allocated(1_000_000)
        .inject(&mut ctx.svm);

    let res = ClaimNonReinvestedWinningsBuilder::new(&ctx).send(&mut ctx.svm, &ctx.user);
    assert_custom_error(res, PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_v2_withdraw_fees_fail_fast_on_paused_pool() {
    let mut ctx = setup_e2e();

    let fee_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    // Pause pool and set accrued fees
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_status(anchor::PoolStatus::Paused)
        .with_fees_accrued(1_000_000)
        .with_fee_wallet(fee_wallet)
        .inject(&mut ctx.svm);

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_fee_wallet(fee_wallet)
        .with_amount(500_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

// ─── Vector 3: Access Control & Impersonation ──────────────────────────────

#[test]
fn test_v3_sell_bonds_rejects_unauthorized_user_entry_owner() {
    let mut ctx = setup_e2e();

    // User A buys bonds (assigned slot 0)
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Attacker User B creates user_winnings pointing to slot 0 (User A's slot)
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    inject_user_winnings_with_index(&mut ctx.svm, 1, attacker.pubkey(), 0, 0, 0, 0); // entry_index = 0

    let (attacker_winnings, _) = user_winnings_pda(1, &attacker.pubkey());

    let res = SellBondsBuilder::new(&ctx)
        .with_user(&attacker.pubkey())
        .with_user_winnings(attacker_winnings)
        .with_shares(0, 5)
        .send(&mut ctx.svm, &attacker);
    assert_custom_error(res, PremiumBondsError::InvalidUserEntryHint);
}

#[test]
fn test_v3_withdraw_fees_rejects_unauthorized_signer() {
    let mut ctx = setup_e2e();
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_admin(attacker.pubkey())
        .with_amount(100_000)
        .send(&mut ctx.svm, &attacker);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

// ─── Vector 4: Financial Math & Zero-Mutation Invariance ───────────────────


// ─── Vector 5: Account Closure & Realloc Safety ────────────────────────────

#[test]
fn test_v5_pending_redemption_exact_rent_refund_and_closure() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund underlying token vault for disburse
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // Sell 3 bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    let pending_acc = ctx
        .svm
        .get_account(&pending_redemption_key)
        .expect("PendingRedemption must exist");
    // Verify exact 160 bytes layout (8-byte discriminator + 152-byte INIT_SPACE)
    assert_eq!(
        pending_acc.data.len(),
        8 + anchor::state::PendingRedemption::INIT_SPACE,
        "PendingRedemption must be exactly 160 bytes"
    );
    let rent_lamports = pending_acc.lamports;

    // Settle Huma redemption
    let huma_lender_state = Keypair::new().pubkey();
    inject_redemption_batch_with_state(
        &mut ctx.svm,
        1,
        0,
        anchor::state::RedemptionBatchStatus::Settled,
        3_000_000,
        3_000_000,
    );

    // Fund pool_vault with 3_000_000 USDC
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pda_addr, _) = pool_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_vault,
        ctx.usdc_mint,
        pool_pda_addr,
        10_000_000,
    );

    let user_balance_before = ctx.svm.get_account(&user_a.pubkey()).unwrap().lamports;

    // Claim redemption
    ClaimRedemptionBuilder::new(&ctx)
        .with_pending_redemption(pending_redemption_key)
        .with_beneficiary_token_account(ctx.user_usdc_account)
        .send(&mut ctx.svm, &user_a)
        .expect("claim redemption should succeed");

    // PendingRedemption must be closed (account is None)
    assert!(ctx.svm.get_account(&pending_redemption_key).is_none());

    // User's SOL balance must increase by rent refunded minus tx fee (5000 lamports)
    let user_balance_after = ctx.svm.get_account(&user_a.pubkey()).unwrap().lamports;
    assert_eq!(
        user_balance_after + 5000 - user_balance_before,
        rent_lamports
    );
}

#[test]
fn test_v5_ticket_registry_trailing_bytes_rejected() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Corrupt ticket registry account data by appending 1 trailing byte
    let mut reg_acc = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    reg_acc.data.push(0xAA);
    ctx.svm.set_account(ctx.ticket_registry, reg_acc).unwrap();

    // Attempt sell_bonds -> must fail with InvalidRegistryState
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );
    let user_a = clone_keypair(&ctx.user);
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidRegistryState);
}

// ─── Vector 6: Time & Sysvar Boundaries ────────────────────────────────────

#[test]
fn test_v6_reinvest_winnings_enforces_payout_timelock() {
    let (mut svm, _admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    let crank = Keypair::new();
    let winner = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    inject_mint(&mut svm, token_mint, 6);
    inject_token_2022_mint(&mut svm, pst_mint, 6, None);

    let ticket_registry = Keypair::new().pubkey();
    let entries = [UserEntryTestBuilder::new()
        .with_owner(winner.pubkey())
        .with_active(10)
        .build()];
    inject_registry_with_entries(&mut svm, ticket_registry, pool_id, 100, &entries);

    let (_pool_pda_addr, _) = pool_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &winner.pubkey());
    let (payout_reg, _) = payout_pda(pool_id, 0);

    // Initialize pool with 3600 seconds payout timelock
    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_prizes_allocated(10_000_000)
        .with_payout_timelock_seconds(3600)
        .inject(&mut svm);

    // Initialize completed draw cycle
    DrawCycleTestBuilder::new(pool_id, 0)
        .with_status(anchor::DrawStatus::Complete)
        .inject(&mut svm);

    PayoutRegistryTestBuilder::new(pool_id, 0)
        .with_winners(vec![WinnerTestBuilder::default_winner(
            winner.pubkey(),
            1_000_000,
            0,
        )])
        .with_status(anchor::PayoutRegistryStatus::Active)
        .inject(&mut svm);
    inject_user_winnings_with_index(&mut svm, pool_id, winner.pubkey(), 0, 0, 0, 0);

    // 1. Clock timestamp = 1_700_002_000 (< 1_700_000_000 + 3600 = 1_700_003_600) -> fails with PayoutTimelockActive
    warp_to_timestamp(&mut svm, 1_700_002_000);

    let res = ReinvestWinningsBuilder::for_pool(pool_id, 0, crank.pubkey())
        .with_winner(&winner.pubkey())
        .with_payout_registry(payout_reg)
        .with_user_winnings(user_winnings)
        .with_ticket_registry(ticket_registry)
        .send(&mut svm, &crank);
    assert_custom_error(res, PremiumBondsError::PayoutTimelockActive);

    // 2. Advance clock timestamp to 1_700_003_601 (>= 1_700_003_600) -> succeeds!
    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    warp_to_timestamp(&mut svm, 1_700_003_601);

    let res2 = ReinvestWinningsBuilder::for_pool(pool_id, 0, crank2.pubkey())
        .with_winner(&winner.pubkey())
        .with_payout_registry(payout_reg)
        .with_user_winnings(user_winnings)
        .with_ticket_registry(ticket_registry)
        .send(&mut svm, &crank2);
    assert!(
        res2.is_ok(),
        "Reinvesting after timelock expiration must succeed: {res2:?}"
    );
}

// ─── Vector 7: CPI & Reentrancy Rollback Atomicity ─────────────────────────



#[test]
fn test_v4_buy_bonds_zero_share_inflation_guard() {
    let mut ctx = setup_e2e();
    let initial_vault_amount = read_token_balance(&ctx.svm, pool_pst_vault_pda(1).0);
    assert_eq!(initial_vault_amount, 0);

    let user_a = clone_keypair(&ctx.user);

    let res = BuyBondsBuilder::new(&ctx)
        .with_huma_config(FAIL_ZERO_SHARES_PUBKEY)
        .with_tickets(10)
        .send(&mut ctx.svm, &user_a);
    assert_custom_error(res, PremiumBondsError::ZeroSharesMinted);

    let post_vault_amount = read_token_balance(&ctx.svm, pool_pst_vault_pda(1).0);
    assert_eq!(
        post_vault_amount, 0,
        "Vault PST balance must remain 0 when zero shares minted error is thrown"
    );

    // Normal deposit succeeds
    let ok_res = send_e2e_buy_bonds(&mut ctx, 10);
    assert!(ok_res.is_ok(), "Normal buy_bonds must succeed: {ok_res:?}");

    let final_vault_amount = read_token_balance(&ctx.svm, pool_pst_vault_pda(1).0);
    assert_eq!(
        final_vault_amount, 10_000_000,
        "10 bonds = 10,000,000 PST shares"
    );

    // ZeroSharesMinted error definition and code verification
    let err = PremiumBondsError::ZeroSharesMinted;
    assert_eq!(format!("{err:?}"), "ZeroSharesMinted");
    assert_eq!((err as u32) + anchor_lang::error::ERROR_CODE_OFFSET, 6046);
}

#[test]
fn test_v4_terminal_share_clamping_all_exits() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Buy 10 bonds = 10 USDC = 10_000_000 base units
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // Terminal sell: sell all 10 bonds -> pool.calculate_book_value() becomes 0
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        10,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert!(
        res.is_ok(),
        "Terminal bond sale with book value 0 must clamp shares and succeed: {res:?}"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 0);
    // In batch model, accumulating redemptions preserve book liabilities until batch is submitted
    assert_eq!(pool.total_accumulating_redemptions, 10_000_000);
    assert_eq!(pool.calculate_book_value().unwrap(), 10_000_000);
}

#[test]
fn test_v4_terminal_share_clamping_withdraw_fees() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    let fee_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);

    // Set pool state to 0 principal, 0 prizes allocated, 5 USDC accrued fees
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_solvency_state(0, 0, 5_000_000)
        .with_fees_withdrawn(0)
        .with_fee_wallet(fee_wallet)
        .inject(&mut ctx.svm);

    // Inject pool_pst_vault with 5_000_000 PST tokens
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_addr,
        5_000_000,
    );

    // Set 1:1 Huma solvency
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        5_000_000,
        5_000_000,
    );

    let res = WithdrawFeesBuilder::new(&ctx)
        .with_fee_wallet(fee_wallet)
        .with_amount(5_000_000)
        .send(&mut ctx.svm, &ctx.admin);
    assert!(
        res.is_ok(),
        "Terminal fee withdrawal with book value 0 must clamp shares and succeed: {res:?}"
    );
}

#[test]
fn test_v4_terminal_share_clamping_claim_non_reinvested_winnings() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);

    // Pool has 0 principal, 0 fees, 3 USDC prizes allocated (unawarded remainder/winnings)
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_solvency_state(0, 3_000_000, 0)
        .with_fees_withdrawn(0)
        .inject(&mut ctx.svm);

    // Set user winnings to 3 USDC unclaimed
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 3_000_000, 0, 0);

    // Inject pool_pst_vault with 3_000_000 PST tokens
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_addr,
        3_000_000,
    );

    // Set 1:1 Huma solvency
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        3_000_000,
        3_000_000,
    );

    let res = ClaimNonReinvestedWinningsBuilder::new(&ctx)
        .send(&mut ctx.svm, &ctx.user);
    assert!(
        res.is_ok(),
        "Terminal prize winnings claim with book value 0 must clamp shares and succeed: {res:?}"
    );

    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(updated_pool.total_prizes_allocated, 0);
    assert_eq!(updated_pool.total_accumulating_redemptions, 3_000_000);
    assert_eq!(updated_pool.calculate_book_value().unwrap(), 3_000_000);
}

#[test]
fn test_v4_terminal_dust_clamping_claim_redemption() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // 1. Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // 2. Sell 10 bonds to create PendingRedemption for 10_000_000 USDC
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        10,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert!(res.is_ok(), "Sell bonds should succeed: {res:?}");

    // 3. Settle Huma redemption and batch
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 10_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);
    inject_redemption_batch_with_state(
        &mut ctx.svm,
        1,
        0,
        anchor::state::RedemptionBatchStatus::Settled,
        10_000_000,
        9_999_999,
    );

    // 4. Fund pool vault with 9_999_999 USDC
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pda_addr, _) = pool_pda(1);
    inject_token_account(
        &mut ctx.svm,
        pool_vault,
        ctx.usdc_mint,
        pool_pda_addr,
        9_999_999,
    );

    let user_a_usdc = ctx.user_usdc_account;
    let initial_user_balance = read_token_balance(&ctx.svm, user_a_usdc);

    let claim_res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(
        claim_res.is_ok(),
        "Claim redemption with 1 base unit deficit must clamp to available vault amount and succeed: {claim_res:?}"
    );

    let final_user_balance = read_token_balance(&ctx.svm, user_a_usdc);
    assert_eq!(
        final_user_balance,
        initial_user_balance + 9_999_999,
        "User should have received 9_999_999 USDC (clamped vault amount)"
    );

    let (pool_vault, _) = pool_vault_pda(1);
    let final_vault_balance = read_token_balance(&ctx.svm, pool_vault);
    assert_eq!(
        final_vault_balance, 0,
        "Pool vault should be completely drained"
    );
}

#[test]
fn test_v6_rebind_two_layer_anti_reroll_guard() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let cycle_id = 0;
    let vrf_seed_slot = 100;

    // Inject draw cycle awaiting randomness committed at vrf_seed_slot 100
    let current_randomness = Keypair::new().pubkey();
    let mut dc = default_draw_cycle(pool_id, cycle_id, anchor::DrawStatus::AwaitingRandomness);
    dc.vrf_seed_slot = vrf_seed_slot;
    dc.randomness_account = current_randomness;
    inject_draw_cycle(&mut ctx.svm, pool_id, cycle_id, &dc);

    // Inject Switchboard randomness account with matching seed_slot = 100
    inject_randomness_account_data(&mut ctx.svm, current_randomness, 100, 0, [0u8; 32]);

    let new_randomness = Keypair::new().pubkey();

    // Scenario 1: Clock slot = 1000.
    // clock.slot (1000) - vrf_seed_slot (100) = 900 <= 1000 -> Fails Layer 1 (RandomnessNotExpired)
    ctx.svm.warp_to_slot(1000);
    inject_mock_randomness_account(&mut ctx.svm, new_randomness);
    let ix1 = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let res1 = send_user_tx(&mut ctx.svm, &ctx.admin, ix1);
    assert_custom_error(res1, PremiumBondsError::RandomnessNotExpired);

    // Scenario 2: Clock slot = 1200, but committed account was recommitted (seed_slot = 1050 != vrf_seed_slot 100).
    // Fails Layer 2 commitment integrity (RandomnessCommitmentTampered)
    ctx.svm.warp_to_slot(1200);
    ctx.svm.expire_blockhash();
    inject_randomness_account_data(&mut ctx.svm, current_randomness, 1050, 0, [0u8; 32]);
    let fresh_seed_slot2 = 1200 - 1;
    inject_randomness_account_data(&mut ctx.svm, new_randomness, fresh_seed_slot2, 0, [0u8; 32]);
    let ix2 = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let res2 = send_user_tx(&mut ctx.svm, &ctx.admin, ix2);
    assert_custom_error(res2, PremiumBondsError::RandomnessCommitmentTampered);

    // Scenario 3: Clock slot = 1200, matching seed_slot = 100, fresh new randomness -> SUCCEEDS!
    ctx.svm.warp_to_slot(1200);
    ctx.svm.expire_blockhash();
    inject_randomness_account_data(&mut ctx.svm, current_randomness, 100, 0, [0u8; 32]);
    let ix3 = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let res3 = send_user_tx(&mut ctx.svm, &ctx.admin, ix3);
    assert!(
        res3.is_ok(),
        "Expired randomness rebind with valid commitment must succeed: {res3:?}"
    );
}
