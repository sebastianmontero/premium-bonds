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

struct RebindCtx {
    svm: LiteSVM,
    crank: Keypair,
    pool_key: Pubkey,
    current_draw_cycle: Pubkey,
    new_randomness_account: Pubkey,
}

fn setup(draw_status: anchor::DrawStatus, harvest_slot: u64) -> RebindCtx {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let ticket_registry = Keypair::new().pubkey();
    let (pool_key, _) = PrizePoolTestBuilder::new(1)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_current_draw_cycle_id(0)
        .inject(&mut svm);

    let (current_draw_cycle, _) = DrawCycleTestBuilder::new(1, 0)
        .with_status(draw_status)
        .with_locked_tickets(10)
        .with_prize_pot(1_000_000)
        .with_harvest_slot(harvest_slot)
        .inject(&mut svm);

    // Create a new randomness account owned by Switchboard On-Demand
    let new_randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, new_randomness_account);

    RebindCtx {
        svm,
        crank,
        pool_key,
        current_draw_cycle,
        new_randomness_account,
    }
}

fn send_rebind(ctx: &mut RebindCtx, signer: &Keypair) -> TxResult {
    let (global_config, _) = global_config_pda();
    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();

    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        global_config,
        crank: signer.pubkey(),
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
        current_randomness_account: dc.randomness_account,
        new_randomness_account: ctx.new_randomness_account,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    ctx.svm.send_transaction(tx)
}

#[test]
fn test_rebind_fails_mismatched_current_randomness_account() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    ctx.svm.warp_to_slot(1001);

    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::CrankRebindExpiredRandomness {
        global_config,
        crank: ctx.crank.pubkey(),
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
        current_randomness_account: Keypair::new().pubkey(), // Mismatched!
        new_randomness_account: ctx.new_randomness_account,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankRebindExpiredRandomness {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_rebind_happy_path() {
    // 1001 slots passed since harvest (slot 0 -> 1001)
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    ctx.svm.warp_to_slot(1001);

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
        event.old_randomness_account,
        Pubkey::default(),
        "RandomnessRebound old_randomness_account mismatch"
    );
    assert_eq!(
        event.new_randomness_account, ctx.new_randomness_account,
        "RandomnessRebound new_randomness_account mismatch"
    );
    assert_eq!(
        event.harvest_slot, 1001,
        "RandomnessRebound harvest_slot mismatch"
    );

    // Verify draw cycle randomness account is updated and harvest slot reset
    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(
        dc.randomness_account, ctx.new_randomness_account,
        "DrawCycle randomness_account must match new randomness account"
    );
    assert_eq!(
        dc.harvest_slot, 1001,
        "DrawCycle harvest_slot must be updated to current slot 1001"
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
    let mut ctx = setup(anchor::DrawStatus::Complete, 0);
    ctx.svm.warp_to_slot(1001);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
}

#[test]
fn test_rebind_fails_randomness_not_expired() {
    // Only 1000 slots passed (0 -> 1000)
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    ctx.svm.warp_to_slot(1000);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotExpired);
}

#[test]
fn test_rebind_fails_invalid_randomness_account() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    ctx.svm.warp_to_slot(1001);

    // Set new_randomness_account owner to system program
    ctx.svm
        .set_account(
            ctx.new_randomness_account,
            Account {
                lamports: 1_000_000_000,
                data: vec![],
                owner: Pubkey::default(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(
        res,
        anchor::error::PremiumBondsError::InvalidRandomnessAccount,
    );
}

#[test]
fn test_crank_rebind_exact_slot_boundary() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 100);

    // Boundary 1: Exactly 1000 slots passed (100 -> 1100). 1100 - 100 = 1000 (not > 1000).
    ctx.svm.warp_to_slot(1100);

    let crank = clone_keypair(&ctx.crank);
    let res = send_rebind(&mut ctx, &crank);
    assert_custom_error(res, anchor::error::PremiumBondsError::RandomnessNotExpired);

    // Boundary 2: 1001 slots passed (100 -> 1101). 1101 - 100 = 1001 (> 1000). Should succeed!
    ctx.svm.warp_to_slot(1101);
    ctx.svm.expire_blockhash();

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
        event.old_randomness_account,
        Pubkey::default(),
        "RandomnessRebound old_randomness_account mismatch"
    );
    assert_eq!(
        event.new_randomness_account, ctx.new_randomness_account,
        "RandomnessRebound new_randomness_account mismatch"
    );
    assert_eq!(
        event.harvest_slot, 1101,
        "RandomnessRebound harvest_slot mismatch"
    );
}

#[test]
fn test_rebind_fails_same_randomness_account() {
    let mut ctx = setup(anchor::DrawStatus::AwaitingRandomness, 0);

    // Set existing draw cycle randomness account to match ctx.new_randomness_account
    mutate_draw_cycle(&mut ctx.svm, 1, 0, |dc| {
        dc.randomness_account = ctx.new_randomness_account;
    });

    ctx.svm.warp_to_slot(1001);

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
        let mut ctx = setup(status, 0);
        ctx.svm.warp_to_slot(1001);

        let crank = clone_keypair(&ctx.crank);
        let res = send_rebind(&mut ctx, &crank);
        assert_custom_error_msg(
            res,
            anchor::error::PremiumBondsError::InvalidDrawStatus,
            &format!("Failed for draw status {status:?}"),
        );
    }
}
