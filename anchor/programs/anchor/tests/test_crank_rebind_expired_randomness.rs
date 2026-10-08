use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{account::Account, signature::Keypair, signer::Signer};

mod common;
use common::*;

struct RebindCtx {
    svm: LiteSVM,
    crank: Keypair,
    pool_key: Pubkey,
    current_draw_cycle: Pubkey,
    current_randomness_account: Pubkey,
    new_randomness_account: Pubkey,
}

fn setup(draw_status: anchor::DrawStatus, vrf_seed_slot: u64) -> RebindCtx {
    let (mut svm, _admin, crank) = setup_global_with_crank();

    let ticket_registry = Keypair::new().pubkey();
    let (pool_key, _) = PrizePoolTestBuilder::new(1)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let current_randomness_account = Keypair::new().pubkey();
    inject_randomness_account_data(
        &mut svm,
        current_randomness_account,
        vrf_seed_slot,
        0,
        [0u8; 32],
    );

    let (current_draw_cycle, _) = DrawCycleTestBuilder::new(1, 0)
        .with_status(draw_status)
        .with_locked_tickets(10)
        .with_prize_pot(1_000_000)
        .with_randomness_account(current_randomness_account)
        .with_vrf_seed_slot(vrf_seed_slot)
        .inject(&mut svm);

    // Create a new randomness account owned by Switchboard On-Demand
    let new_randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, new_randomness_account);

    RebindCtx {
        svm,
        crank,
        pool_key,
        current_draw_cycle,
        current_randomness_account,
        new_randomness_account,
    }
}

fn send_rebind(ctx: &mut RebindCtx, signer: &Keypair) -> TxResult {
    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();

    CrankRebindExpiredRandomnessBuilder::new(
        signer.pubkey(),
        1,
        0,
        dc.randomness_account,
        ctx.new_randomness_account,
    )
    .with_pool(ctx.pool_key)
    .with_current_draw_cycle(ctx.current_draw_cycle)
    .send(&mut ctx.svm, signer)
}

#[test]
fn test_rebind_fails_mismatched_current_randomness_account() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);
    inject_mock_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        1,
        0,
        Keypair::new().pubkey(), // Mismatched!
        ctx.new_randomness_account,
    )
    .with_pool(ctx.pool_key)
    .with_current_draw_cycle(ctx.current_draw_cycle)
    .send(&mut ctx.svm, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_rebind_happy_path() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);
    let new_seed_slot = expired_slot.saturating_sub(1);
    inject_randomness_account_data(
        &mut ctx.svm,
        ctx.new_randomness_account,
        new_seed_slot,
        0,
        [0u8; 32],
    );

    let crank = clone_keypair(&ctx.crank);
    let meta = send_rebind(&mut ctx, &crank).unwrap();
    let event = assert_cpi_event::<anchor::events::RandomnessRebound>(&meta);
    assert_eq!(
        event.crank,
        crank.pubkey(),
        "RandomnessRebound crank mismatch"
    );
    assert_eq!(event.pool_id, 1, "RandomnessRebound pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "RandomnessRebound cycle_id mismatch");
    assert_eq!(
        event.old_randomness_account, ctx.current_randomness_account,
        "RandomnessRebound old_randomness_account mismatch"
    );
    assert_eq!(
        event.new_randomness_account, ctx.new_randomness_account,
        "RandomnessRebound new_randomness_account mismatch"
    );
    assert_eq!(
        event.vrf_seed_slot, new_seed_slot,
        "RandomnessRebound vrf_seed_slot mismatch"
    );
    assert_eq!(
        event.rebind_count, 1,
        "RandomnessRebound rebind_count mismatch"
    );

    // Verify draw cycle randomness account is updated and vrf_seed_slot reset
    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(
        dc.randomness_account, ctx.new_randomness_account,
        "DrawCycle randomness_account must match new randomness account"
    );
    assert_eq!(
        dc.vrf_seed_slot, new_seed_slot,
        "DrawCycle vrf_seed_slot must be updated to new seed slot"
    );
    assert_eq!(
        dc.rebind_count, 1,
        "DrawCycle rebind_count must be updated to 1"
    );
}

#[test]
fn test_rebind_fails_unauthorized_crank() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    let fake_crank = Keypair::new();
    ctx.svm
        .airdrop(&fake_crank.pubkey(), 10_000_000_000)
        .unwrap();

    let res = send_rebind(&mut ctx, &fake_crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedCrank);
}

#[test]
fn test_rebind_fails_invalid_draw_status() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::Complete, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;
    ctx.svm.warp_to_slot(expired_slot);
    inject_mock_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
}

