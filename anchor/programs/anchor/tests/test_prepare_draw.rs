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
        version: anchor::DrawCycle::CURRENT_VERSION,
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
    let mut fixed_tiers = [anchor::PrizeTier {
        num_winners: 0,
        basis_points: 0,
        _padding: [0, 0],
    }; 10];
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

fn send_prepare(
    ctx: &mut Ctx,
    batch_size: u32,
) -> Result<litesvm::types::TransactionMetadata, String> {
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
    ctx.svm.send_transaction(tx).map_err(|e| format!("{e:?}"))
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
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: user_b,
            active: 3,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
    ];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    let meta = send_prepare(&mut ctx, 2).unwrap();
    let event = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta);
    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.batch_start, 0);
    assert_eq!(event.batch_end, 2);
    assert_eq!(event.user_count, 2);
    assert_eq!(event.is_complete, true);

    let reg_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let draw_prepared_up_to = u32::from_le_bytes(reg_acct.data[32..36].try_into().unwrap());
    assert_eq!(draw_prepared_up_to, 2);

    let entry_a = anchor::utils::registry_get_entry(&reg_acct.data, 0).unwrap();
    assert_eq!(entry_a.cumulative_active, 5);

    let entry_b = anchor::utils::registry_get_entry(&reg_acct.data, 1).unwrap();
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
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        },
        anchor::state::UserEntry {
            owner: Keypair::new().pubkey(),
            active: 1,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
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
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
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

    let entry_after = anchor::utils::registry_get_entry(&reg_acct_after.data, 0).unwrap();

    assert_eq!(entry_after.active, 10);
    assert_eq!(entry_after.pending, 5);
    assert_eq!(entry_after.cumulative_active, 10);
    assert_eq!(entry_after.merged_through_cycle, 0);
}

#[test]
fn test_prepare_draw_already_complete_rejected() {
    let user_a = Keypair::new().pubkey();
    let entries = vec![anchor::state::UserEntry {
        owner: user_a,
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // First prepare_draw call: prepares user 0 up to 1
    let res1 = send_prepare(&mut ctx, 1);
    assert!(res1.is_ok(), "first prepare should succeed: {:?}", res1);

    let reg_acct1 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let draw_prepared_up_to1 = u32::from_le_bytes(reg_acct1.data[32..36].try_into().unwrap());
    assert_eq!(draw_prepared_up_to1, 1);

    // Second prepare_draw call when draw_prepared_up_to == user_count (1 == 1) fails fast with InvalidDrawState
    ctx.svm.expire_blockhash();
    let err = send_prepare(&mut ctx, 1).unwrap_err();
    assert!(
        err.contains("InvalidDrawState"),
        "expected InvalidDrawState when already complete, got: {err}"
    );
}

#[test]
fn test_prepare_draw_multi_batch_events() {
    let entries = (0..4)
        .map(|_| anchor::state::UserEntry {
            owner: Keypair::new().pubkey(),
            active: 10,
            pending: 0,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        })
        .collect::<Vec<_>>();

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // Batch 1: Process 2 of 4 entries (partial)
    let meta1 = send_prepare(&mut ctx, 2).expect("Batch 1 should succeed");
    let event1 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta1);
    assert_eq!(event1.pool_id, 1);
    assert_eq!(event1.cycle_id, 0);
    assert_eq!(event1.batch_start, 0);
    assert_eq!(event1.batch_end, 2);
    assert_eq!(event1.user_count, 4);
    assert_eq!(event1.is_complete, false);

    // Batch 2: Process remaining 2 entries (complete)
    ctx.svm.expire_blockhash();
    let meta2 = send_prepare(&mut ctx, 2).expect("Batch 2 should succeed");
    let event2 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta2);
    assert_eq!(event2.pool_id, 1);
    assert_eq!(event2.cycle_id, 0);
    assert_eq!(event2.batch_start, 2);
    assert_eq!(event2.batch_end, 4);
    assert_eq!(event2.user_count, 4);
    assert_eq!(event2.is_complete, true);
}

