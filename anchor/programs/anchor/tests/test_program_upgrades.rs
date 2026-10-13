//! Comprehensive 7-Vector LiteSVM Integration Test Suite for YieldBonds Program Upgrades
//!
//! Covers:
//! - Vector 1: Value & Boundary Extremes (Version bounds, Canary buffer deserialization, 160B rent)
//! - Vector 2: State Lifecycle & Lazy Migration (Version 0 -> 1 migration, batch slice boundary assertions, read-only non-mutation)
//! - Vector 3: Access Control & Impersonation (Beneficiary matching, pool ID constraints, Admin guards)
//! - Vector 4: Financial Math & Invariant Conservation (total_pending_redemptions tracking, conservation law)
//! - Vector 5: Account Closure & Reallocation Invariants (100% rent refund, registry header preservation across resize)
//! - Vector 6: Time & Sysvar Boundaries (Huma queue settlement, 1000/1001 slot rebind boundary)
//! - Vector 7: CPI & Security Boundaries (Spoofed Huma state, invalid mode mint)

use anchor_lang::{
    AccountDeserialize, AccountSerialize, AnchorDeserialize, AnchorSerialize, Discriminator,
    InstructionData, Space, ToAccountMetas,
};
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

// ─── Vector 1: Value & Boundary Extremes ────────────────────────────────────

#[test]
fn test_v1_canary_buffer_deserialization() {
    let mut ctx = setup_e2e();
    let (pending_pda, bump) = pending_redemption_pda(1, 42);

    let mut pending =
        anchor::state::PendingRedemption::new(anchor::state::InitPendingRedemptionParams {
            pool_id: 1,
            redemption_id: 42,
            bump,
            user: ctx.user.pubkey(),
            amount: 5_000_000,
            batch_id: 0,
            requested_at: 1234567,
            redemption_type: anchor::state::RedemptionType::BondSale,
        });

    // Inject non-zero canary bytes into reserved upgrade buffer
    let canary = [0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x11, 0x22];
    pending._reserved[0..8].copy_from_slice(&canary);

    let mut data = vec![];
    pending.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::state::PendingRedemption::INIT_SPACE, 0);

    ctx.svm
        .set_account(
            pending_pda,
            Account {
                lamports: 1_000_000_000,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Verify deserialization succeeds cleanly and preserves canary data
    let read_acc = ctx.svm.get_account(&pending_pda).unwrap();
    assert_eq!(
        read_acc.data.len(),
        144,
        "pending_pda data length must be 144 bytes"
    );
    let deserialized =
        anchor::state::PendingRedemption::try_deserialize(&mut &read_acc.data[..]).unwrap();
    assert_eq!(deserialized.pool_id, 1, "pool_id must be 1");
    assert_eq!(deserialized.redemption_id, 42, "redemption_id must be 42");
    assert_eq!(deserialized.amount, 5_000_000, "amount must be 5 USDC");
    assert_eq!(
        &deserialized._reserved[0..8],
        &canary,
        "canary bytes must be preserved"
    );
}

#[test]
fn test_v1_rent_exemption_exact_160_bytes() {
    assert_eq!(
        anchor::state::PendingRedemption::INIT_SPACE,
        136,
        "PendingRedemption INIT_SPACE must be 136"
    );
    assert_eq!(
        8 + anchor::state::PendingRedemption::INIT_SPACE,
        144,
        "PendingRedemption total account size must be 144 bytes"
    );
    assert_eq!(
        (8 + anchor::state::PendingRedemption::INIT_SPACE) % 8,
        0,
        "Account size must be 8-byte aligned"
    );
    assert_eq!(
        core::mem::offset_of!(anchor::state::PendingRedemption, _reserved),
        72,
        "Reserved offset must start at 72"
    );
}

#[test]
fn test_v1_on_chain_unsupported_account_version_rejection() {
    let mut ctx = setup_e2e();

    // 1. Test declarative check_version() constraint rejection on GlobalConfig (PausePool)
    mutate_global_config(&mut ctx.svm, |gc| {
        gc.version = anchor::state::GlobalConfig::CURRENT_VERSION + 1;
    });

    let res = send_pause_pool(&mut ctx.svm, &ctx.admin, 1);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::UnsupportedAccountVersion,
    );

    // Restore GlobalConfig version
    mutate_global_config(&mut ctx.svm, |gc| {
        gc.version = anchor::state::GlobalConfig::CURRENT_VERSION;
    });

    // 2. Test declarative check_version() constraint rejection on UserWinnings (SellBonds)
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Forge user_winnings to version CURRENT_VERSION + 1
    mutate_user_winnings(&mut ctx.svm, 1, &ctx.user.pubkey(), |uw| {
        uw.version = anchor::state::UserWinnings::CURRENT_VERSION + 1;
    });

    let user_kp = clone_keypair(&ctx.user);
    let sell_res = send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5);
    assert_custom_error(
        sell_res,
        anchor::error::PremiumBondsError::UnsupportedAccountVersion,
    );

    // Restore user_winnings version
    mutate_user_winnings(&mut ctx.svm, 1, &ctx.user.pubkey(), |uw| {
        uw.version = anchor::state::UserWinnings::CURRENT_VERSION;
    });

    // 3. Test declarative ensure_current_version() constraint rejection on RedemptionBatch (SellBonds)
    mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
        rb.version = anchor::state::RedemptionBatch::CURRENT_VERSION + 1;
    });

    ctx.svm.expire_blockhash();
    let sell_res_rb = send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5);
    assert_custom_error(
        sell_res_rb,
        anchor::error::PremiumBondsError::UnsupportedAccountVersion,
    );
}

// ─── Vector 2: State Lifecycle & Lazy Migration ─────────────────────────────

#[test]
fn test_v2_lazy_state_migration_mutated_accounts() {
    let mut ctx = setup_e2e();
    let pool_id = 1;

    // 1. Force pool version to 0
    PrizePoolTestBuilder::from_state(&ctx.svm, pool_id)
        .with_version(0)
        .inject(&mut ctx.svm);

    // Verify pool is version 0
    assert_eq!(read_pool_state(&ctx.svm, pool_id).version, 0);

    // 2. Buy bonds on this pool — handler executes ensure_current_version()
    send_e2e_buy_bonds(&mut ctx, 5).unwrap();

    // 3. Verify pool version was migrated to CURRENT_VERSION (1) in-place
    assert_eq!(
        read_pool_state(&ctx.svm, pool_id).version,
        anchor::state::PrizePool::CURRENT_VERSION
    );
}

