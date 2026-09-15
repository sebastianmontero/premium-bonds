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

// ─── Instruction Builders & Helpers ─────────────────────────────────────────

fn clone_keypair(kp: &Keypair) -> Keypair {
    let mut secret = [0u8; 32];
    secret.copy_from_slice(&kp.to_bytes()[0..32]);
    Keypair::new_from_array(secret)
}

fn read_user_winnings(svm: &LiteSVM, pool_id: u32, user: &Pubkey) -> anchor::state::UserWinnings {
    let (pda, _) = user_winnings_pda(pool_id, user);
    let acc = svm.get_account(&pda).expect("user_winnings must exist");
    let mut data_slice = &acc.data[8..];
    anchor::state::UserWinnings::deserialize(&mut data_slice).unwrap()
}

fn send_e2e_sell_bonds(
    ctx: &mut E2eContext,
    user: &Keypair,
    active_to_sell: u32,
    pending_to_sell: u32,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    send_e2e_sell_bonds_for_user(
        ctx,
        user,
        active_to_sell,
        pending_to_sell,
        Pubkey::default(),
        Pubkey::default(),
        Pubkey::default(),
    )
}



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
            pst_shares_locked: 5_000_000,
            huma_request_id: 10,
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
    assert_eq!(read_acc.data.len(), 160, "pending_pda data length must be 160 bytes");
    let deserialized =
        anchor::state::PendingRedemption::try_deserialize(&mut &read_acc.data[..]).unwrap();
    assert_eq!(deserialized.pool_id, 1, "pool_id must be 1");
    assert_eq!(deserialized.redemption_id, 42, "redemption_id must be 42");
    assert_eq!(deserialized.amount, 5_000_000, "amount must be 5 USDC");
    assert_eq!(&deserialized._reserved[0..8], &canary, "canary bytes must be preserved");
}

#[test]
fn test_v1_rent_exemption_exact_160_bytes() {
    assert_eq!(anchor::state::PendingRedemption::INIT_SPACE, 152, "PendingRedemption INIT_SPACE must be 152");
    assert_eq!(8 + anchor::state::PendingRedemption::INIT_SPACE, 160, "PendingRedemption total account size must be 160 bytes");
    assert_eq!((8 + anchor::state::PendingRedemption::INIT_SPACE) % 8, 0, "Account size must be 8-byte aligned");
    assert_eq!(
        core::mem::offset_of!(anchor::state::PendingRedemption, _reserved),
        88,
        "Reserved offset must start at 88"
    );
}

