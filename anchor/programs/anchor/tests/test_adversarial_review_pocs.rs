use {
    anchor::error::PremiumBondsError,
    anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::{account::Account, signature::Signer},
};

mod common;
use common::*;

#[test]
fn poc_h1_rebind_after_public_reveal_rerolls_draw() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let cycle_id = 0;
    let vrf_seed_slot = 100;

    let current_randomness = Keypair::new().pubkey();
    let mut dc = default_draw_cycle(pool_id, cycle_id, anchor::DrawStatus::AwaitingRandomness);
    dc.vrf_seed_slot = vrf_seed_slot;
    dc.randomness_account = current_randomness;
    inject_draw_cycle(&mut ctx.svm, pool_id, cycle_id, &dc);

    // Bound account is revealed on-chain at slot 105 with a known value
    inject_randomness_account_data(
        &mut ctx.svm,
        current_randomness,
        vrf_seed_slot,
        105,
        [42u8; 32],
    );

    // Warp past the 1,000-slot freshness window
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 100;
    ctx.svm.warp_to_slot(expired_slot);

    let new_randomness = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut ctx.svm, new_randomness);

    let ix = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let res = send_user_tx(&mut ctx.svm, &ctx.admin, ix);

    // AFTER FIX: Must fail with RandomnessAlreadyRevealed
    assert_custom_error(res, PremiumBondsError::RandomnessAlreadyRevealed);
}

#[test]
fn poc_h1_rebind_after_recommit_rerolls_draw() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let cycle_id = 0;
    let vrf_seed_slot = 100;

    let current_randomness = Keypair::new().pubkey();
    let mut dc = default_draw_cycle(pool_id, cycle_id, anchor::DrawStatus::AwaitingRandomness);
    dc.vrf_seed_slot = vrf_seed_slot;
    dc.randomness_account = current_randomness;
    inject_draw_cycle(&mut ctx.svm, pool_id, cycle_id, &dc);

    // Bound account re-committed at slot 150 (seed_slot changed)
    inject_randomness_account_data(
        &mut ctx.svm,
        current_randomness,
        150,
        0,
        [0u8; 32],
    );

    // Warp past both freshness windows (100+1000 and 150+1000)
    ctx.svm.warp_to_slot(2000);

    let new_randomness = Keypair::new().pubkey();
    let fresh_seed_slot = 1999;
    inject_randomness_account_data(&mut ctx.svm, new_randomness, fresh_seed_slot, 0, [0u8; 32]);

    let ix = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let res = send_user_tx(&mut ctx.svm, &ctx.admin, ix);

    // AFTER FIX: Must fail with RandomnessCommitmentTampered
    assert_custom_error(res, PremiumBondsError::RandomnessCommitmentTampered);
}

#[test]
fn poc_h1_rebind_closed_account_rejected() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let cycle_id = 0;
    let vrf_seed_slot = 100;

    let current_randomness = Keypair::new().pubkey();
    let mut dc = default_draw_cycle(pool_id, cycle_id, anchor::DrawStatus::AwaitingRandomness);
    dc.vrf_seed_slot = vrf_seed_slot;
    dc.randomness_account = current_randomness;
    inject_draw_cycle(&mut ctx.svm, pool_id, cycle_id, &dc);

    // Current randomness account is closed (0 lamports, 0 data)
    ctx.svm.set_account(current_randomness, Account::default()).unwrap();

    ctx.svm.warp_to_slot(1200);

    let new_randomness = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut ctx.svm, new_randomness);

    let ix = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let res = send_user_tx(&mut ctx.svm, &ctx.admin, ix);

    // AFTER FIX: Must cleanly return RandomnessCommitmentTampered
    assert_custom_error(res, PremiumBondsError::RandomnessCommitmentTampered);
}

#[test]
fn poc_h1_revealed_value_unconsumable_after_reveal_slot() {
    let mut fixture = RevealFixture::builder()
        .with_pool_id(1)
        .with_cycle_id(0)
        .with_draw_status(anchor::DrawStatus::AwaitingRandomness)
        .build();

    let dc = read_draw_cycle_state(&fixture.svm, 1, 0);

    // Randomness is revealed at slot 105 with a valid value
    inject_randomness_account_data(
        &mut fixture.svm,
        fixture.randomness_account,
        dc.vrf_seed_slot,
        105,
        [7u8; 32],
    );

    // Warp to slot 108 (> reveal_slot 105)
    fixture.svm.warp_to_slot(108);

    let crank = clone_keypair(&fixture.crank);
    let res = RevealAndPickWinnersBuilder::for_pool(1, 0, crank.pubkey())
        .with_ticket_registry(fixture.ticket_registry)
        .with_randomness_account(fixture.randomness_account)
        .send(&mut fixture.svm, &crank);

    // AFTER FIX: Must succeed because revealed randomness is permanent and consumed in later slot!
    assert!(
        res.is_ok(),
        "Revealed randomness must be consumable in later slot: {res:?}"
    );
}