#[test]
fn test_prepare_draw_batch_size_zero_rejected() {
    let user_a = Keypair::new().pubkey();
    let entries = vec![anchor::state::UserEntry {
        owner: user_a,
        active: 10,
        pending: 0,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // Call prepare_draw with batch_size = 0 should fail fast with InvalidBondQuantity
    let err = send_prepare(&mut ctx, 0).unwrap_err();
    assert!(
        err.contains("InvalidBondQuantity"),
        "expected InvalidBondQuantity when batch_size is 0, got: {err}"
    );
}

#[test]
fn test_prepare_draw_first_cycle_genesis() {
    let user_a = Keypair::new().pubkey();
    // User deposited in cycle 0: merged_through_cycle = 0, active = 0, pending = 10
    let entries = vec![anchor::state::UserEntry {
        owner: user_a,
        active: 0,
        pending: 10,
        merged_through_cycle: 0,
        cumulative_active: 0,
        version: anchor::state::UserEntry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 12],
    }];

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // Genesis harvest: draw_cycle_id = 1, merge_cycle_id = 1.saturating_sub(1) = 0
    let mut reg_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    reg_acct.data[28..32].copy_from_slice(&1u32.to_le_bytes()); // draw_cycle_id = 1
    anchor::utils::registry_set_entry(&mut reg_acct.data, 0, &entries[0]);
    ctx.svm.set_account(ctx.ticket_registry, reg_acct).unwrap();

    // Prepare draw for cycle 1: 0 < 0 is false, so pending tickets do NOT merge (maturation delay)
    let res = send_prepare(&mut ctx, 1);
    assert!(
        res.is_ok(),
        "prepare genesis cycle should succeed: {:?}",
        res
    );

    let reg_acct1 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry1 = anchor::utils::registry_get_entry(&reg_acct1.data, 0).unwrap();
    assert_eq!(entry1.active, 0);
    assert_eq!(entry1.pending, 10);
    assert_eq!(entry1.cumulative_active, 0);
    assert_eq!(entry1.merged_through_cycle, 0);

    // Now advance to cycle 2: draw_cycle_id = 2, merge_cycle_id = 2 - 1 = 1
    let mut reg_acct2 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    reg_acct2.data[28..32].copy_from_slice(&2u32.to_le_bytes()); // draw_cycle_id = 2
    reg_acct2.data[32..36].copy_from_slice(&0u32.to_le_bytes()); // reset draw_prepared_up_to = 0
    ctx.svm.set_account(ctx.ticket_registry, reg_acct2).unwrap();
    ctx.svm.expire_blockhash();

    // Prepare draw for cycle 2: 0 < 1 is true, so pending tickets mature into active
    let res2 = send_prepare(&mut ctx, 1);
    assert!(res2.is_ok(), "prepare cycle 2 should succeed: {:?}", res2);

    let reg_acct3 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry2 = anchor::utils::registry_get_entry(&reg_acct3.data, 0).unwrap();
    assert_eq!(entry2.active, 10);
    assert_eq!(entry2.pending, 0);
    assert_eq!(entry2.cumulative_active, 10);
    assert_eq!(entry2.merged_through_cycle, 1);
}

#[test]
fn test_prepare_draw_non_aligned_batches() {
    // 25 users with various active & pending balances
    let entries = (0..25)
        .map(|i| anchor::state::UserEntry {
            owner: Keypair::new().pubkey(),
            active: (i % 5 + 1) * 2, // 2, 4, 6, 8, 10...
            pending: 1,              // pending will mature
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        })
        .collect::<Vec<_>>();

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // Set draw_cycle_id = 2 so that merge_cycle_id = 1 (matures pending from 0)
    let mut reg_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    reg_acct.data[28..32].copy_from_slice(&2u32.to_le_bytes());
    ctx.svm.set_account(ctx.ticket_registry, reg_acct).unwrap();

    // Batch 1: 0..7
    let meta1 = send_prepare(&mut ctx, 7).expect("Batch 1 should succeed");
    let event1 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta1);
    assert_eq!(event1.batch_start, 0);
    assert_eq!(event1.batch_end, 7);
    assert_eq!(event1.is_complete, false);

    // Batch 2: 7..14
    ctx.svm.expire_blockhash();
    let meta2 = send_prepare(&mut ctx, 7).expect("Batch 2 should succeed");
    let event2 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta2);
    assert_eq!(event2.batch_start, 7);
    assert_eq!(event2.batch_end, 14);
    assert_eq!(event2.is_complete, false);

    // Batch 3: 14..21
    ctx.svm.expire_blockhash();
    let meta3 = send_prepare(&mut ctx, 7).expect("Batch 3 should succeed");
    let event3 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta3);
    assert_eq!(event3.batch_start, 14);
    assert_eq!(event3.batch_end, 21);
    assert_eq!(event3.is_complete, false);

    // Batch 4: 21..25 (clamped from 21 + 7 = 28 to 25)
    ctx.svm.expire_blockhash();
    let meta4 = send_prepare(&mut ctx, 7).expect("Batch 4 should succeed");
    let event4 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta4);
    assert_eq!(event4.batch_start, 21);
    assert_eq!(event4.batch_end, 25);
    assert_eq!(event4.is_complete, true);

    // Batch 5: Already complete -> must fail fast with InvalidDrawState
    ctx.svm.expire_blockhash();
    let err = send_prepare(&mut ctx, 7).unwrap_err();
    assert!(err.contains("InvalidDrawState"), "got: {err}");

    // Verify all cumulative active prefix sums on disk
    let reg_final = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let mut expected_cumulative = 0u32;
    for i in 0..25 {
        let entry = anchor::utils::registry_get_entry(&reg_final.data, i).unwrap();
        let expected_active = (i as u32 % 5 + 1) * 2 + 1; // initial active + merged pending
        assert_eq!(entry.active, expected_active, "entry {i} active mismatch");
        assert_eq!(entry.pending, 0, "entry {i} pending mismatch");
        expected_cumulative += expected_active;
        assert_eq!(
            entry.cumulative_active, expected_cumulative,
            "entry {i} cumulative mismatch"
        );
    }
}