#[test]
fn test_rebind_fails_randomness_not_expired() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let not_expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS;

    ctx.svm.warp_to_slot(not_expired_slot);
    inject_mock_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotExpired);
}

#[test]
fn test_rebind_succeeds_with_configured_switchboard_owner() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;
    ctx.svm.warp_to_slot(expired_slot);

    let new_seed_slot = expired_slot.saturating_sub(1);
    inject_randomness_account_data_with_owner(
        &mut ctx.svm,
        ctx.new_randomness_account,
        new_seed_slot,
        0,
        [0u8; 32],
        anchor::constants::SWITCHBOARD_ON_DEMAND_PID,
    );

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert!(
        res.is_ok(),
        "Rebind must accept configured Switchboard PID: {:?}",
        res.err()
    );
}

#[test]
fn test_rebind_fails_unconfigured_switchboard_owner() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);

    let new_seed_slot = expired_slot.saturating_sub(1);
    inject_randomness_account_data_with_owner(
        &mut ctx.svm,
        ctx.new_randomness_account,
        new_seed_slot,
        0,
        [0u8; 32],
        anchor::constants::UNCONFIGURED_SWITCHBOARD_ON_DEMAND_PID,
    );

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_rebind_fails_invalid_randomness_account_owner() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);

    let new_seed_slot = expired_slot.saturating_sub(1);
    inject_randomness_account_data_with_owner(
        &mut ctx.svm,
        ctx.new_randomness_account,
        new_seed_slot,
        0,
        [0u8; 32],
        Pubkey::new_unique(),
    );

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_rebind_fails_invalid_randomness_account_discriminator() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);

    inject_corrupted_randomness_discriminator(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_rebind_fails_truncated_randomness_account() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);

    inject_truncated_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_rebind_fails_zero_byte_randomness_account() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;

    ctx.svm.warp_to_slot(expired_slot);

    inject_zero_byte_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_crank_rebind_exact_slot_boundary() {
    let vrf_seed_slot = 100;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);

    // Boundary 1: Exactly VRF_FRESHNESS_WINDOW_SLOTS passed. vrf_seed_slot + 1000 (not > 1000).
    let boundary_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS;
    ctx.svm.warp_to_slot(boundary_slot);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotExpired);

    // Boundary 2: VRF_FRESHNESS_WINDOW_SLOTS + 1 passed. (> 1000). Should succeed!
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;
    ctx.svm.warp_to_slot(expired_slot);
    ctx.svm.expire_blockhash();

    let new_seed_slot = expired_slot.saturating_sub(1);
    inject_randomness_account_data(
        &mut ctx.svm,
        ctx.new_randomness_account,
        new_seed_slot,
        0,
        [0u8; 32],
    );

    let meta = send_rebind(&mut ctx, &crank)
        .expect("rebind at exact expiration slot boundary should succeed");
    let event = assert_cpi_event::<anchor::events::RandomnessRebound>(&meta);
    assert_eq!(
        event.crank,
        crank.pubkey(),
        "RandomnessRebound crank mismatch"
    );
    assert_eq!(event.pool_id, 1, "RandomnessRebound pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "RandomnessRebound cycle_id mismatch");
    assert_eq!(
        event.old_randomness_account, ctx.current_randomness_account,
        "RandomnessRebound old_randomness_account mismatch"
    );
    assert_eq!(
        event.new_randomness_account, ctx.new_randomness_account,
        "RandomnessRebound new_randomness_account mismatch"
    );
    assert_eq!(
        event.vrf_seed_slot, new_seed_slot,
        "RandomnessRebound vrf_seed_slot mismatch"
    );
    assert_eq!(
        event.rebind_count, 1,
        "RandomnessRebound rebind_count mismatch"
    );
}

#[test]
fn test_rebind_fails_same_randomness_account() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);

    // Set existing draw cycle randomness account to match ctx.new_randomness_account
    mutate_draw_cycle(&mut ctx.svm, 1, 0, |dc| {
        dc.randomness_account = ctx.new_randomness_account;
    });

    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;
    ctx.svm.warp_to_slot(expired_slot);
    inject_mock_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::SameRandomnessAccount);
}