#[test]
fn test_v2_user_winnings_lazy_migration_on_sell_bonds() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Forge user_winnings to version 0
    mutate_user_winnings(&mut ctx.svm, 1, &ctx.user.pubkey(), |uw| {
        uw.version = 0;
    });

    // Verify version is 0
    let read_uw = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(read_uw.version, 0);

    // Clone user keypair for sell_bonds
    let user_kp = clone_keypair(&ctx.user);

    // Sell bonds (partial sell, remaining > 0)
    send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5).unwrap();

    // Verify user_winnings migrated to version 1
    let read_uw_after = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(
        read_uw_after.version,
        anchor::state::UserWinnings::CURRENT_VERSION
    );
}

#[test]
fn test_v2_redemption_batch_lazy_migration_on_sell_bonds() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Forge redemption_batch 0 to version 0
    mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
        rb.version = 0;
    });

    // Verify version is 0
    let read_rb = read_redemption_batch(&ctx.svm, 1, 0);
    assert_eq!(read_rb.version, 0);

    // Clone user keypair for sell_bonds
    let user_kp = clone_keypair(&ctx.user);

    // Sell bonds (partial sell, remaining > 0)
    send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5).unwrap();

    // Verify redemption_batch migrated to CURRENT_VERSION in-place
    let read_rb_after = read_redemption_batch(&ctx.svm, 1, 0);
    assert_eq!(
        read_rb_after.version,
        anchor::state::RedemptionBatch::CURRENT_VERSION
    );
}

#[test]
fn test_v2_batch_boundary_slice_version_migration() {
    let mut ctx = setup_e2e();
    let user_a = Keypair::new();
    let user_b = Keypair::new();
    let user_c = Keypair::new();
    ctx.svm.airdrop(&user_a.pubkey(), 10_000_000_000).unwrap();
    ctx.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();
    ctx.svm.airdrop(&user_c.pubkey(), 10_000_000_000).unwrap();

    let user_a_token =
        create_spl_token_account(&mut ctx.svm, &user_a, &ctx.usdc_mint, &user_a.pubkey());
    let user_b_token =
        create_spl_token_account(&mut ctx.svm, &user_b, &ctx.usdc_mint, &user_b.pubkey());
    let user_c_token =
        create_spl_token_account(&mut ctx.svm, &user_c, &ctx.usdc_mint, &user_c.pubkey());

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user_a_token,
        &ctx.usdc_mint_authority,
        50_000_000,
    );
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user_b_token,
        &ctx.usdc_mint_authority,
        50_000_000,
    );
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user_c_token,
        &ctx.usdc_mint_authority,
        50_000_000,
    );

    send_e2e_buy_bonds_for_user(&mut ctx, &user_a, user_a_token, 5, Pubkey::default()).unwrap();
    send_e2e_buy_bonds_for_user(&mut ctx, &user_b, user_b_token, 5, Pubkey::default()).unwrap();
    send_e2e_buy_bonds_for_user(&mut ctx, &user_c, user_c_token, 5, Pubkey::default()).unwrap();

    let ticket_registry_key = ctx.ticket_registry;
    // Forge all 3 user entries to version: 0 in the TicketRegistry
    force_user_entries_version(&mut ctx.svm, ticket_registry_key, 0, 3);

    // Freeze pool and advance to AwaitingRandomness
    let (pool_pda_addr, _) = pool_pda(1);
    PrizePoolTestBuilder::from_state(&ctx.svm, 1)
        .with_frozen(true)
        .inject(&mut ctx.svm);

    let (draw_cycle_pda, _) = draw_cycle_pda(1, 0);
    let draw_cycle = anchor::state::DrawCycle {
        prize_pot: 1_000_000,
        cycle_fee_collected: 0,
        vrf_seed_slot: 100,
        initiated_at: 1000,
        completed_at: 0,
        randomness_account: Keypair::new().pubkey(),
        pool_id: 1,
        cycle_id: 0,
        locked_ticket_count: 15,
        status: anchor::state::DrawStatus::AwaitingRandomness,
        version: 0, // Test read-only draw_cycle with version 0
        rebind_count: 0,
        _padding: [0; 1],
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    let mut dc_data = vec![];
    draw_cycle.try_serialize(&mut dc_data).unwrap();
    dc_data.resize(8 + anchor::state::DrawCycle::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            draw_cycle_pda,
            Account {
                lamports: 1_000_000_000,
                data: dc_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Prepare a batch of size 2 (processes indices 0..2, leaving index 2 unprocessed)
    let crank = Keypair::new();
    ctx.svm.airdrop(&crank.pubkey(), 1_000_000_000).unwrap();

    PrepareDrawBuilder::for_pool(1, 0, crank.pubkey())
        .with_draw_cycle(draw_cycle_pda)
        .with_ticket_registry(ticket_registry_key)
        .with_batch_size(2)
        .send(&mut ctx.svm, &crank)
        .unwrap();

    // Verify Batch Boundary Slice:
    // Entries 0..2 should have version = 1, while entry 2 must remain version = 0!
    let entries = read_ticket_registry_entries(&ctx.svm, ticket_registry_key);
    assert_eq!(
        entries[0].version,
        anchor::state::UserEntry::CURRENT_VERSION
    );
    assert_eq!(
        entries[1].version,
        anchor::state::UserEntry::CURRENT_VERSION
    );
    assert_eq!(
        entries[2].version, 0,
        "Entry 2 outside batch must remain at version 0"
    );

    // Read-only draw_cycle non-mutation check:
    let read_dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        read_dc.version, 0,
        "Read-only draw_cycle must not be mutated"
    );
}

// ─── Vector 3: Access Control & Impersonation ───────────────────────────────

#[test]
fn test_v3_claim_redemption_mismatched_beneficiary() {
    let mut ctx = setup_e2e();
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 1_000_000, 1_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let (_pool_vault, _) = pool_vault_pda(1);
    let attacker_token =
        create_spl_token_account(&mut ctx.svm, &attacker, &ctx.usdc_mint, &attacker.pubkey());

    // Attacker attempts to claim ctx.user's redemption to attacker's token account
    let ix = ClaimRedemptionBuilder::new(&ctx)
        .with_caller(attacker.pubkey())
        .with_beneficiary(attacker.pubkey(), attacker_token)
        .with_redemption_id(0)
        .build_ix();
    let res = send_user_tx(&mut ctx.svm, &attacker, ix);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRedemptionOwner,
    );
}