#[test]
fn test_v1_on_chain_unsupported_account_version_rejection() {
    let mut ctx = setup_e2e();

    // 1. Test declarative check_version() constraint rejection on GlobalConfig (PausePool)
    let (global_config, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(1);

    // Forge GlobalConfig to version CURRENT_VERSION + 1
    let mut gc_acc = ctx.svm.get_account(&global_config).unwrap();
    let mut gc = anchor::state::GlobalConfig::try_deserialize(&mut &gc_acc.data[..]).unwrap();
    gc.version = anchor::state::GlobalConfig::CURRENT_VERSION + 1;
    let mut new_gc_data = vec![];
    gc.try_serialize(&mut new_gc_data).unwrap();
    new_gc_data.resize(8 + anchor::state::GlobalConfig::INIT_SPACE, 0);
    gc_acc.data = new_gc_data;
    ctx.svm.set_account(global_config, gc_acc).unwrap();

    let accounts = anchor::accounts::PausePool {
        global_config,
        signer: ctx.admin.pubkey(),
        pool: pool_pda_addr,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PausePool {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::UnsupportedAccountVersion,
    );

    // Restore GlobalConfig version
    let mut gc_acc = ctx.svm.get_account(&global_config).unwrap();
    let mut gc = anchor::state::GlobalConfig::try_deserialize(&mut &gc_acc.data[..]).unwrap();
    gc.version = anchor::state::GlobalConfig::CURRENT_VERSION;
    let mut restored_gc_data = vec![];
    gc.try_serialize(&mut restored_gc_data).unwrap();
    restored_gc_data.resize(8 + anchor::state::GlobalConfig::INIT_SPACE, 0);
    gc_acc.data = restored_gc_data;
    ctx.svm.set_account(global_config, gc_acc).unwrap();

    // 2. Test declarative check_version() constraint rejection on UserWinnings (SellBonds)
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    // Forge user_winnings to version CURRENT_VERSION + 1
    let mut uw_acc = ctx.svm.get_account(&user_winnings).unwrap();
    let mut uw_data = &uw_acc.data[8..];
    let mut uw = anchor::state::UserWinnings::deserialize(&mut uw_data).unwrap();
    uw.version = anchor::state::UserWinnings::CURRENT_VERSION + 1;
    let mut new_data = vec![];
    uw.try_serialize(&mut new_data).unwrap();
    new_data.resize(8 + anchor::state::UserWinnings::INIT_SPACE, 0);
    uw_acc.data = new_data;
    ctx.svm.set_account(user_winnings, uw_acc).unwrap();

    let user_kp = clone_keypair(&ctx.user);
    let sell_res = send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5);
    assert_custom_error(
        sell_res,
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

    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    // Forge user_winnings to version 0
    let mut uw_acc = ctx.svm.get_account(&user_winnings).unwrap();
    let mut uw_data = &uw_acc.data[8..];
    let mut uw = anchor::state::UserWinnings::deserialize(&mut uw_data).unwrap();
    uw.version = 0;
    let mut new_data = vec![];
    uw.try_serialize(&mut new_data).unwrap();
    new_data.resize(8 + anchor::state::UserWinnings::INIT_SPACE, 0);
    uw_acc.data = new_data;
    ctx.svm.set_account(user_winnings, uw_acc).unwrap();

    // Verify version is 0
    let read_uw = read_user_winnings(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(read_uw.version, 0);

    // Clone user keypair for sell_bonds
    let user_kp = clone_keypair(&ctx.user);

    // Sell bonds (partial sell, remaining > 0)
    send_e2e_sell_bonds(&mut ctx, &user_kp, 0, 5).unwrap();

    // Verify user_winnings migrated to version 1
    let read_uw_after = read_user_winnings(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(
        read_uw_after.version,
        anchor::state::UserWinnings::CURRENT_VERSION
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
        harvest_slot: 100,
        initiated_at: 1000,
        completed_at: 0,
        randomness_account: Keypair::new().pubkey(),
        pool_id: 1,
        cycle_id: 0,
        locked_ticket_count: 15,
        status: anchor::state::DrawStatus::AwaitingRandomness,
        version: 0, // Test read-only draw_cycle with version 0
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

    let accounts = anchor::accounts::PrepareDraw {
        crank: crank.pubkey(),
        pool: pool_pda_addr,
        draw_cycle: draw_cycle_pda,
        ticket_registry: ticket_registry_key,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PrepareDraw { batch_size: 2 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    ctx.svm.send_transaction(tx).unwrap();

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
    let dc_acc = ctx.svm.get_account(&draw_cycle_pda).unwrap();
    let mut dc_slice = &dc_acc.data[8..];
    let read_dc = anchor::state::DrawCycle::deserialize(&mut dc_slice).unwrap();
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

    let (pool_vault, _) = pool_vault_pda(1);
    let attacker_token =
        create_spl_token_account(&mut ctx.svm, &attacker, &ctx.usdc_mint, &attacker.pubkey());
    let huma = TestHumaAccounts::from_e2e(&ctx);

    // Attacker attempts to claim ctx.user's redemption to attacker's token account
    let ix = build_claim_redemption_ix(
        attacker.pubkey(),
        attacker.pubkey(), // Mismatched beneficiary
        1,
        0,
        ctx.usdc_mint,
        attacker_token,
        &huma,
        Some(pool_vault),
    );

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidRedemptionOwner);
}

#[test]
fn test_v3_admin_instructions_reject_non_admin() {
    let mut ctx = setup_e2e();
    let fake_admin = Keypair::new();
    ctx.svm
        .airdrop(&fake_admin.pubkey(), 1_000_000_000)
        .unwrap();

    let (global_config, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(1);

    // Attempt pause with non-admin / non-guardian
    let accounts = anchor::accounts::PausePool {
        global_config,
        signer: fake_admin.pubkey(),
        pool: pool_pda_addr,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PausePool {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&fake_admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&fake_admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
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
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);
    let user_token =
        create_spl_token_account(&mut ctx.svm, &user_kp, &ctx.usdc_mint, &user_kp.pubkey());
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token,
        0,
        Pubkey::default(),
        Pubkey::default(),
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
    assert_eq!(pending_acc.data.len(), 160);
    let pending_rent = pending_acc.lamports;

    // Claim redemption
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);
    let user_token =
        create_spl_token_account(&mut ctx.svm, &user_kp, &ctx.usdc_mint, &user_kp.pubkey());
    let user_bal_pre_claim = ctx.svm.get_account(&user_kp.pubkey()).unwrap().lamports;

    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token,
        0,
        Pubkey::default(),
        Pubkey::default(),
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

    let accounts = anchor::accounts::ResizeRegistry {
        payer: payer.pubkey(),
        pool: pool_pda_addr,
        ticket_registry: ticket_registry_key,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    ctx.svm.send_transaction(tx).unwrap();

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
fn test_v6_claim_redemption_fails_unsettled_huma_queue() {
    let mut ctx = setup_e2e();
    inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 1_000_000, 1_000_000);

    // Huma queue NOT settled (next_request_id remains 0)
    let (pool_vault, _) = pool_vault_pda(1);
    let user_token =
        create_spl_token_account(&mut ctx.svm, &ctx.user, &ctx.usdc_mint, &ctx.user.pubkey());
    let huma = TestHumaAccounts::from_e2e(&ctx);

    let ix = build_claim_redemption_ix(
        ctx.user.pubkey(),
        ctx.user.pubkey(),
        1,
        0,
        ctx.usdc_mint,
        user_token,
        &huma,
        Some(pool_vault),
    );

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::HumaRedemptionNotSettled,
    );
}

#[test]
fn test_v6_crank_rebind_expired_randomness_1000_slot_boundary() {
    let mut ctx = setup_e2e();
    let (pool_pda_addr, _) = pool_pda(1);
    let (draw_cycle_pda, _) = draw_cycle_pda(1, 0);
    let (global_config_pda_addr, _) = global_config_pda();

    let old_randomness = Keypair::new().pubkey();
    let draw_cycle = anchor::state::DrawCycle {
        prize_pot: 1_000_000,
        cycle_fee_collected: 0,
        harvest_slot: 500,
        initiated_at: 1000,
        completed_at: 0,
        randomness_account: old_randomness,
        pool_id: 1,
        cycle_id: 0,
        locked_ticket_count: 10,
        status: anchor::state::DrawStatus::AwaitingRandomness,
        version: 1,
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

    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        crank: ctx.admin.pubkey(), // admin is jobs_account in setup_e2e
        global_config: global_config_pda_addr,
        pool: pool_pda_addr,
        current_draw_cycle: draw_cycle_pda,
        current_randomness_account: old_randomness,
        new_randomness_account: new_randomness,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: accounts.clone(),
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg =
        Message::new_with_blockhash(std::slice::from_ref(&ix), Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotExpired);

    // Boundary Test 2: at slot 1501 (1501 - 500 = 1001, strictly > 1000) -> MUST SUCCEED
    ctx.svm.warp_to_slot(1501);
    ctx.svm.expire_blockhash();
    let bh2 = ctx.svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&ctx.admin]).unwrap();
    ctx.svm.send_transaction(tx2).unwrap();

    // Verify randomness account was updated to new_randomness
    let dc_acc = ctx.svm.get_account(&draw_cycle_pda).unwrap();
    let mut dc_slice = &dc_acc.data[8..];
    let updated_dc = anchor::state::DrawCycle::deserialize(&mut dc_slice).unwrap();
    assert_eq!(updated_dc.randomness_account, new_randomness);
    assert_eq!(updated_dc.harvest_slot, 1501);
}

// ─── Vector 7: CPI & Security Boundaries ────────────────────────────────────

#[test]
fn test_v7_claim_redemption_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 1_000_000, 1_000_000);

    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (pool_vault, _) = pool_vault_pda(1);
    let user_token =
        create_spl_token_account(&mut ctx.svm, &ctx.user, &ctx.usdc_mint, &ctx.user.pubkey());
    let mut huma = TestHumaAccounts::from_e2e(&ctx);
    huma.huma_pool_state = spoofed_huma_state;

    let ix = build_claim_redemption_ix(
        ctx.user.pubkey(),
        ctx.user.pubkey(),
        1,
        0,
        ctx.usdc_mint,
        user_token,
        &huma,
        Some(pool_vault),
    );

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidHumaPoolState);
}

// ─── 100% Error Code Coverage: UnsupportedAccountVersion Across 9 Structs ───

#[test]
fn test_unsupported_account_version_all_9_structs() {
    use anchor::error::PremiumBondsError;
    use anchor::state::{
        DrawCycle, GlobalConfig, PayoutRegistry, PendingRedemption, PrizePool, TicketRegistry,
        UserEntry, UserWinnings, Winner,
    };

    // 1. GlobalConfig
    let mut gc = GlobalConfig {
        admin: Pubkey::default(),
        guardian: Pubkey::default(),
        jobs_account: Pubkey::default(),
        pending_admin: Pubkey::default(),
        version: GlobalConfig::CURRENT_VERSION + 1,
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
        harvest_slot: 0,
        initiated_at: 0,
        completed_at: 0,
        randomness_account: Pubkey::default(),
        pool_id: 1,
        cycle_id: 1,
        locked_ticket_count: 0,
        status: anchor::state::DrawStatus::AwaitingYield,
        version: DrawCycle::CURRENT_VERSION + 1,
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
        huma_request_id: 0,
        redemption_id: 1,
        amount: 100,
        pst_shares_locked: 100,
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
}
