//! Adversarial review (2026-10) — deterministic LiteSVM exploit PoCs.
//!
//! Each test asserts the CURRENT (vulnerable) behaviour. Once the corresponding fix lands,
//! flip the assertions to the expected custom error as documented inline.

use {
    anchor::{error::PremiumBondsError, PoolStatus},
    anchor_lang::{InstructionData, ToAccountMetas},
    solana_keypair::Keypair,
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::signature::Signer,
};

mod common;
use common::*;

/// Builds a `recapitalize_pool` instruction for an arbitrary (unprivileged) sponsor.
fn build_recapitalize_ix(ctx: &E2eContext, sponsor: &Pubkey, sponsor_usdc: Pubkey, amount: u64) -> Instruction {
    let dummy = Keypair::new().pubkey();
    Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::RecapitalizePool {
            sponsor: *sponsor,
            pool: pool_pda(1).0,
            sponsor_token_account: sponsor_usdc,
            token_mint: ctx.usdc_mint,
            pool_vault_account: pool_vault_pda(1).0,
            pool_pst_vault: pool_pst_vault_pda(1).0,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: ctx.huma_pool_state,
            huma_mode_config: dummy,
            huma_mode_mint: ctx.pst_mint,
            huma_pool_authority: ctx.huma_pool_authority,
            huma_pool_underlying_token: ctx.huma_pool_underlying_token,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::RecapitalizePool { amount }.data(),
    }
}

fn build_enable_impaired_ix(ctx: &E2eContext, caller: &Pubkey) -> Instruction {
    Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::EnableImpairedMode {
            caller: *caller,
            global_config: global_config_pda().0,
            pool: pool_pda(1).0,
            pool_pst_vault: pool_pst_vault_pda(1).0,
            pst_mint: ctx.pst_mint,
            huma_pool_state: ctx.huma_pool_state,
            pst_token_program: anchor_spl::token::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::EnableImpairedMode {}.data(),
    }
}

fn funded_attacker(ctx: &mut E2eContext, usdc: u64) -> (Keypair, Pubkey) {
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let ata = create_spl_token_account(&mut ctx.svm, &attacker, &ctx.usdc_mint, &attacker.pubkey());
    set_token_balance(&mut ctx.svm, ata, usdc);
    (attacker, ata)
}

fn submit_accumulating_batch(ctx: &mut E2eContext) -> TxResult {
    let pool = read_pool_state(&ctx.svm, 1);
    let admin = clone_keypair(&ctx.admin);
    ctx.svm.expire_blockhash();
    CrankSubmitRedemptionBatchBuilder::from_ctx(ctx, pool.accumulating_redemption_batch_id)
        .send(&mut ctx.svm, &admin)
}

// ─────────────────────────────────────────────────────────────────────────────
// H-01: Permissionless `recapitalize_pool` cannot unpause a paused pool.
//
// AFTER FIX: Recapitalizing with dust (or any amount) cures deficit or leaves deficit,
// but leaves the pool `Paused`. Status transitions out of Paused are strictly reserved
// for admin multisig via `unpause_pool`.
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn poc_h01_anyone_can_unpause_guardian_paused_pool_via_dust_recapitalize() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Guardian (== admin in setup_e2e) triggers an emergency pause on a SOLVENT pool.
    send_pause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    assert_eq!(read_pool_state(&ctx.svm, 1).status, PoolStatus::Paused as u8);

    // Admin-gated unpause correctly rejects the attacker...
    let (attacker, attacker_usdc) = funded_attacker(&mut ctx, 1);
    let res = send_unpause_pool(&mut ctx.svm, &attacker, 1);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);

    // Recapitalizing with 1 base unit of USDC ($0.000001) succeeds, but POOL REMAINS PAUSED!
    let ix = build_recapitalize_ix(&ctx, &attacker.pubkey(), attacker_usdc, 1);
    let res = send_user_tx(&mut ctx.svm, &attacker, ix);
    assert!(res.is_ok(), "dust recapitalize should succeed: {res:?}");

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        pool.status,
        PoolStatus::Paused as u8,
        "FIX VERIFIED: pool remains Paused after recapitalization"
    );
    assert!(pool.deactivated_at > 0);

    // Attacker still cannot unpause
    ctx.svm.expire_blockhash();
    let res_unpause = send_unpause_pool(&mut ctx.svm, &attacker, 1);
    assert_custom_error(res_unpause, PremiumBondsError::UnauthorizedAdmin);

    // Admin explicitly unpauses pool
    ctx.svm.expire_blockhash();
    send_unpause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let pool_post = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_post.status, PoolStatus::Active as u8);
    assert_eq!(pool_post.deactivated_at, 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// H-02a: A `Closed` pool that becomes insolvent can transition to `Impaired`.
//
// AFTER FIX: `enable_impaired_mode` succeeds on an insolvent Closed pool and the
// subsequent submission succeeds with pro-rata shares.
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn poc_h02a_closed_pool_venue_loss_permanently_locks_redemptions() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Orderly sunset of a healthy pool.
    send_close_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let pool_closed = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_closed.status, PoolStatus::Closed as u8);
    assert!(pool_closed.deactivated_at > 0);

    // Huma suffers a 50% loss after closure.
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 5_000_000);

    // Users can still queue sales at par (Closed != Paused)...
    let user = clone_keypair(&ctx.user);
    send_e2e_sell_bonds(&mut ctx, &user, 0, 4).unwrap();

    // Before impairment, submission fails because venue is insolvent.
    let res = submit_accumulating_batch(&mut ctx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Admin transitions the closed insolvent pool to Impaired mode!
    ctx.svm.expire_blockhash();
    let admin_pk = ctx.admin.pubkey();
    let ix = build_enable_impaired_ix(&ctx, &admin_pk);
    let res_imp = send_user_tx(&mut ctx.svm, &ctx.admin, ix);
    assert!(res_imp.is_ok(), "Admin can enable impaired mode on Closed insolvent pool: {res_imp:?}");

    let pool_impaired = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_impaired.status, PoolStatus::Impaired as u8);

    // Now submission succeeds under Impaired pro-rata haircut math!
    let res_submit = submit_accumulating_batch(&mut ctx);
    assert!(res_submit.is_ok(), "Redemption batch submission succeeds in Impaired mode: {res_submit:?}");
}