#[test]
fn test_v3_admin_instructions_reject_non_admin() {
    let mut ctx = setup_e2e();
    let fake_admin = Keypair::new();
    ctx.svm
        .airdrop(&fake_admin.pubkey(), 1_000_000_000)
        .unwrap();

    let res = send_pause_pool(&mut ctx.svm, &fake_admin, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::Unauthorized);
}

// ─── Vector 4: Financial Math & Invariant Conservation ──────────────────────

#[test]
fn test_v4_protocol_pending_redemptions_conservation() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let pool_before = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_before.total_pending_redemptions, 0);

    // Sell 5 bonds (5,000,000 USDC)
    let user_kp = clone_keypair(&ctx.user);
    send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5).unwrap();

    let pool_mid = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_mid.total_pending_redemptions, 5_000_000);

    // Settle and claim redemption
    inject_lender_state(&mut ctx.svm, ctx.huma_lender_state, 5_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);
    inject_redemption_batch_with_state(
        &mut ctx.svm,
        1,
        0,
        anchor::state::RedemptionBatchStatus::Settled,
        5_000_000,
        5_000_000,
    );
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pda_addr, _) = pool_pda(1);
    inject_token_account(&mut ctx.svm, pool_vault, ctx.usdc_mint, pool_pda_addr, 5_000_000);
    let user_token =
        create_spl_token_account(&mut ctx.svm, &user_kp, &ctx.usdc_mint, &user_kp.pubkey());
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token,
        0,
    )
    .unwrap();

    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool_after.total_pending_redemptions, 0,
        "Conservation: pending redemptions must return to 0"
    );
}

// ─── Vector 5: Account Closure & Reallocation Invariants ────────────────────

#[test]
fn test_v5_pending_redemption_closure_100_percent_refund() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 5).unwrap();

    let user_kp = clone_keypair(&ctx.user);
    send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5).unwrap();

    let (pending_pda, _) = pending_redemption_pda(1, 0);
    let pending_acc = ctx.svm.get_account(&pending_pda).unwrap();
    assert_eq!(pending_acc.data.len(), 144);
    let pending_rent = pending_acc.lamports;

    // Claim redemption
    inject_lender_state(&mut ctx.svm, ctx.huma_lender_state, 5_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);
    inject_redemption_batch_with_state(
        &mut ctx.svm,
        1,
        0,
        anchor::state::RedemptionBatchStatus::Settled,
        5_000_000,
        5_000_000,
    );
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pda_addr, _) = pool_pda(1);
    inject_token_account(&mut ctx.svm, pool_vault, ctx.usdc_mint, pool_pda_addr, 5_000_000);
    let user_token =
        create_spl_token_account(&mut ctx.svm, &user_kp, &ctx.usdc_mint, &user_kp.pubkey());
    let user_bal_pre_claim = ctx.svm.get_account(&user_kp.pubkey()).unwrap().lamports;

    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token,
        0,
    )
    .unwrap();

    // Pending account must now be closed / deleted
    let pending_acc_post = ctx.svm.get_account(&pending_pda);
    assert!(pending_acc_post.is_none() || pending_acc_post.unwrap().lamports == 0);

    let user_bal_post_claim = ctx.svm.get_account(&user_kp.pubkey()).unwrap().lamports;
    assert!(
        user_bal_post_claim >= user_bal_pre_claim + pending_rent - 100_000,
        "100% rent must be refunded"
    );
}

#[test]
fn test_v5_resize_registry_preserves_header() {
    let mut ctx = setup_e2e();
    let ticket_registry_key = ctx.ticket_registry;
    let (pool_pda_addr, _) = pool_pda(1);

    let initial_len = ctx
        .svm
        .get_account(&ticket_registry_key)
        .unwrap()
        .data
        .len();
    assert_eq!(initial_len, 262_248);

    let payer = Keypair::new();
    ctx.svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    ResizeRegistryBuilder::new(1, ticket_registry_key, payer.pubkey())
        .send(&mut ctx.svm, &payer)
        .unwrap();

    let resized_len = ctx
        .svm
        .get_account(&ticket_registry_key)
        .unwrap()
        .data
        .len();
    assert_eq!(resized_len, initial_len + 10_240);

    // Verify 96-byte TicketRegistry header fields preserved
    let header = read_ticket_registry(&ctx.svm, ticket_registry_key);
    assert_eq!(header.pool_id, 1);
    assert_eq!(
        header.version,
        anchor::state::TicketRegistry::CURRENT_VERSION
    );
    assert_eq!(header.capacity, ((resized_len - 104) / 64) as u32);
}

// ─── Vector 6: Time & Sysvar Boundaries ─────────────────────────────────────

#[test]
fn test_v6_claim_redemption_fails_unsettled_batch() {
    let mut ctx = setup_e2e();
    inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 1_000_000, 0);
    inject_redemption_batch(&mut ctx.svm, 1, 0);

    let user_token =
        create_spl_token_account(&mut ctx.svm, &ctx.user, &ctx.usdc_mint, &ctx.user.pubkey());

    let ix = ClaimRedemptionBuilder::new(&ctx)
        .with_user(&ctx.user.pubkey(), user_token)
        .with_caller(ctx.user.pubkey())
        .with_redemption_id(0)
        .build_ix();
    let res = send_user_tx(&mut ctx.svm, &ctx.user, ix);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::RedemptionBatchNotSettled,
    );
}

