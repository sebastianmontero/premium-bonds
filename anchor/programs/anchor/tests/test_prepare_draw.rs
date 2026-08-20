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
    crank: Keypair,
    pool_key: Pubkey,
    ticket_registry: Pubkey,
    draw_cycle: Pubkey,
}

fn setup(
    is_pool_frozen: bool,
    dc_status: anchor::DrawStatus,
    entries: &[anchor::state::UserEntry],
) -> Ctx {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    let crank = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    let ticket_registry = Keypair::new().pubkey();
    inject_registry_with_entries(&mut svm, ticket_registry, 1, 1000, entries);

    // Inject pool
    let pool_key = pool_pda(1).0;
    inject_pool_custom(
        &mut svm,
        1,
        ticket_registry,
        anchor::PoolStatus::Active,
        is_pool_frozen,
        vec![],
        0,
    );

    // Inject draw cycle
    let (draw_cycle, _) = draw_cycle_pda(1, 0);
    let dc = anchor::DrawCycle {
        pool_id: 1,
        cycle_id: 0,
        status: dc_status,
        locked_ticket_count: 10,
        randomness_seed: [0u8; 32],
        prize_pot: 1_000_000,
        cycle_fee_collected: 0,
        randomness_account: Pubkey::default(),
        harvest_slot: 0,
        initiated_at: 1_700_000_000,
        completed_at: 0,
        version: 1,
        _reserved: [0; 64],
    };
    let mut data = vec![];
    use anchor_lang::Discriminator;
    data.extend_from_slice(&anchor::DrawCycle::DISCRIMINATOR);
    use anchor_lang::AnchorSerialize;
    dc.serialize(&mut data).unwrap();
    data.resize(8 + anchor::DrawCycle::INIT_SPACE, 0);
    svm.set_account(
        draw_cycle,
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
        crank,
        pool_key,
        ticket_registry,
        draw_cycle,
    }
}

