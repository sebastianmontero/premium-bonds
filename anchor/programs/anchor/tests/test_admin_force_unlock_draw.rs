use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use litesvm::LiteSVM;
use solana_program::{instruction::Instruction, pubkey::Pubkey};
use solana_sdk::{
    message::{Message, VersionedMessage},
    signature::Keypair,
    signer::Signer,
};
use solana_transaction::versioned::VersionedTransaction;

mod common;
use common::*;

struct ForceUnlockCtx {
    svm: LiteSVM,
    admin: Keypair,
    pool_key: Pubkey,
    current_draw_cycle: Pubkey,
}

fn setup(admin: &Keypair, draw_status: anchor::DrawStatus) -> ForceUnlockCtx {
    setup_with_amounts(admin, draw_status, 1_000_000, 100_000, 1_000_000, 100_000)
}

fn setup_with_amounts(
    admin: &Keypair,
    draw_status: anchor::DrawStatus,
    prize_pot: u64,
    cycle_fee_collected: u64,
    total_prizes_allocated: u64,
    total_fees_accrued: u64,
) -> ForceUnlockCtx {
    let mut svm = setup_global_config_with_admin(admin, &admin.pubkey(), None);

    let ticket_registry = Keypair::new().pubkey();
    let (pool_key, _) = PrizePoolTestBuilder::new(1)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(true)
        .with_solvency_state(0, total_prizes_allocated, total_fees_accrued)
        .with_current_draw_cycle_id(0)
        .with_cycle_end_at(i64::MAX)
        .inject(&mut svm);

    let (current_draw_cycle, _) = DrawCycleTestBuilder::new(1, 0)
        .with_status(draw_status)
        .with_locked_tickets(10)
        .with_prize_pot(prize_pot)
        .with_cycle_fee(cycle_fee_collected)
        .inject(&mut svm);

    ForceUnlockCtx {
        svm,
        admin: clone_keypair(admin),
        pool_key,
        current_draw_cycle,
    }
}

fn send_force_unlock(
    ctx: &mut ForceUnlockCtx,
    signer: &Keypair,
) -> TxResult {
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::AdminForceUnlockDraw {
        global_config,
        admin: signer.pubkey(),
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    ctx.svm.send_transaction(tx)
}

#[test]
fn test_admin_force_unlock_happy_path() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        1_000_000, // prize_pot
        100_000,   // cycle_fee_collected
        2_500_000, // total_prizes_allocated
        300_000,   // total_fees_accrued
    );

    let meta = send_force_unlock(&mut ctx, &admin).unwrap();
    let event = assert_cpi_event::<anchor::events::DrawForceUnlocked>(&meta);
    assert_eq!(event.pool_id, 1, "DrawForceUnlocked pool_id mismatch");
    assert_eq!(event.cycle_id, 0, "DrawForceUnlocked cycle_id mismatch");
    assert_eq!(event.admin, admin.pubkey(), "DrawForceUnlocked admin mismatch");
    assert_eq!(event.prize_pot, 1_000_000, "DrawForceUnlocked prize_pot mismatch");
    assert_eq!(event.cycle_fee_collected, 100_000, "DrawForceUnlocked cycle_fee_collected mismatch");

    // Verify status is ForceUnlocked, pool is unfrozen, and non-zero balances are exactly decremented
    let pool = common::read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.is_frozen_for_draw, 0, "Pool must be unfrozen after force unlock");
    assert_eq!(pool.total_prizes_allocated, 1_500_000, "total_prizes_allocated must decrement by prize_pot (2.5M - 1M)");
    assert_eq!(pool.total_fees_accrued, 200_000, "total_fees_accrued must decrement by cycle fee (300k - 100k)");

    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::ForceUnlocked, "Draw cycle status must be ForceUnlocked");
    assert!(dc.completed_at > 0, "Draw cycle completed_at must be positive");
}

#[test]
fn test_admin_force_unlock_with_zero_fee() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        1_000_000,
        0,         // cycle_fee_collected = 0
        1_000_000, // total_prizes_allocated
        50_000,    // total_fees_accrued from previous cycles
    );

    send_force_unlock(&mut ctx, &admin).unwrap();

    let pool = common::read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_prizes_allocated, 0, "total_prizes_allocated must be 0 after deducting full pot");
    assert_eq!(pool.total_fees_accrued, 50_000, "total_fees_accrued must remain unchanged when cycle fee is 0");

    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::ForceUnlocked, "Draw cycle status must be ForceUnlocked");
}

#[test]
fn test_admin_force_unlock_math_overflow_prizes() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        1_000_000, // prize_pot = 1M
        0,
        500_000, // total_prizes_allocated = 500k (less than prize_pot)
        0,
    );

    let res = send_force_unlock(&mut ctx, &admin);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
}

#[test]
fn test_admin_force_unlock_fees_already_withdrawn() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        0,
        100_000, // cycle_fee_collected = 100k
        0,
        50_000, // total_fees_accrued = 50k (less than cycle_fee_collected)
    );

    let res = send_force_unlock(&mut ctx, &admin);
    assert_custom_error(res, anchor::error::PremiumBondsError::FeesAlreadyWithdrawn);
}

#[test]
fn test_admin_force_unlock_fails_unauthorized_admin() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::AwaitingRandomness);

    let fake_admin = Keypair::new();
    ctx.svm
        .airdrop(&fake_admin.pubkey(), 10_000_000_000)
        .unwrap();

    let res = send_force_unlock(&mut ctx, &fake_admin);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_admin_force_unlock_fails_invalid_draw_status() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::Complete);

    let res = send_force_unlock(&mut ctx, &admin);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
}

#[test]
fn test_admin_force_unlock_preserves_principal_and_unwithdrawn_fees() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        1_000_000, // prize_pot committed this draw
        100_000,   // cycle_fee_collected
        2_500_000, // total_prizes_allocated
        300_000,   // total_fees_accrued
    );

    send_force_unlock(&mut ctx, &admin).expect("force unlock should succeed");

    // Pool accounting: total_prizes_allocated decremented by prize_pot (2.5M - 1M = 1.5M),
    // and total_fees_accrued decremented by cycle_fee_collected (300K - 100K = 200K)
    let pool = common::read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_prizes_allocated, 1_500_000, "total_prizes_allocated must decrement by prize_pot");
    assert_eq!(pool.total_fees_accrued, 200_000, "total_fees_accrued must decrement by cycle_fee_collected");
}

#[test]
fn test_admin_force_unlock_fails_invalid_event_authority() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::AwaitingRandomness);

    let (global_config, _) = global_config_pda();
    let fake_event_authority = Keypair::new().pubkey();

    let accounts = anchor::accounts::AdminForceUnlockDraw {
        global_config,
        admin: admin.pubkey(),
        pool: ctx.pool_key,
        current_draw_cycle: ctx.current_draw_cycle,
        event_authority: fake_event_authority,
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

#[test]
fn test_admin_force_unlock_fails_on_all_invalid_draw_statuses() {
    let invalid_statuses = [
        anchor::DrawStatus::Complete,
        anchor::DrawStatus::ForceUnlocked,
        anchor::DrawStatus::Skipped,
        anchor::DrawStatus::Voided,
        anchor::DrawStatus::HaltedInsolvent,
        anchor::DrawStatus::HaltedYieldSpike,
    ];

    for status in invalid_statuses {
        let admin = Keypair::new();
        let mut ctx = setup(&admin, status);
        let res = send_force_unlock(&mut ctx, &admin);
        assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
    }
}