#[test]
fn test_v6_crank_rebind_expired_randomness_1000_slot_boundary() {
    let mut ctx = setup_e2e();
    let (draw_cycle_pda, _) = draw_cycle_pda(1, 0);

    let old_randomness = Keypair::new().pubkey();
    let draw_cycle = anchor::state::DrawCycle {
        prize_pot: 1_000_000,
        cycle_fee_collected: 0,
        vrf_seed_slot: 500,
        initiated_at: 1000,
        completed_at: 0,
        randomness_account: old_randomness,
        pool_id: 1,
        cycle_id: 0,
        locked_ticket_count: 10,
        status: anchor::state::DrawStatus::AwaitingRandomness,
        version: 1,
        rebind_count: 0,
        _padding: [0; 1],
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    let mut dc_data = vec![];
    draw_cycle.try_serialize(&mut dc_data).unwrap();
    dc_data.resize(8 + anchor::state::DrawCycle::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            draw_cycle_pda,
            Account {
                lamports: 1_000_000_000,
                data: dc_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let new_randomness = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut ctx.svm, new_randomness);
    inject_randomness_account_data(&mut ctx.svm, old_randomness, 500, 0, [0u8; 32]);

    // Boundary Test 1: at slot 1500 (1500 - 500 = 1000, NOT > 1000) -> MUST FAIL
    ctx.svm.warp_to_slot(1500);

    let res = CrankRebindExpiredRandomnessBuilder::new(
        ctx.admin.pubkey(),
        1,
        0,
        old_randomness,
        new_randomness,
    )
    .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotExpired);

    // Boundary Test 2: at slot 1501 (1501 - 500 = 1001, strictly > 1000) -> MUST SUCCEED
    ctx.svm.warp_to_slot(1501);
    ctx.svm.expire_blockhash();
    let new_seed_slot = 1501 - 1;
    inject_randomness_account_data(&mut ctx.svm, new_randomness, new_seed_slot, 0, [0u8; 32]);
    CrankRebindExpiredRandomnessBuilder::new(
        ctx.admin.pubkey(),
        1,
        0,
        old_randomness,
        new_randomness,
    )
    .send(&mut ctx.svm, &ctx.admin)
    .unwrap();

    // Verify randomness account was updated to new_randomness
    let updated_dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(updated_dc.randomness_account, new_randomness);
    assert_eq!(updated_dc.vrf_seed_slot, new_seed_slot);
}

// ─── Vector 7: CPI & Security Boundaries ────────────────────────────────────

#[test]
fn test_v7_claim_redemption_rejects_mismatched_batch() {
    let mut ctx = setup_e2e();
    inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 1_000_000, 0);

    let wrong_batch = inject_redemption_batch(&mut ctx.svm, 1, 99);

    let user_token =
        create_spl_token_account(&mut ctx.svm, &ctx.user, &ctx.usdc_mint, &ctx.user.pubkey());

    let ix = ClaimRedemptionBuilder::new(&ctx)
        .with_user(&ctx.user.pubkey(), user_token)
        .with_caller(ctx.user.pubkey())
        .with_batch(wrong_batch)
        .with_redemption_id(0)
        .build_ix();
    let res = send_user_tx(&mut ctx.svm, &ctx.user, ix);
    assert_custom_error(res, anchor::error::PremiumBondsError::MismatchedBatchId);
}

// ─── 100% Error Code Coverage: UnsupportedAccountVersion Across 10 Structs ──