// ─────────────────────────────────────────────────────────────────────────────
// H-02b: Closing an Impaired pool is rejected.
//
// AFTER FIX: `close_pool` on an Impaired pool must fail with `PremiumBondsError::PoolImpaired`.
// ─────────────────────────────────────────────────────────────────────────────
#[test]
fn poc_h02b_closing_impaired_pool_bricks_pro_rata_workout() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    send_pause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 5_000_000);

    let admin_pk = ctx.admin.pubkey();
    let ix = build_enable_impaired_ix(&ctx, &admin_pk);
    send_user_tx(&mut ctx.svm, &ctx.admin, ix).unwrap();
    assert_eq!(read_pool_state(&ctx.svm, 1).status, PoolStatus::Impaired as u8);

    // In Impaired mode the user queues a sale.
    let user = clone_keypair(&ctx.user);
    send_e2e_sell_bonds(&mut ctx, &user, 0, 4).unwrap();

    // Admin attempts to close the Impaired pool — MUST BE REJECTED with PoolImpaired!
    ctx.svm.expire_blockhash();
    let res_close = send_close_pool(&mut ctx.svm, &ctx.admin, 1);
    assert_custom_error(res_close, PremiumBondsError::PoolImpaired);

    // Impaired status remains preserved and pro-rata submission works!
    let res = submit_accumulating_batch(&mut ctx);
    assert!(res.is_ok(), "Workout submission succeeds as pool remained Impaired: {res:?}");
}

// ─────────────────────────────────────────────────────────────────────────────
// Additional Vectors for H-01, H-02, and L-02
// ─────────────────────────────────────────────────────────────────────────────

#[test]
fn test_recapitalize_on_active_pool_rejected() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let (sponsor, sponsor_usdc) = funded_attacker(&mut ctx, 10_000_000);
    let ix = build_recapitalize_ix(&ctx, &sponsor.pubkey(), sponsor_usdc, 1_000_000);
    let res = send_user_tx(&mut ctx.svm, &sponsor, ix);
    assert_custom_error(res, PremiumBondsError::PoolNotPausedOrClosed);
}

#[test]
fn test_recapitalize_on_impaired_pool_rejected() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    send_pause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 5_000_000);

    let admin_pk = ctx.admin.pubkey();
    let ix_imp = build_enable_impaired_ix(&ctx, &admin_pk);
    send_user_tx(&mut ctx.svm, &ctx.admin, ix_imp).unwrap();
    assert_eq!(read_pool_state(&ctx.svm, 1).status, PoolStatus::Impaired as u8);

    let (sponsor, sponsor_usdc) = funded_attacker(&mut ctx, 10_000_000);
    let ix_recap = build_recapitalize_ix(&ctx, &sponsor.pubkey(), sponsor_usdc, 1_000_000);
    let res = send_user_tx(&mut ctx.svm, &sponsor, ix_recap);
    assert_custom_error(res, PremiumBondsError::PoolNotPausedOrClosed);
}