fn inject_pool_custom(
    svm: &mut LiteSVM,
    pool_id: u32,
    ticket_registry: Pubkey,
    status: anchor::PoolStatus,
    is_frozen: bool,
    prize_tiers: Vec<anchor::PrizeTier>,
    total_deposited_principal: u64,
) {
    use anchor_lang::Discriminator;
    let (pda, bump) = pool_pda(pool_id);
    let mut fixed_tiers = [anchor::PrizeTier { num_winners: 0, basis_points: 0, _padding: [0, 0] }; 10];
    let count = prize_tiers.len().min(10);
    fixed_tiers[..count].copy_from_slice(&prize_tiers[..count]);
    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint: Pubkey::default(),
        ticket_registry,
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 100,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 300,
        status: status as u8,
        total_deposited_principal,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 0,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        total_prizes_distributed: 0,
        current_cycle_end_at: i64::MAX,
        is_frozen_for_draw: if is_frozen { 1 } else { 0 },
        current_draw_cycle_id: 0,
        prize_tiers: fixed_tiers,
        prize_tiers_count: count as u8,
        _padding: [0; 3],
        version: 1,
        _reserved: [0; 128],
    };

    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn send_prepare(ctx: &mut Ctx, batch_size: u32) -> Result<(), String> {
    let accounts = anchor::accounts::PrepareDraw {
        crank: ctx.crank.pubkey(),
        pool: ctx.pool_key,
        draw_cycle: ctx.draw_cycle,
        ticket_registry: ctx.ticket_registry,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::PrepareDraw { batch_size }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

#[test]
fn test_prepare_draw_happy_path() {
    let user_a = Keypair::new().pubkey();
    let user_b = Keypair::new().pubkey();
    let entries = vec![
        anchor::state::UserEntry {
            owner: user_a,
            active: 5,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        },
        anchor::state::UserEntry {
            owner: user_b,
            active: 3,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        },
    ];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    send_prepare(&mut ctx, 2).unwrap();

    let reg_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let draw_prepared_up_to = u32::from_le_bytes(reg_acct.data[32..36].try_into().unwrap());
    assert_eq!(draw_prepared_up_to, 2);

    let entry_a = anchor::utils::registry_get_entry(&reg_acct.data, 0);
    assert_eq!(entry_a.cumulative_active, 5);

    let entry_b = anchor::utils::registry_get_entry(&reg_acct.data, 1);
    assert_eq!(entry_b.cumulative_active, 8);
}

#[test]
fn test_prepare_draw_fails_pool_not_frozen() {
    let mut ctx = setup(false, anchor::DrawStatus::AwaitingRandomness, &[]);

    let err = send_prepare(&mut ctx, 1).unwrap_err();
    assert!(err.contains("PoolNotFrozen"), "got: {err}");
}

#[test]
fn test_prepare_draw_fails_invalid_draw_status() {
    let mut ctx = setup(true, anchor::DrawStatus::Complete, &[]);

    let err = send_prepare(&mut ctx, 1).unwrap_err();
    assert!(err.contains("InvalidDrawStatus"), "got: {err}");
}

#[test]
fn test_prepare_draw_fails_math_overflow() {
    let user_a = Keypair::new().pubkey();
    let entries = vec![
        anchor::state::UserEntry {
            owner: user_a,
            active: u32::MAX,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        },
        anchor::state::UserEntry {
            owner: Keypair::new().pubkey(),
            active: 1,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: 1,
            _reserved: [0; 15],
        },
    ];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    let err = send_prepare(&mut ctx, 2).unwrap_err();
    assert!(err.contains("MathOverflow"), "got: {err}");
}

#[test]
fn test_prepare_draw_excludes_pending_tickets() {
    let user_a = Keypair::new().pubkey();
    let entries = vec![anchor::state::UserEntry {
        owner: user_a,
        active: 10,
        pending: 5,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: 1,
        _reserved: [0; 15],
    }];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // Set registry.draw_cycle_id = 1 (incremented during harvest)
    let mut reg_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    reg_acct.data[28..32].copy_from_slice(&1u32.to_le_bytes()); // draw_cycle_id = 1

    // Write entries[0] to index 0 using the utility function
    anchor::utils::registry_set_entry(&mut reg_acct.data, 0, &entries[0]);

    ctx.svm.set_account(ctx.ticket_registry, reg_acct).unwrap();

    let res = send_prepare(&mut ctx, 1);
    assert!(res.is_ok(), "prepare should succeed: {:?}", res);

    let reg_acct_after = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let draw_prepared_up_to = u32::from_le_bytes(reg_acct_after.data[32..36].try_into().unwrap());
    assert_eq!(draw_prepared_up_to, 1);

    let entry_after = anchor::utils::registry_get_entry(&reg_acct_after.data, 0);

    assert_eq!(entry_after.active, 10);
    assert_eq!(entry_after.pending, 5);
    assert_eq!(entry_after.cumulative_active, 10);
    assert_eq!(entry_after.merged_through_cycle, 0);
}

#[test]
fn test_prepare_draw_idempotent_when_fully_prepared() {
    let user_a = Keypair::new().pubkey();
    let entries = vec![anchor::state::UserEntry {
        owner: user_a,
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: 1,
        _reserved: [0; 15],
    }];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // First prepare_draw call: prepares user 0 up to 1
    let res1 = send_prepare(&mut ctx, 1);
    assert!(res1.is_ok(), "first prepare should succeed: {:?}", res1);

    let reg_acct1 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let draw_prepared_up_to1 = u32::from_le_bytes(reg_acct1.data[32..36].try_into().unwrap());
    assert_eq!(draw_prepared_up_to1, 1);

    // Second prepare_draw call when draw_prepared_up_to == user_count (1 == 1)
    ctx.svm.expire_blockhash();
    let res2 = send_prepare(&mut ctx, 1);
    assert!(res2.is_ok(), "second prepare should be idempotent: {:?}", res2);

    let reg_acct2 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let draw_prepared_up_to2 = u32::from_le_bytes(reg_acct2.data[32..36].try_into().unwrap());
    assert_eq!(draw_prepared_up_to2, 1);
}