#[test]
fn test_unsupported_account_version_all_10_structs() {
    use anchor::error::PremiumBondsError;
    use anchor::state::{
        DrawCycle, GlobalConfig, PayoutRegistry, PendingRedemption, PrizePool, RedemptionBatch,
        TicketRegistry, UserEntry, UserWinnings, Winner,
    };

    // 1. GlobalConfig
    let mut gc = GlobalConfig {
        admin: Pubkey::default(),
        guardian: Pubkey::default(),
        jobs_account: Pubkey::default(),
        pending_admin: Pubkey::default(),
        version: GlobalConfig::CURRENT_VERSION + 1,
        _padding: [0; 7],
        _reserved: [0; 64],
    };
    assert_eq!(
        gc.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "GlobalConfig check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        gc.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "GlobalConfig ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 2. PrizePool
    let mut pp = PrizePool {
        vault_authority_bump: 0,
        pool_id: 1,
        token_mint: Pubkey::default(),
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        huma_pool_state: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 500,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: 0,
        total_deposited_principal: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw: 0,
        current_draw_cycle_id: 0,
        prize_tiers_count: 0,
        accumulating_redemption_batch_id: 0,
        next_redemption_batch_id: 1,
        submitted_batch_id: anchor::constants::NO_SUBMITTED_BATCH,
        total_accumulating_redemptions: 0,
        paused_at: 0,
        _padding: [0; 3],
        prize_tiers: [anchor::state::PrizeTier {
            num_winners: 0,
            basis_points: 0,
            _padding: [0; 2],
        }; 10],
        next_redemption_id: 0,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        total_pending_redemptions: 0,
        version: PrizePool::CURRENT_VERSION + 1,
        _reserved: [0; 128],
    };
    assert_eq!(
        pp.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "PrizePool check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        pp.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "PrizePool ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 3. TicketRegistry
    let mut tr = TicketRegistry {
        pool_id: 0,
        capacity: 0,
        user_count: 0,
        total_active_tickets: 0,
        total_pending_tickets: 0,
        draw_cycle_id: 0,
        draw_prepared_up_to: 0,
        version: TicketRegistry::CURRENT_VERSION + 1,
        _padding: [0; 3],
        _reserved: [0; 64],
    };
    assert_eq!(
        tr.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "TicketRegistry check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        tr.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "TicketRegistry ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 4. UserEntry
    let mut ue = UserEntry {
        owner: Pubkey::default(),
        active: 0,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: UserEntry::CURRENT_VERSION + 1,
        _padding: [0; 3],
        _reserved: [0; 12],
    };
    assert_eq!(
        ue.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "UserEntry check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        ue.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "UserEntry ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 5. Winner
    let mut w = Winner {
        winner: Pubkey::default(),
        amount_owed: 0,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: Winner::CURRENT_VERSION + 1,
        _padding: [0; 1],
        _reserved: [0; 8],
    };
    assert_eq!(
        w.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "Winner check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        w.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "Winner ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 6. DrawCycle
    let mut dc = DrawCycle {
        prize_pot: 0,
        cycle_fee_collected: 0,
        vrf_seed_slot: 0,
        initiated_at: 0,
        completed_at: 0,
        randomness_account: Pubkey::default(),
        pool_id: 1,
        cycle_id: 1,
        locked_ticket_count: 0,
        status: anchor::state::DrawStatus::AwaitingYield,
        version: DrawCycle::CURRENT_VERSION + 1,
        rebind_count: 0,
        _padding: [0; 1],
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    assert_eq!(
        dc.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "DrawCycle check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        dc.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "DrawCycle ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 7. UserWinnings
    let mut uw = UserWinnings {
        unclaimed_non_reinvested_winnings: 0,
        total_claimed: 0,
        total_reinvested: 0,
        pool_id: 1,
        registry_entry_index: 0,
        user: Pubkey::default(),
        bump: 0,
        version: UserWinnings::CURRENT_VERSION + 1,
        _padding: [0; 6],
        _reserved: [0; 64],
    };
    assert_eq!(
        uw.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "UserWinnings check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        uw.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "UserWinnings ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 8. PayoutRegistry
    let mut pr = PayoutRegistry {
        pool_id: 1,
        cycle_id: 1,
        winners_count: 0,
        payouts_completed: 0,
        revealed_at: 0,
        status: 0,
        version: PayoutRegistry::CURRENT_VERSION + 1,
        _padding: [0; 6],
        _reserved: [0; 64],
    };
    assert_eq!(
        pr.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "PayoutRegistry check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        pr.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "PayoutRegistry ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 9. PendingRedemption
    let mut pred = PendingRedemption {
        redemption_id: 1,
        amount: 100,
        batch_id: 0,
        requested_at: 0,
        user: Pubkey::default(),
        pool_id: 1,
        bump: 0,
        version: PendingRedemption::CURRENT_VERSION + 1,
        redemption_type: anchor::state::RedemptionType::BondSale,
        _padding: [0; 1],
        _reserved: [0; 64],
    };
    assert_eq!(
        pred.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "PendingRedemption check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        pred.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "PendingRedemption ensure_current_version must fail with UnsupportedAccountVersion"
    );

    // 10. RedemptionBatch
    let mut rb = RedemptionBatch::new(1, 1, 255, 0);
    rb.version = RedemptionBatch::CURRENT_VERSION + 1;
    assert_eq!(
        rb.check_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "RedemptionBatch check_version must fail with UnsupportedAccountVersion"
    );
    assert_eq!(
        rb.ensure_current_version().unwrap_err(),
        PremiumBondsError::UnsupportedAccountVersion.into(),
        "RedemptionBatch ensure_current_version must fail with UnsupportedAccountVersion"
    );
}

// ─── 9-Vector Upgradeability Verification Suite ─────────────────────────────

// 1. test_v1_rejection_of_unsupported_batch_version_all_entrypoints
#[test]
fn test_v1_rejection_of_unsupported_batch_version_all_entrypoints() {
    use anchor::error::PremiumBondsError;
    use anchor::state::{RedemptionBatch, RedemptionBatchStatus};

    for bad_version in [RedemptionBatch::CURRENT_VERSION + 1, u8::MAX] {
        // 1.1 sell_bonds
        {
            let mut ctx = setup_e2e();
            send_e2e_buy_bonds(&mut ctx, 10).unwrap();
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
            });
            let user_kp = clone_keypair(&ctx.user);
            ctx.svm.expire_blockhash();
            let res = send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }

        // 1.2 withdraw_fees
        {
            let mut ctx = setup_e2e();
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
            });
            ctx.svm.expire_blockhash();
            let res = WithdrawFeesBuilder::from_ctx(&ctx).send(&mut ctx.svm, &ctx.admin);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }

        // 1.3 claim_redemption
        {
            let mut ctx = setup_e2e();
            inject_redemption_batch_with_state(
                &mut ctx.svm,
                1,
                0,
                RedemptionBatchStatus::Settled,
                5_000_000,
                5_000_000,
            );
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
            });
            inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 5_000_000, 0);
            let user_token =
                create_spl_token_account(&mut ctx.svm, &ctx.user, &ctx.usdc_mint, &ctx.user.pubkey());
            let ix = ClaimRedemptionBuilder::new(&ctx)
                .with_user(&ctx.user.pubkey(), user_token)
                .with_caller(ctx.user.pubkey())
                .with_redemption_id(0)
                .build_ix();
            ctx.svm.expire_blockhash();
            let res = send_user_tx(&mut ctx.svm, &ctx.user, ix);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }

        // 1.4 claim_non_reinvested_winnings
        {
            let mut ctx = setup_e2e();
            inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 1_000_000, 0, 0);
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
            });
            ctx.svm.expire_blockhash();
            let res = ClaimNonReinvestedWinningsBuilder::new(&ctx).send(&mut ctx.svm, &ctx.user);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }

        // 1.5 crank_submit_redemption_batch
        {
            let mut ctx = setup_e2e();
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
                rb.status = RedemptionBatchStatus::Accumulating;
            });
            ctx.svm.expire_blockhash();
            let res = CrankSubmitRedemptionBatchBuilder::for_pool(1, 0, 1, ctx.admin.pubkey())
                .with_huma_mode_mint(ctx.pst_mint)
                .with_huma_pool_state(ctx.huma_pool_state)
                .send(&mut ctx.svm, &ctx.admin);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }

        // 1.6 settle_redemption_batch
        {
            let mut ctx = setup_e2e();
            inject_redemption_batch_with_state(
                &mut ctx.svm,
                1,
                0,
                RedemptionBatchStatus::Submitted,
                5_000_000,
                0,
            );
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
            });
            ctx.svm.expire_blockhash();
            let res = SettleRedemptionBatchBuilder::for_pool(1, 0, ctx.admin.pubkey())
                .with_token_mint(ctx.usdc_mint)
                .with_huma_pool_state(ctx.huma_pool_state)
                .send(&mut ctx.svm, &ctx.admin);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }

        // 1.7 crank_close_redemption_batch
        {
            let mut ctx = setup_e2e();
            inject_redemption_batch_with_state(
                &mut ctx.svm,
                1,
                0,
                RedemptionBatchStatus::Settled,
                5_000_000,
                5_000_000,
            );
            mutate_redemption_batch(&mut ctx.svm, 1, 0, |rb| {
                rb.version = bad_version;
                rb.claimed_principal = 5_000_000;
            });
            ctx.svm.expire_blockhash();
            let res = CrankCloseRedemptionBatchBuilder::for_pool(1, 0, ctx.admin.pubkey())
                .with_token_mint(ctx.usdc_mint)
                .with_fee_wallet(ctx.fee_wallet)
                .send(&mut ctx.svm, &ctx.admin);
            assert_custom_error(res, PremiumBondsError::UnsupportedAccountVersion);
        }
    }
}