#[test]
fn test_prepare_draw_zero_ticket_entries_at_boundary() {
    let mut entries = Vec::new();
    for i in 0..10 {
        let is_zero = i == 6 || i == 7 || i == 8;
        entries.push(anchor::state::UserEntry {
            owner: Keypair::new().pubkey(),
            active: if is_zero { 0 } else { 10 },
            pending: 0,
            merged_through_cycle: 1,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        });
    }

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    // Batch 1: 0..7 (ends on user 6, who has 0 active tickets)
    send_prepare(&mut ctx, 7).unwrap();

    let reg_acct1 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry5 = anchor::utils::registry_get_entry(&reg_acct1.data, 5).unwrap();
    let entry6 = anchor::utils::registry_get_entry(&reg_acct1.data, 6).unwrap();
    assert_eq!(entry5.cumulative_active, 60);
    assert_eq!(entry6.cumulative_active, 60); // 0 active tickets added

    // Batch 2: 7..10 (starts on user 7, who has 0 active tickets)
    ctx.svm.expire_blockhash();
    send_prepare(&mut ctx, 7).unwrap();

    let reg_acct2 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry7 = anchor::utils::registry_get_entry(&reg_acct2.data, 7).unwrap();
    let entry8 = anchor::utils::registry_get_entry(&reg_acct2.data, 8).unwrap();
    let entry9 = anchor::utils::registry_get_entry(&reg_acct2.data, 9).unwrap();
    assert_eq!(entry7.cumulative_active, 60); // 0 active tickets added
    assert_eq!(entry8.cumulative_active, 60); // 0 active tickets added
    assert_eq!(entry9.cumulative_active, 70); // 10 active tickets added
}