#[test]
fn poc_h1_admin_force_unlock_rejected_if_already_revealed() {
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), None);

    let ticket_registry = Keypair::new().pubkey();
    let randomness_account = Keypair::new().pubkey();

    let (pool_key, _) = PrizePoolTestBuilder::new(1)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_solvency_state(0, 1_000_000, 100_000)
        .with_current_draw_cycle_id(0)
        .with_cycle_end_at(i64::MAX)
        .inject(&mut svm);

    let (current_draw_cycle, _) = DrawCycleTestBuilder::new(1, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_locked_tickets(10)
        .with_prize_pot(1_000_000)
        .with_cycle_fee(100_000)
        .with_vrf_seed_slot(100)
        .with_randomness_account(randomness_account)
        .inject(&mut svm);

    // Inject revealed randomness account
    inject_randomness_account_data(
        &mut svm,
        randomness_account,
        100,
        105,
        [99u8; 32],
    );

    let res = AdminForceUnlockDrawBuilder::new(admin.pubkey(), 1, 0)
        .with_pool(pool_key)
        .with_current_draw_cycle(current_draw_cycle)
        .send(&mut svm, &admin);

    // AFTER FIX: Must fail with RandomnessAlreadyRevealed
    assert_custom_error(res, PremiumBondsError::RandomnessAlreadyRevealed);
}

#[test]
fn poc_h2_last_claimant_absorbs_settlement_loss() {
    // // KNOWN ISSUE H-2: Characterization test for first-come first-served redemption loss
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // User buys 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // User sells 5 bonds (receipt 0)
    let res0 = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        5,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert!(res0.is_ok(), "Sell bonds 0: {res0:?}");

    // User sells another 5 bonds (receipt 1)
    let res1 = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        5,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert!(res1.is_ok(), "Sell bonds 1: {res1:?}");

    // Settle both redemptions on Huma, but Huma experiences a 10% haircut:
    // 10 USDC principal yields only 9 USDC redeemed back into vault.
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 10_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 2);

    // Inject huma_pool_underlying_token with 9_000_000 instead of 10_000_000
    inject_token_account(
        &mut ctx.svm,
        ctx.huma_pool_underlying_token,
        ctx.usdc_mint,
        ctx.huma_pool_authority,
        9_000_000,
    );

    let user_usdc = ctx.user_usdc_account;

    // First claimant claims receipt 0: gets full 5_000_000 USDC
    let claim0 = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(claim0.is_ok(), "Claim 0 should receive full payout: {claim0:?}");

    // Second claimant claims receipt 1: vault only has 4_000_000 USDC left!
    let claim1 = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_usdc,
        1,
        Pubkey::default(),
        huma_lender_state,
    );
    assert_custom_error(claim1, PremiumBondsError::InsufficientVaultBalance);
}