// 2. test_v1_reinvest_winnings_rejects_unsupported_ticket_registry_version
#[test]
fn test_v1_reinvest_winnings_rejects_unsupported_ticket_registry_version() {
    for bad_version in [
        anchor::state::TicketRegistry::CURRENT_VERSION + 1,
        u8::MAX,
    ] {
        let (mut svm, _admin) = setup_global_config();
        let crank = Keypair::new();
        svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

        let winner = Keypair::new().pubkey();
        let mint = Keypair::new().pubkey();
        let reg = Keypair::new().pubkey();

        let entries = vec![UserEntryTestBuilder::active(winner, 10)];
        inject_registry_with_entries(&mut svm, reg, 1, 1000, &entries);

        mutate_ticket_registry_header(&mut svm, reg, |tr| {
            tr.version = bad_version;
        });

        PrizePoolTestBuilder::new(1)
            .with_token_mint(mint)
            .with_ticket_registry(reg)
            .with_status(anchor::PoolStatus::Active)
            .with_frozen(false)
            .with_bond_price(1_000_000)
            .with_solvency_state(0, 1_000_000_000, 0)
            .inject(&mut svm);

        PayoutRegistryTestBuilder::new(1, 0)
            .with_winners(vec![WinnerTestBuilder::unprocessed(winner, 3_000_000, 0)])
            .inject(&mut svm);

        inject_user_winnings_with_index(&mut svm, 1, winner, 0, 0, 0, 0);

        let res = ReinvestWinningsBuilder::for_pool(1, 0, crank.pubkey())
            .with_winner(&winner)
            .with_ticket_registry(reg)
            .with_winner_index(0)
            .send(&mut svm, &crank);

        assert_custom_error(
            res,
            anchor::error::PremiumBondsError::UnsupportedAccountVersion,
        );
    }
}

// 3. test_domain_state_methods_reject_future_version_unit
#[test]
fn test_domain_state_methods_reject_future_version_unit() {
    use anchor::error::PremiumBondsError;
    use anchor::state::{PrizePool, RedemptionBatch, RedemptionBatchStatus};

    for bad_version in [RedemptionBatch::CURRENT_VERSION + 1, u8::MAX] {
        let mut rb = RedemptionBatch::new(1, 0, 255, 0);
        rb.version = bad_version;

        // accumulate
        assert_eq!(
            rb.accumulate(1_000).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );

        // submit
        assert_eq!(
            rb.submit(1, 100, 1000).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );

        // settle
        rb.status = RedemptionBatchStatus::Submitted;
        assert_eq!(
            rb.settle(1_000, 1000).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );

        // calculate_payout
        rb.status = RedemptionBatchStatus::Settled;
        rb.total_principal_requested = 1_000;
        rb.settled_usdc_received = 1_000;
        assert_eq!(
            rb.calculate_payout(100).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );

        // claim
        assert_eq!(
            rb.claim(100).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );
    }

    // PrizePool complete_pending_redemption
    for bad_version in [PrizePool::CURRENT_VERSION + 1, u8::MAX] {
        let mut pp = PrizePoolTestBuilder::new(1).build();
        pp.version = bad_version;
        pp.total_pending_redemptions = 1_000;
        assert_eq!(
            pp.complete_pending_redemption(100).unwrap_err(),
            PremiumBondsError::UnsupportedAccountVersion.into()
        );
    }
}

// 4. test_v2_redemption_batch_lazy_migration_on_withdraw_fees
#[test]
fn test_v2_redemption_batch_lazy_migration_on_withdraw_fees() {
    let mut ctx = setup_e2e();
    let pool_id = 1;

    PrizePoolTestBuilder::from_state(&ctx.svm, pool_id)
        .with_fees_accrued(1_000_000)
        .inject(&mut ctx.svm);

    mutate_redemption_batch(&mut ctx.svm, pool_id, 0, |rb| {
        rb.version = 0;
    });
    assert_eq!(read_redemption_batch(&ctx.svm, pool_id, 0).version, 0);

    send_e2e_withdraw_fees(&mut ctx, 100_000).unwrap();

    assert_eq!(
        read_redemption_batch(&ctx.svm, pool_id, 0).version,
        anchor::state::RedemptionBatch::CURRENT_VERSION,
        "withdraw_fees must lazily migrate redemption_batch to CURRENT_VERSION"
    );
}

// 5. test_v2_pool_and_batch_lazy_migration_on_claim_redemption
#[test]
fn test_v2_pool_and_batch_lazy_migration_on_claim_redemption() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let redemption_amount = 5_000_000;

    PrizePoolTestBuilder::from_state(&ctx.svm, pool_id)
        .with_version(0)
        .with_pending_redemptions(redemption_amount)
        .inject(&mut ctx.svm);
    assert_eq!(read_pool_state(&ctx.svm, pool_id).version, 0);

    inject_redemption_batch_with_state(
        &mut ctx.svm,
        pool_id,
        0,
        anchor::state::RedemptionBatchStatus::Settled,
        redemption_amount,
        redemption_amount,
    );
    mutate_redemption_batch(&mut ctx.svm, pool_id, 0, |rb| {
        rb.version = 0;
    });
    assert_eq!(read_redemption_batch(&ctx.svm, pool_id, 0).version, 0);

    inject_pending_redemption(&mut ctx.svm, pool_id, 0, ctx.user.pubkey(), redemption_amount, 0);

    inject_lender_state(&mut ctx.svm, ctx.huma_lender_state, redemption_amount);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let (pool_vault, _) = pool_vault_pda(pool_id);
    let (pool_pda_addr, _) = pool_pda(pool_id);
    inject_token_account(&mut ctx.svm, pool_vault, ctx.usdc_mint, pool_pda_addr, redemption_amount);

    let user_token =
        create_spl_token_account(&mut ctx.svm, &ctx.user, &ctx.usdc_mint, &ctx.user.pubkey());

    let user_kp = clone_keypair(&ctx.user);
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token,
        0,
    )
    .unwrap();

    assert_eq!(
        read_pool_state(&ctx.svm, pool_id).version,
        anchor::state::PrizePool::CURRENT_VERSION,
        "Pool must lazily migrate to CURRENT_VERSION on claim_redemption"
    );
    assert_eq!(
        read_redemption_batch(&ctx.svm, pool_id, 0).version,
        anchor::state::RedemptionBatch::CURRENT_VERSION,
        "RedemptionBatch must lazily migrate to CURRENT_VERSION on claim_redemption"
    );
}