#[test]
fn test_rebind_fails_unoverridable_statuses() {
    for status in [
        anchor::DrawStatus::HaltedInsolvent,
        anchor::DrawStatus::HaltedYieldSpike,
        anchor::DrawStatus::Skipped,
        anchor::DrawStatus::ForceUnlocked,
        anchor::DrawStatus::Voided,
    ] {
        let vrf_seed_slot = 0;
        let mut ctx = setup(status, vrf_seed_slot);
        let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;
        ctx.svm.warp_to_slot(expired_slot);
        inject_mock_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

        let crank = clone_keypair(&ctx.crank);
        let res = send_rebind(&mut ctx, &crank);
        assert_custom_error_msg(
            res,
            anchor::error::PremiumBondsError::InvalidDrawStatus,
            &format!("Failed for draw status {status:?}"),
        );
    }
}

#[test]
fn test_rebind_fails_pool_paused() {
    let vrf_seed_slot = 0;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let expired_slot = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1;
    ctx.svm.warp_to_slot(expired_slot);
    inject_mock_randomness_account(&mut ctx.svm, ctx.new_randomness_account);

    mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.status = anchor::PoolStatus::Paused as u8;
    });

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolNotActive);
}

#[test]
fn test_crank_rebind_full_lifecycle() {
    let mut fixture = RevealFixture::builder()
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_tiers(vec![anchor::PrizeTier::default_single_winner()])
        .with_locked_tickets(5)
        .with_prize_pot(1_000_000)
        .with_num_tickets(5)
        .with_draw_status(anchor::DrawStatus::AwaitingRandomness)
        .build();

    let initial_vrf_seed_slot = 100;
    mutate_draw_cycle(&mut fixture.svm, 1, 0, |dc| {
        dc.vrf_seed_slot = initial_vrf_seed_slot;
    });
    inject_randomness_account_data(
        &mut fixture.svm,
        fixture.randomness_account,
        initial_vrf_seed_slot,
        0,
        [0u8; 32],
    );

    // 1. Warp to expired slot (> 1000 slots after harvest)
    let rebind_slot = initial_vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1; // 1101
    fixture.svm.warp_to_slot(rebind_slot);
    fixture.svm.expire_blockhash();

    // 2. Prepare new randomness account
    let new_randomness = Keypair::new().pubkey();
    let new_seed_slot = rebind_slot.saturating_sub(1);
    inject_randomness_account_data(
        &mut fixture.svm,
        new_randomness,
        new_seed_slot,
        0,
        [0u8; 32],
    );

    let (pool_pda, _) = pool_pda(1);
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let crank = clone_keypair(&fixture.crank);

    // 3. Execute crank_rebind_expired_randomness
    let meta = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        1,
        0,
        fixture.randomness_account,
        new_randomness,
    )
    .with_pool(pool_pda)
    .with_current_draw_cycle(dc_pda)
    .send(&mut fixture.svm, &crank)
    .expect("Crank rebind should succeed");

    let event = assert_cpi_event::<anchor::events::RandomnessRebound>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.old_randomness_account, fixture.randomness_account);
    assert_eq!(event.new_randomness_account, new_randomness);
    assert_eq!(event.vrf_seed_slot, new_seed_slot);
    assert_eq!(event.rebind_count, 1);

    // Assert DrawCycle state updated
    let dc_acct = fixture.svm.get_account(&dc_pda).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.randomness_account, new_randomness);
    assert_eq!(dc.vrf_seed_slot, new_seed_slot);
    assert_eq!(dc.rebind_count, 1);
    assert_eq!(dc.prize_pot, 1_000_000);
    assert_eq!(dc.locked_ticket_count, 5);

    // Assert Pool state is still frozen
    let pool_acct = fixture.svm.get_account(&pool_pda).unwrap();
    let pool = anchor::PrizePool::try_deserialize(&mut pool_acct.data.as_slice()).unwrap();
    assert_eq!(pool.is_frozen_for_draw, 1);

    // 4. Immediate rebind attempt at slot + 1 (1102) fails with RandomnessNotExpired
    fixture.svm.warp_to_slot(rebind_slot + 1);
    fixture.svm.expire_blockhash();
    let another_randomness = Keypair::new().pubkey();
    let another_seed_slot = (rebind_slot + 1).saturating_sub(1);
    inject_randomness_account_data(
        &mut fixture.svm,
        another_randomness,
        another_seed_slot,
        0,
        [0u8; 32],
    );

    let rebind_fail_res = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        1,
        0,
        new_randomness,
        another_randomness,
    )
    .with_pool(pool_pda)
    .with_current_draw_cycle(dc_pda)
    .send(&mut fixture.svm, &crank);

    assert_custom_error(rebind_fail_res, anchor::error::PremiumBondsError::RandomnessNotExpired);

    // 5. Advance clock 10 slots (1111)
    let reveal_slot = rebind_slot + 10;
    fixture.svm.warp_to_slot(reveal_slot);
    fixture.svm.expire_blockhash();

    // 6. Inject mock randomness for the new randomness account (seed_slot = new_seed_slot, reveal_slot = 1111)
    inject_randomness_account_data(
        &mut fixture.svm,
        new_randomness,
        new_seed_slot,
        reveal_slot,
        deterministic_seed_for_index(0),
    );

    let reveal_res = RevealAndPickWinnersBuilder::for_pool(1, 0, crank.pubkey())
        .with_ticket_registry(fixture.ticket_registry)
        .with_randomness_account(new_randomness)
        .send(&mut fixture.svm, &crank);

    assert!(reveal_res.is_ok(), "Reveal after rebind must succeed: {:?}", reveal_res.err());


    // Verify draw complete, pool unfrozen, and PayoutRegistry created
    let pool_acct_after = fixture.svm.get_account(&pool_pda).unwrap();
    let pool_after = anchor::PrizePool::try_deserialize(&mut pool_acct_after.data.as_slice()).unwrap();
    assert_eq!(pool_after.is_frozen_for_draw, 0, "Pool must be unfrozen after reveal");

    let (payout_reg_pda, _) = payout_pda(1, 0);
    let payout_acct = fixture.svm.get_account(&payout_reg_pda);
    assert!(payout_acct.is_some(), "PayoutRegistry account must be created");
}