#[test]
fn poc_l1_snapshot_mismatch_is_silent() {
    // RevealFixture with locked_tickets = 40, but registry entries sum to 30
    let mut fixture = RevealFixture::builder()
        .with_pool_id(1)
        .with_cycle_id(0)
        .with_locked_tickets(40) // 40 locked
        .build();

    let dc = read_draw_cycle_state(&fixture.svm, 1, 0);

    // Build registry with 30 tickets
    let user1 = Keypair::new().pubkey();
    let entries = vec![
        anchor::state::UserEntry {
            owner: user1,
            active: 30,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 30,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
    ];
    inject_registry_with_state(
        &mut fixture.svm,
        fixture.ticket_registry,
        1,
        10,
        0,
        1, // draw_prepared_up_to = user_count = 1
        &entries,
    );

    // Reveal at current slot
    let clock: solana_sdk::clock::Clock = fixture.svm.get_sysvar();
    inject_randomness_account_data(
        &mut fixture.svm,
        fixture.randomness_account,
        dc.vrf_seed_slot,
        clock.slot,
        [0u8; 32], // lands on index 0
    );

    let crank = clone_keypair(&fixture.crank);
    let res = RevealAndPickWinnersBuilder::for_pool(1, 0, crank.pubkey())
        .with_ticket_registry(fixture.ticket_registry)
        .with_randomness_account(fixture.randomness_account)
        .send(&mut fixture.svm, &crank);

    // AFTER FIX: Must fail with DrawSnapshotMismatch
    assert_custom_error(res, PremiumBondsError::DrawSnapshotMismatch);
}

#[test]
fn poc_m2_reveal_blocked_while_paused() {
    let mut fixture = RevealFixture::builder()
        .with_pool_id(1)
        .with_cycle_id(0)
        .build();

    let dc = read_draw_cycle_state(&fixture.svm, 1, 0);
    let clock: solana_sdk::clock::Clock = fixture.svm.get_sysvar();
    inject_randomness_account_data(
        &mut fixture.svm,
        fixture.randomness_account,
        dc.vrf_seed_slot,
        clock.slot,
        [42u8; 32],
    );

    // Pause pool
    send_pause_pool(&mut fixture.svm, &fixture.admin, 1).unwrap();

    let crank = clone_keypair(&fixture.crank);
    let res = RevealAndPickWinnersBuilder::for_pool(1, 0, crank.pubkey())
        .with_ticket_registry(fixture.ticket_registry)
        .with_randomness_account(fixture.randomness_account)
        .send(&mut fixture.svm, &crank);

    // AFTER FIX: Must succeed
    assert!(
        res.is_ok(),
        "Reveal while paused must succeed: {res:?}"
    );
}

#[test]
fn poc_m2_prepare_draw_blocked_while_paused() {
    let mut fixture = RevealFixture::builder()
        .with_pool_id(1)
        .with_cycle_id(0)
        .with_draw_status(anchor::DrawStatus::AwaitingRandomness)
        .build();

    // Reset draw_prepared_up_to to 0
    mutate_ticket_registry_header(&mut fixture.svm, fixture.ticket_registry, |reg| {
        reg.draw_prepared_up_to = 0;
    });

    // Set pool frozen
    mutate_pool_state(&mut fixture.svm, 1, |pool| {
        pool.is_frozen_for_draw = 1;
    });

    // Pause pool
    send_pause_pool(&mut fixture.svm, &fixture.admin, 1).unwrap();

    let crank = clone_keypair(&fixture.crank);
    let (pool_pda_addr, _) = pool_pda(1);
    let (draw_cycle_pda_addr, _) = draw_cycle_pda(1, 0);
    let mut builder = PrepareDrawBuilder::for_pool(1, 0, crank.pubkey());
    builder.accounts.pool = pool_pda_addr;
    builder.accounts.draw_cycle = draw_cycle_pda_addr;
    builder.accounts.ticket_registry = fixture.ticket_registry;
    builder.batch_size = 10;
    let res = builder.send(&mut fixture.svm, &crank);

    // AFTER FIX: Must succeed
    assert!(
        res.is_ok(),
        "Prepare draw while paused must succeed: {res:?}"
    );
}

#[test]
fn poc_h1_admin_force_unlock_dummy_account_bypass() {
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), None);

    let ticket_registry = Keypair::new().pubkey();
    let randomness_account = Keypair::new().pubkey();

    let (pool_key, _) = PrizePoolTestBuilder::new(1)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_solvency_state(0, 1_000_000, 100_000)
        .with_current_draw_cycle_id(0)
        .with_cycle_end_at(i64::MAX)
        .inject(&mut svm);

    let (current_draw_cycle, _) = DrawCycleTestBuilder::new(1, 0)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_locked_tickets(10)
        .with_prize_pot(1_000_000)
        .with_cycle_fee(100_000)
        .with_vrf_seed_slot(100)
        .with_randomness_account(randomness_account)
        .inject(&mut svm);

    // Randomness is revealed
    inject_randomness_account_data(
        &mut svm,
        randomness_account,
        100,
        105,
        [99u8; 32],
    );

    // Pass a dummy uninitialized account instead of current_draw_cycle.randomness_account
    let dummy_randomness_account = Keypair::new().pubkey();
    let res = AdminForceUnlockDrawBuilder::new(admin.pubkey(), 1, 0)
        .with_pool(pool_key)
        .with_current_draw_cycle(current_draw_cycle)
        .with_current_randomness_account(dummy_randomness_account)
        .send(&mut svm, &admin);

    // AFTER FIX: When constraint is enforced, passing dummy account fails with InvalidRandomnessAccount
    assert_custom_error(res, PremiumBondsError::InvalidRandomnessAccount);
}
