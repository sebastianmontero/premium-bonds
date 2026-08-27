use anchor_lang::{AccountDeserialize, AccountSerialize, InstructionData, Space, ToAccountMetas};
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

fn draw_cycle_pda(pool_id: u32, cycle_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            b"draw_cycle",
            pool_id.to_le_bytes().as_ref(),
            cycle_id.to_le_bytes().as_ref(),
        ],
        &anchor::id(),
    )
}

struct Ctx {
    svm: LiteSVM,
    admin: Keypair,
    pool_key: Pubkey,
    current_draw_cycle: Pubkey,
}

fn setup(admin: &Keypair, draw_status: anchor::DrawStatus) -> Ctx {
    setup_with_amounts(admin, draw_status, 1_000_000, 100_000, 1_000_000, 100_000)
}

fn setup_with_amounts(
    admin: &Keypair,
    draw_status: anchor::DrawStatus,
    prize_pot: u64,
    cycle_fee_collected: u64,
    total_prizes_allocated: u64,
    total_fees_accrued: u64,
) -> Ctx {
    let mut svm = setup_global_config_with_admin(admin, &admin.pubkey(), None);


    // Inject pool
    let (pool_key, bump) = pool_pda(1);
    let ticket_registry = Keypair::new().pubkey();
    use anchor_lang::Discriminator;
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id: 1,
        token_mint: Keypair::new().pubkey(),
        ticket_registry,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: anchor::PoolStatus::Active as u8,
        total_deposited_principal: 0,
        total_fees_accrued,
        total_fees_withdrawn: 0,
        total_prizes_allocated,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        total_prizes_distributed: 0,
        current_cycle_end_at: i64::MAX,
        is_frozen_for_draw: 1,
        current_draw_cycle_id: 0,
        prize_tiers: [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10],
        prize_tiers_count: 0,
        _padding: [0; 3],
        version: 1,
        _reserved: [0; 128],
    };

    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_key,
        Account {
            lamports: 1_000_000_000,
            data: pool_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Inject draw cycle
    let (current_draw_cycle, _) = draw_cycle_pda(1, 0);
    let dc = anchor::DrawCycle {
        pool_id: 1,
        cycle_id: 0,
        status: draw_status,
        locked_ticket_count: 10,
        randomness_seed: [0u8; 32],
        prize_pot,
        cycle_fee_collected,
        randomness_account: Pubkey::default(),
        harvest_slot: 0,
        initiated_at: 1_700_000_000,
        completed_at: 0,
        version: 1,
        _reserved: [0; 64],
    };
    let mut data = vec![];
    data.extend_from_slice(&anchor::DrawCycle::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    dc.serialize(&mut data).unwrap();
    data.resize(8 + anchor::DrawCycle::INIT_SPACE, 0);
    svm.set_account(
        current_draw_cycle,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    Ctx {
        svm,
        admin: clone_keypair(admin),
        pool_key,
        current_draw_cycle,
    }
}

fn send_force_unlock(ctx: &mut Ctx, signer: &Keypair) -> Result<litesvm::types::TransactionMetadata, String> {
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
    ctx.svm
        .send_transaction(tx)
        .map_err(|e| format!("{e:?}"))
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
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.admin, admin.pubkey());
    assert_eq!(event.prize_pot, 1_000_000);
    assert_eq!(event.cycle_fee_collected, 100_000);

    // Verify status is ForceUnlocked, pool is unfrozen, and non-zero balances are exactly decremented
    let pool_acct = ctx.svm.get_account(&ctx.pool_key).unwrap();
    let pool = *bytemuck::from_bytes::<anchor::PrizePool>(&pool_acct.data[8..8 + std::mem::size_of::<anchor::PrizePool>()]);
    assert_eq!(pool.is_frozen_for_draw, 0);
    assert_eq!(pool.total_prizes_allocated, 1_500_000); // 2_500_000 - 1_000_000
    assert_eq!(pool.total_fees_accrued, 200_000);       // 300_000 - 100_000

    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::ForceUnlocked);
    assert!(dc.completed_at > 0);
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

    let pool_acct = ctx.svm.get_account(&ctx.pool_key).unwrap();
    let pool = *bytemuck::from_bytes::<anchor::PrizePool>(&pool_acct.data[8..8 + std::mem::size_of::<anchor::PrizePool>()]);
    assert_eq!(pool.total_prizes_allocated, 0);
    assert_eq!(pool.total_fees_accrued, 50_000);

    let dc_acct = ctx.svm.get_account(&ctx.current_draw_cycle).unwrap();
    let dc = anchor::DrawCycle::try_deserialize(&mut dc_acct.data.as_slice()).unwrap();
    assert_eq!(dc.status, anchor::DrawStatus::ForceUnlocked);
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

    let err = send_force_unlock(&mut ctx, &admin).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_admin_force_unlock_math_overflow_fees() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        0,
        100_000, // cycle_fee_collected = 100k
        0,
        50_000, // total_fees_accrued = 50k (less than cycle_fee_collected)
    );

    let err = send_force_unlock(&mut ctx, &admin).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_admin_force_unlock_fails_unauthorized_admin() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::AwaitingRandomness);

    let fake_admin = Keypair::new();
    ctx.svm
        .airdrop(&fake_admin.pubkey(), 10_000_000_000)
        .unwrap();

    let err = send_force_unlock(&mut ctx, &fake_admin).unwrap_err();
    assert!(err.contains("UnauthorizedAdmin"), "got: {err}");
}

#[test]
fn test_admin_force_unlock_fails_invalid_draw_status() {
    let admin = Keypair::new();
    let mut ctx = setup(&admin, anchor::DrawStatus::Complete);

    let err = send_force_unlock(&mut ctx, &admin).unwrap_err();
    assert!(err.contains("InvalidDrawStatus"), "got: {err}");
}

#[test]
fn test_admin_force_unlock_preserves_total_prizes_distributed() {
    let admin = Keypair::new();
    let mut ctx = setup_with_amounts(
        &admin,
        anchor::DrawStatus::AwaitingRandomness,
        1_000_000, // prize_pot committed this draw
        100_000,   // cycle_fee_collected
        2_500_000, // total_prizes_allocated
        300_000,   // total_fees_accrued
    );

    // Set existing cumulative prizes distributed from previous completed draws
    {
        let mut acc = ctx.svm.get_account(&ctx.pool_key).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_distributed = 750_000;
        ctx.svm.set_account(ctx.pool_key, acc).unwrap();
    }

    send_force_unlock(&mut ctx, &admin).expect("force unlock should succeed");

    // Pool accounting: total_prizes_allocated decremented by prize_pot (2.5M - 1M = 1.5M),
    // but total_prizes_distributed strictly preserves 750_000!
    let acc = ctx.svm.get_account(&ctx.pool_key).unwrap();
    let pool = bytemuck::from_bytes::<anchor::PrizePool>(&acc.data[8..]);
    assert_eq!(pool.total_prizes_allocated, 1_500_000);
    assert_eq!(pool.total_prizes_distributed, 750_000);
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
    let err = ctx.svm.send_transaction(tx).unwrap_err();
    let err_str = format!("{err:?}");
    assert!(
        err_str.contains("ConstraintSeeds") || err_str.contains("Custom(2006)"),
        "expected ConstraintSeeds error on invalid event authority, got: {err_str}"
    );
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
        let err = send_force_unlock(&mut ctx, &admin).unwrap_err();
        assert!(
            err.contains("InvalidDrawStatus") || err.contains("6019"),
            "Status {status:?} expected InvalidDrawStatus, got: {err}"
        );
    }
}