#[test]
fn test_recapitalize_on_closed_pool_accepted() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    send_close_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let pool_before = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_before.status, PoolStatus::Closed as u8);

    let (sponsor, sponsor_usdc) = funded_attacker(&mut ctx, 10_000_000);
    let ix = build_recapitalize_ix(&ctx, &sponsor.pubkey(), sponsor_usdc, 1_000_000);
    let res = send_user_tx(&mut ctx.svm, &sponsor, ix);
    assert!(res.is_ok(), "Recapitalizing a closed pool should succeed: {res:?}");

    let pool_after = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_after.status, PoolStatus::Closed as u8);
}

#[test]
fn test_permissionless_impairment_on_closed_pool_timelock_boundaries() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    send_close_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let pool = read_pool_state(&ctx.svm, 1);
    let deactivated_at = pool.deactivated_at;
    assert!(deactivated_at > 0);

    // Pool venue insolvent
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 5_000_000);

    let (keeper, _) = funded_attacker(&mut ctx, 1_000_000);
    let ix = build_enable_impaired_ix(&ctx, &keeper.pubkey());

    // 1. Keeper at deactivated_at + 90 days - 1 second -> fails with ImpairmentTimelockActive
    warp_to_timestamp(&mut ctx.svm, deactivated_at + 90 * 86_400 - 1);
    let res_early = send_user_tx(&mut ctx.svm, &keeper, ix.clone());
    assert_custom_error(res_early, PremiumBondsError::ImpairmentTimelockActive);

    // 2. Keeper at deactivated_at + 90 days -> succeeds!
    warp_to_timestamp(&mut ctx.svm, deactivated_at + 90 * 86_400);
    let res_ok = send_user_tx(&mut ctx.svm, &keeper, ix);
    assert!(res_ok.is_ok(), "Keeper can trigger impairment on Closed pool after 90 days: {res_ok:?}");

    let pool_post = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_post.status, PoolStatus::Impaired as u8);
}

#[test]
fn test_lifecycle_active_paused_active_closed() {
    let mut ctx = setup_e2e();

    // 1. Active -> Paused
    let pause_meta = send_pause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let pause_event = assert_cpi_event::<anchor::events::PoolStatusChanged>(&pause_meta);
    let t1 = pause_event.timestamp;
    let pool_paused = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_paused.status, PoolStatus::Paused as u8);
    assert_eq!(pool_paused.deactivated_at, t1);

    // 2. Paused -> Active
    send_unpause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let pool_active = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_active.status, PoolStatus::Active as u8);
    assert_eq!(pool_active.deactivated_at, 0);

    // Warp time forward
    warp_to_timestamp(&mut ctx.svm, t1 + 10_000);

    // 3. Active -> Closed
    let close_meta = send_close_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    let close_event = assert_cpi_event::<anchor::events::PoolStatusChanged>(&close_meta);
    let t2 = close_event.timestamp;
    assert!(t2 > t1);

    let pool_closed = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool_closed.status, PoolStatus::Closed as u8);
    assert_eq!(pool_closed.deactivated_at, t2);
}

#[test]
fn test_reveal_and_pick_winners_rejected_on_impaired_pool() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    send_pause_pool(&mut ctx.svm, &ctx.admin, 1).unwrap();
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 5_000_000);

    let admin_pk = ctx.admin.pubkey();
    let ix_imp = build_enable_impaired_ix(&ctx, &admin_pk);
    send_user_tx(&mut ctx.svm, &ctx.admin, ix_imp).unwrap();
    assert_eq!(read_pool_state(&ctx.svm, 1).status, PoolStatus::Impaired as u8);

    let randomness_account = Keypair::new().pubkey();
    inject_randomness_account_data(&mut ctx.svm, randomness_account, 100, 105, [1u8; 32]);

    DrawCycleTestBuilder::new(1, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_randomness_account(randomness_account)
        .with_vrf_seed_slot(100)
        .inject(&mut ctx.svm);

    let res = RevealAndPickWinnersBuilder::for_pool(1, 0, ctx.admin.pubkey())
        .with_ticket_registry(ctx.ticket_registry)
        .with_randomness_account(randomness_account)
        .send(&mut ctx.svm, &ctx.admin);
    assert_custom_error(res, PremiumBondsError::PoolImpaired);
}