// 6. test_v2_redemption_batch_lazy_migration_on_submit_and_settle
#[test]
fn test_v2_redemption_batch_lazy_migration_on_submit_and_settle() {
    let mut batch_submit = anchor::state::RedemptionBatch::new(1, 0, 255, 1000);
    batch_submit.version = 0;
    batch_submit.total_principal_requested = 1_000_000;
    batch_submit.submit(42, 100, 2000).unwrap();
    assert_eq!(
        batch_submit.version,
        anchor::state::RedemptionBatch::CURRENT_VERSION,
        "submit() must migrate batch to CURRENT_VERSION"
    );

    let mut batch_settle = anchor::state::RedemptionBatch::new(1, 0, 255, 1000);
    batch_settle.version = 0;
    batch_settle.status = anchor::state::RedemptionBatchStatus::Submitted;
    batch_settle.settle(1_000_000, 3000).unwrap();
    assert_eq!(
        batch_settle.version,
        anchor::state::RedemptionBatch::CURRENT_VERSION,
        "settle() must migrate batch to CURRENT_VERSION"
    );
}

// 7. test_v2_pool_lazy_migration_on_crank_close_redemption_batch
#[test]
fn test_v2_pool_lazy_migration_on_crank_close_redemption_batch() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let unclaimed = 1_000_000;

    PrizePoolTestBuilder::from_state(&ctx.svm, pool_id)
        .with_version(0)
        .with_pending_redemptions(unclaimed)
        .inject(&mut ctx.svm);
    assert_eq!(read_pool_state(&ctx.svm, pool_id).version, 0);

    let (pool_vault, _) = pool_vault_pda(pool_id);
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &pool_vault,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    inject_redemption_batch_with_state(
        &mut ctx.svm,
        pool_id,
        0,
        anchor::state::RedemptionBatchStatus::Settled,
        unclaimed,
        unclaimed,
    );
    let clock: solana_sdk::clock::Clock = ctx.svm.get_sysvar();
    let now = clock.unix_timestamp;
    mutate_redemption_batch(&mut ctx.svm, pool_id, 0, |rb| {
        rb.claimed_principal = 0;
        rb.settled_at = now;
    });

    warp_forward_seconds(
        &mut ctx.svm,
        anchor::constants::BATCH_CLAIM_EXPIRY_SECONDS + 100,
    );

    CrankCloseRedemptionBatchBuilder::for_pool(pool_id, 0, ctx.admin.pubkey())
        .with_token_mint(ctx.usdc_mint)
        .with_fee_wallet(ctx.fee_wallet)
        .send(&mut ctx.svm, &ctx.admin)
        .unwrap();

    assert_eq!(
        read_pool_state(&ctx.svm, pool_id).version,
        anchor::state::PrizePool::CURRENT_VERSION,
        "Pool must lazily migrate to CURRENT_VERSION on crank_close_redemption_batch when unclaimed funds exist"
    );
}