#[test]
fn test_crank_rebind_fails_when_max_rebind_limit_reached() {
    let vrf_seed_slot = 100;
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, vrf_seed_slot);
    let crank = clone_keypair(&ctx.crank);

    // --- Rebind 1 ---
    let expired_slot_1 = vrf_seed_slot + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1; // 1101
    ctx.svm.warp_to_slot(expired_slot_1);
    ctx.svm.expire_blockhash();

    let rand1 = Keypair::new().pubkey();
    let seed_slot_1 = expired_slot_1.saturating_sub(1); // 1100
    inject_randomness_account_data(&mut ctx.svm, rand1, seed_slot_1, 0, [0u8; 32]);

    let res1 = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        1,
        0,
        ctx.current_randomness_account,
        rand1,
    )
    .with_pool(ctx.pool_key)
    .with_current_draw_cycle(ctx.current_draw_cycle)
    .send(&mut ctx.svm, &crank);
    assert!(res1.is_ok(), "1st rebind should succeed: {:?}", res1.err());

    // Verify rebind_count = 1
    let dc_acct_1 = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc_1 = anchor::DrawCycle::try_deserialize(&mut dc_acct_1.data.as_slice()).unwrap();
    assert_eq!(dc_1.rebind_count, 1);

    // --- Rebind 2 ---
    let expired_slot_2 = seed_slot_1 + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1; // 2101
    ctx.svm.warp_to_slot(expired_slot_2);
    ctx.svm.expire_blockhash();

    let rand2 = Keypair::new().pubkey();
    let seed_slot_2 = expired_slot_2.saturating_sub(1); // 2100
    inject_randomness_account_data(&mut ctx.svm, rand2, seed_slot_2, 0, [0u8; 32]);

    let res2 = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        1,
        0,
        rand1,
        rand2,
    )
    .with_pool(ctx.pool_key)
    .with_current_draw_cycle(ctx.current_draw_cycle)
    .send(&mut ctx.svm, &crank);
    assert!(res2.is_ok(), "2nd rebind should succeed: {:?}", res2.err());

    // Verify rebind_count = 2
    let dc_acct_2 = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc_2 = anchor::DrawCycle::try_deserialize(&mut dc_acct_2.data.as_slice()).unwrap();
    assert_eq!(dc_2.rebind_count, 2);

    // --- Rebind 3 (Attempt: should fail with RebindLimitReached) ---
    let expired_slot_3 = seed_slot_2 + anchor::constants::VRF_FRESHNESS_WINDOW_SLOTS + 1; // 3101
    ctx.svm.warp_to_slot(expired_slot_3);
    ctx.svm.expire_blockhash();

    let rand3 = Keypair::new().pubkey();
    let seed_slot_3 = expired_slot_3.saturating_sub(1); // 3100
    inject_randomness_account_data(&mut ctx.svm, rand3, seed_slot_3, 0, [0u8; 32]);

    let res3 = CrankRebindExpiredRandomnessBuilder::new(
        crank.pubkey(),
        1,
        0,
        rand2,
        rand3,
    )
    .with_pool(ctx.pool_key)
    .with_current_draw_cycle(ctx.current_draw_cycle)
    .send(&mut ctx.svm, &crank);

    assert_custom_error(res3, anchor::error::PremiumBondsError::RebindLimitReached);
}