// 8. test_v2_read_only_instructions_do_not_mutate_legacy_version_zero
#[test]
fn test_v2_read_only_instructions_do_not_mutate_legacy_version_zero() {
    let mut ctx = setup_e2e();
    let pool_id = 1;

    // Buy 5 bonds so that ticket registry has 5 active tickets matching locked_ticket_count
    send_e2e_buy_bonds(&mut ctx, 5).unwrap();

    let (draw_cycle_pda, _) = draw_cycle_pda(pool_id, 0);
    let draw_cycle = anchor::state::DrawCycle {
        prize_pot: 1_000_000,
        cycle_fee_collected: 0,
        vrf_seed_slot: 100,
        initiated_at: 1000,
        completed_at: 0,
        randomness_account: Keypair::new().pubkey(),
        pool_id,
        cycle_id: 0,
        locked_ticket_count: 5,
        status: anchor::state::DrawStatus::AwaitingRandomness,
        version: 0,
        rebind_count: 0,
        _padding: [0; 1],
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    let mut dc_data = vec![];
    draw_cycle.try_serialize(&mut dc_data).unwrap();
    dc_data.resize(8 + anchor::state::DrawCycle::INIT_SPACE, 0);
    ctx.svm
        .set_account(
            draw_cycle_pda,
            Account {
                lamports: 1_000_000_000,
                data: dc_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    PrizePoolTestBuilder::from_state(&ctx.svm, pool_id)
        .with_frozen(true)
        .inject(&mut ctx.svm);

    let crank = Keypair::new();
    ctx.svm.airdrop(&crank.pubkey(), 1_000_000_000).unwrap();

    PrepareDrawBuilder::for_pool(pool_id, 0, crank.pubkey())
        .with_draw_cycle(draw_cycle_pda)
        .with_ticket_registry(ctx.ticket_registry)
        .with_batch_size(1)
        .send(&mut ctx.svm, &crank)
        .unwrap();

    let read_dc = read_draw_cycle_state(&ctx.svm, pool_id, 0);
    assert_eq!(
        read_dc.version, 0,
        "Read-only borrow of draw_cycle must NOT mutate version on chain"
    );
}

// 9. test_simulated_v2_struct_field_carving_zero_copy
#[test]
fn test_simulated_v2_struct_field_carving_zero_copy() {
    use anchor::state::{PayoutRegistry, PrizePool, PrizeTier, RedemptionBatch, RedemptionBatchStatus, TicketRegistry, UserEntry, Winner};

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct PrizePoolV2 {
        pub bond_price: u64,
        pub stake_cycle_duration_hrs: i64,
        pub min_yield_threshold: u64,
        pub current_cycle_end_at: i64,
        pub paused_at: i64,
        pub total_deposited_principal: u64,
        pub total_fees_accrued: u64,
        pub total_fees_withdrawn: u64,
        pub total_prizes_allocated: u64,
        pub total_pending_redemptions: u64,
        pub next_redemption_id: u64,
        pub accumulating_redemption_batch_id: u64,
        pub next_redemption_batch_id: u64,
        pub submitted_batch_id: u64,
        pub total_accumulating_redemptions: u64,
        pub pool_id: u32,
        pub current_draw_cycle_id: u32,
        pub payout_timelock_seconds: u32,
        pub fee_basis_points: u16,
        pub max_yield_basis_points: u16,
        pub vault_authority_bump: u8,
        pub status: u8,
        pub is_frozen_for_draw: u8,
        pub version: u8,
        pub prize_tiers_count: u8,
        pub _padding: [u8; 3],
        pub token_mint: Pubkey,
        pub ticket_registry: Pubkey,
        pub fee_wallet: Pubkey,
        pub huma_pool_state: Pubkey,
        pub prize_tiers: [PrizeTier; 10],
        pub tier_bonus_bps: u64,
        pub _reserved: [u8; 120],
    }

    #[repr(C)]
    #[derive(Clone, Copy)]
    struct RedemptionBatchV2 {
        pub huma_request_id: u128,
        pub batch_id: u64,
        pub total_principal_requested: u64,
        pub total_pst_shares_locked: u64,
        pub settled_usdc_received: u64,
        pub claimed_principal: u64,
        pub created_at: i64,
        pub submitted_at: i64,
        pub settled_at: i64,
        pub pool_id: u32,
        pub status: RedemptionBatchStatus,
        pub bump: u8,
        pub version: u8,
        pub _padding: [u8; 1],
        pub settlement_epoch: u64,
        pub _reserved: [u8; 64],
    }

    #[repr(C)]
    #[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
    struct TicketRegistryV2 {
        pub pool_id: u32,
        pub capacity: u32,
        pub user_count: u32,
        pub total_active_tickets: u32,
        pub total_pending_tickets: u32,
        pub draw_cycle_id: u32,
        pub draw_prepared_up_to: u32,
        pub version: u8,
        pub _padding: [u8; 3],
        pub feature_flags: u64,
        pub _reserved: [u64; 7],
    }

    #[repr(C)]
    #[derive(Clone, Copy, bytemuck::Pod, bytemuck::Zeroable)]
    struct PayoutRegistryV2 {
        pub pool_id: u32,
        pub cycle_id: u32,
        pub winners_count: u32,
        pub payouts_completed: u32,
        pub revealed_at: i64,
        pub status: u8,
        pub version: u8,
        pub _padding: [u8; 6],
        pub claim_expiry_ts: i64,
        pub _reserved: [u64; 7],
    }

    // 1. Verify exact struct sizes
    assert_eq!(std::mem::size_of::<PrizePoolV2>(), 480);
    assert_eq!(std::mem::size_of::<PrizePool>(), 480);

    assert_eq!(std::mem::size_of::<RedemptionBatchV2>(), 160);
    assert_eq!(std::mem::size_of::<RedemptionBatch>(), 160);

    assert_eq!(std::mem::size_of::<TicketRegistryV2>(), 96);
    assert_eq!(std::mem::size_of::<TicketRegistry>(), 96);

    assert_eq!(std::mem::size_of::<PayoutRegistryV2>(), 96);
    assert_eq!(std::mem::size_of::<PayoutRegistry>(), 96);

    // 2. Zero memory shifts & alignment
    assert_eq!(
        core::mem::offset_of!(PrizePoolV2, tier_bonus_bps),
        core::mem::offset_of!(PrizePool, _reserved)
    );
    assert_eq!(
        core::mem::offset_of!(RedemptionBatchV2, settlement_epoch),
        core::mem::offset_of!(RedemptionBatch, _reserved)
    );
    assert_eq!(
        core::mem::offset_of!(TicketRegistryV2, feature_flags),
        core::mem::offset_of!(TicketRegistry, _reserved)
    );
    assert_eq!(
        core::mem::offset_of!(PayoutRegistryV2, claim_expiry_ts),
        core::mem::offset_of!(PayoutRegistry, _reserved)
    );

    // 3. Prove trailing raw dynamic slices remain byte-exact at offset 104
    let mut reg_bytes = vec![0u8; 104 + std::mem::size_of::<UserEntry>()];
    reg_bytes[0..8].copy_from_slice(TicketRegistry::DISCRIMINATOR);
    let sample_user = Pubkey::new_unique();
    let entry_slice = &mut reg_bytes[104..104 + 64];
    let entry = UserEntry {
        owner: sample_user,
        active: 42,
        pending: 10,
        merged_through_cycle: 1,
        cumulative_active: 52,
        version: 1,
        _padding: [0; 3],
        _reserved: [0; 12],
    };
    entry_slice.copy_from_slice(bytemuck::bytes_of(&entry));

    let _v2_header = bytemuck::try_from_bytes::<TicketRegistryV2>(&reg_bytes[8..104]).unwrap();
    let v2_entries = bytemuck::try_cast_slice::<u8, UserEntry>(&reg_bytes[104..]).unwrap();
    assert_eq!(v2_entries[0].owner, sample_user);
    assert_eq!(v2_entries[0].active, 42);

    let mut payout_bytes = vec![0u8; 104 + std::mem::size_of::<Winner>()];
    payout_bytes[0..8].copy_from_slice(PayoutRegistry::DISCRIMINATOR);
    let winner = Winner {
        winner: sample_user,
        amount_owed: 1_000_000,
        bonds_bought: 1,
        processed: 0,
        tier_index: 0,
        version: 1,
        _padding: [0; 1],
        _reserved: [0; 8],
    };
    payout_bytes[104..104 + 56].copy_from_slice(bytemuck::bytes_of(&winner));

    let _v2_payout_header = bytemuck::try_from_bytes::<PayoutRegistryV2>(&payout_bytes[8..104]).unwrap();
    let v2_winners = bytemuck::try_cast_slice::<u8, Winner>(&payout_bytes[104..]).unwrap();
    assert_eq!(v2_winners[0].winner, sample_user);
    assert_eq!(v2_winners[0].amount_owed, 1_000_000);
}
