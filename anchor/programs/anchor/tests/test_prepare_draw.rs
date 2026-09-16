use anchor_lang::{AccountDeserialize, AnchorDeserialize, InstructionData, ToAccountMetas};
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

struct PrepareDrawCtx {
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
) -> PrepareDrawCtx {
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
    let (pool_key, _) = PrizePoolTestBuilder::new(1)
        .with_ticket_registry(ticket_registry)
        .with_status(anchor::PoolStatus::Active)
        .with_frozen(is_pool_frozen)
        .with_current_draw_cycle_id(0)
        .with_cycle_end_at(i64::MAX)
        .inject(&mut svm);

    // Inject draw cycle
    let (draw_cycle, _) = DrawCycleTestBuilder::new(1, 0)
        .with_status(dc_status)
        .with_locked_tickets(10)
        .with_prize_pot(1_000_000)
        .inject(&mut svm);

    PrepareDrawCtx {
        svm,
        crank,
        pool_key,
        ticket_registry,
        draw_cycle,
    }
}

fn send_prepare(ctx: &mut PrepareDrawCtx, batch_size: u32) -> TxResult {
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
    ctx.svm.send_transaction(tx)
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
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawPreparationProgress crank must match caller"
    );
    assert_eq!(
        event.pool_id, 1,
        "DrawPreparationProgress pool_id must be 1"
    );
    assert_eq!(
        event.cycle_id, 0,
        "DrawPreparationProgress cycle_id must be 0"
    );
    assert_eq!(
        event.batch_start, 0,
        "DrawPreparationProgress batch_start must be 0"
    );
    assert_eq!(
        event.batch_end, 2,
        "DrawPreparationProgress batch_end must be 2"
    );
    assert_eq!(
        event.user_count, 2,
        "DrawPreparationProgress user_count must be 2"
    );
    assert_eq!(
        event.is_complete, true,
        "DrawPreparationProgress is_complete must be true"
    );

    let reg_after = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(
        reg_after.draw_prepared_up_to, 2,
        "Registry draw_prepared_up_to must be 2"
    );

    let reg_acct = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry_a = anchor::utils::registry_get_entry(&reg_acct.data, 0).unwrap();
    assert_eq!(
        entry_a.cumulative_active, 5,
        "Entry A cumulative active must be 5"
    );

    let entry_b = anchor::utils::registry_get_entry(&reg_acct.data, 1).unwrap();
    assert_eq!(
        entry_b.cumulative_active, 8,
        "Entry B cumulative active must be 8 (5 + 3)"
    );
}

#[test]
fn test_prepare_draw_fails_pool_not_frozen() {
    let mut ctx = setup(false, anchor::DrawStatus::AwaitingRandomness, &[]);

    let res = send_prepare(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::PoolNotFrozen);
}

#[test]
fn test_prepare_draw_fails_invalid_draw_status() {
    let mut ctx = setup(true, anchor::DrawStatus::Complete, &[]);

    let res = send_prepare(&mut ctx, 1);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawStatus);
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

    let res = send_prepare(&mut ctx, 2);
    assert_custom_error(res, anchor::error::PremiumBondsError::MathOverflow);
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
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.draw_cycle_id = 1;
    });

    let res = send_prepare(&mut ctx, 1);
    assert!(res.is_ok(), "prepare should succeed: {:?}", res.err());

    let reg_after = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(
        reg_after.draw_prepared_up_to, 1,
        "draw_prepared_up_to must be 1"
    );

    let reg_acct_after = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry_after = anchor::utils::registry_get_entry(&reg_acct_after.data, 0).unwrap();

    assert_eq!(entry_after.active, 10, "Entry active must be 10");
    assert_eq!(entry_after.pending, 5, "Entry pending must be 5");
    assert_eq!(
        entry_after.cumulative_active, 10,
        "Entry cumulative_active must exclude pending (10)"
    );
    assert_eq!(
        entry_after.merged_through_cycle, 0,
        "Entry merged_through_cycle must be 0"
    );
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
    assert!(
        res1.is_ok(),
        "first prepare should succeed: {:?}",
        res1.err()
    );

    let reg_after1 = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(
        reg_after1.draw_prepared_up_to, 1,
        "draw_prepared_up_to must be 1 after first call"
    );

    // Second prepare_draw call when draw_prepared_up_to == user_count (1 == 1) fails fast with InvalidDrawState
    ctx.svm.expire_blockhash();
    let res2 = send_prepare(&mut ctx, 1);
    assert_custom_error(res2, anchor::error::PremiumBondsError::InvalidDrawState);
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
    assert_eq!(
        event1.crank,
        ctx.crank.pubkey(),
        "Batch 1 event crank mismatch"
    );
    assert_eq!(event1.pool_id, 1, "Batch 1 event pool_id mismatch");
    assert_eq!(event1.cycle_id, 0, "Batch 1 event cycle_id mismatch");
    assert_eq!(event1.batch_start, 0, "Batch 1 event batch_start mismatch");
    assert_eq!(event1.batch_end, 2, "Batch 1 event batch_end mismatch");
    assert_eq!(event1.user_count, 4, "Batch 1 event user_count mismatch");
    assert_eq!(
        event1.is_complete, false,
        "Batch 1 event is_complete must be false"
    );

    // Batch 2: Process remaining 2 entries (complete)
    ctx.svm.expire_blockhash();
    let meta2 = send_prepare(&mut ctx, 2).expect("Batch 2 should succeed");
    let event2 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta2);
    assert_eq!(
        event2.crank,
        ctx.crank.pubkey(),
        "Batch 2 event crank mismatch"
    );
    assert_eq!(event2.pool_id, 1, "Batch 2 event pool_id mismatch");
    assert_eq!(event2.cycle_id, 0, "Batch 2 event cycle_id mismatch");
    assert_eq!(event2.batch_start, 2, "Batch 2 event batch_start mismatch");
    assert_eq!(event2.batch_end, 4, "Batch 2 event batch_end mismatch");
    assert_eq!(event2.user_count, 4, "Batch 2 event user_count mismatch");
    assert_eq!(
        event2.is_complete, true,
        "Batch 2 event is_complete must be true"
    );
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

    // Call prepare_draw with batch_size = 0 should fail fast with InvalidBatchSize
    let res = send_prepare(&mut ctx, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidBatchSize);
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
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.draw_cycle_id = 1;
    });

    // Prepare draw for cycle 1: 0 < 0 is false, so pending tickets do NOT merge (maturation delay)
    let res = send_prepare(&mut ctx, 1);
    assert!(
        res.is_ok(),
        "prepare genesis cycle should succeed: {:?}",
        res.err()
    );

    let reg_acct1 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry1 = anchor::utils::registry_get_entry(&reg_acct1.data, 0).unwrap();
    assert_eq!(entry1.active, 0, "Genesis cycle entry active must be 0");
    assert_eq!(entry1.pending, 10, "Genesis cycle entry pending must be 10");
    assert_eq!(
        entry1.cumulative_active, 0,
        "Genesis cycle entry cumulative_active must be 0"
    );
    assert_eq!(
        entry1.merged_through_cycle, 0,
        "Genesis cycle entry merged_through_cycle must be 0"
    );

    // Now advance to cycle 2: draw_cycle_id = 2, merge_cycle_id = 2 - 1 = 1
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.draw_cycle_id = 2;
        hdr.draw_prepared_up_to = 0;
    });
    ctx.svm.expire_blockhash();

    // Prepare draw for cycle 2: 0 < 1 is true, so pending tickets mature into active
    let res2 = send_prepare(&mut ctx, 1);
    assert!(
        res2.is_ok(),
        "prepare cycle 2 should succeed: {:?}",
        res2.err()
    );

    let reg_acct3 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry2 = anchor::utils::registry_get_entry(&reg_acct3.data, 0).unwrap();
    assert_eq!(
        entry2.active, 10,
        "Cycle 2 entry active must be matured to 10"
    );
    assert_eq!(
        entry2.pending, 0,
        "Cycle 2 entry pending must be 0 after maturation"
    );
    assert_eq!(
        entry2.cumulative_active, 10,
        "Cycle 2 entry cumulative_active must be 10"
    );
    assert_eq!(
        entry2.merged_through_cycle, 1,
        "Cycle 2 entry merged_through_cycle must be 1"
    );
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
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.draw_cycle_id = 2;
    });

    // Batch 1: 0..7
    let meta1 = send_prepare(&mut ctx, 7).expect("Batch 1 should succeed");
    let event1 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta1);
    assert_eq!(event1.crank, ctx.crank.pubkey(), "Batch 1 crank mismatch");
    assert_eq!(event1.batch_start, 0, "Batch 1 batch_start mismatch");
    assert_eq!(event1.batch_end, 7, "Batch 1 batch_end mismatch");
    assert_eq!(
        event1.is_complete, false,
        "Batch 1 is_complete must be false"
    );

    // Batch 2: 7..14
    ctx.svm.expire_blockhash();
    let meta2 = send_prepare(&mut ctx, 7).expect("Batch 2 should succeed");
    let event2 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta2);
    assert_eq!(event2.crank, ctx.crank.pubkey(), "Batch 2 crank mismatch");
    assert_eq!(event2.batch_start, 7, "Batch 2 batch_start mismatch");
    assert_eq!(event2.batch_end, 14, "Batch 2 batch_end mismatch");
    assert_eq!(
        event2.is_complete, false,
        "Batch 2 is_complete must be false"
    );

    // Batch 3: 14..21
    ctx.svm.expire_blockhash();
    let meta3 = send_prepare(&mut ctx, 7).expect("Batch 3 should succeed");
    let event3 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta3);
    assert_eq!(event3.crank, ctx.crank.pubkey(), "Batch 3 crank mismatch");
    assert_eq!(event3.batch_start, 14, "Batch 3 batch_start mismatch");
    assert_eq!(event3.batch_end, 21, "Batch 3 batch_end mismatch");
    assert_eq!(
        event3.is_complete, false,
        "Batch 3 is_complete must be false"
    );

    // Batch 4: 21..25 (clamped from 21 + 7 = 28 to 25)
    ctx.svm.expire_blockhash();
    let meta4 = send_prepare(&mut ctx, 7).expect("Batch 4 should succeed");
    let event4 = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta4);
    assert_eq!(event4.crank, ctx.crank.pubkey(), "Batch 4 crank mismatch");
    assert_eq!(event4.batch_start, 21, "Batch 4 batch_start mismatch");
    assert_eq!(event4.batch_end, 25, "Batch 4 batch_end mismatch");
    assert_eq!(event4.is_complete, true, "Batch 4 is_complete must be true");

    // Batch 5: Already complete -> must fail fast with InvalidDrawState
    ctx.svm.expire_blockhash();
    let res = send_prepare(&mut ctx, 7);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidDrawState);

    // Verify prefix-sum invariant oracle and zero unmerged pending tickets
    let expected_total_active: u32 = entries.iter().map(|e| e.active + e.pending).sum();
    let reg_final = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let mut prev_cumulative = 0u32;
    for i in 0..25 {
        let entry = anchor::utils::registry_get_entry(&reg_final.data, i).unwrap();
        assert_eq!(
            entry.pending, 0,
            "entry {i} pending must be 0 after maturation"
        );
        assert_eq!(
            entry.cumulative_active,
            prev_cumulative + entry.active,
            "entry {i} cumulative_active must be prefix sum: {} + {}",
            prev_cumulative,
            entry.active
        );
        prev_cumulative = entry.cumulative_active;
    }
    assert_eq!(
        prev_cumulative, expected_total_active,
        "Global sum conservation: total cumulative active tickets must match sum of entries"
    );
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
    assert_eq!(
        entry5.cumulative_active, 60,
        "Entry 5 cumulative active must be 60"
    );
    assert_eq!(
        entry6.cumulative_active, 60,
        "Entry 6 cumulative active must be 60 (0 active tickets added)"
    );

    // Batch 2: 7..10 (starts on user 7, who has 0 active tickets)
    ctx.svm.expire_blockhash();
    send_prepare(&mut ctx, 7).unwrap();

    let reg_acct2 = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry7 = anchor::utils::registry_get_entry(&reg_acct2.data, 7).unwrap();
    let entry8 = anchor::utils::registry_get_entry(&reg_acct2.data, 8).unwrap();
    let entry9 = anchor::utils::registry_get_entry(&reg_acct2.data, 9).unwrap();
    assert_eq!(
        entry7.cumulative_active, 60,
        "Entry 7 cumulative active must be 60"
    );
    assert_eq!(
        entry8.cumulative_active, 60,
        "Entry 8 cumulative active must be 60"
    );
    assert_eq!(
        entry9.cumulative_active, 70,
        "Entry 9 cumulative active must be 70 (10 active tickets added)"
    );
}

#[test]
fn test_prepare_draw_saturating_u32_max_batch_size() {
    let mut entries = Vec::new();
    for _ in 0..10 {
        entries.push(anchor::state::UserEntry {
            owner: Keypair::new().pubkey(),
            active: 5,
            pending: 2,
            merged_through_cycle: 0,
            cumulative_active: 0,
            version: anchor::state::UserEntry::CURRENT_VERSION,
            _padding: [0; 3],
            _reserved: [0; 12],
        });
    }

    let mut ctx = setup(true, anchor::DrawStatus::AwaitingRandomness, &entries);

    let meta = send_prepare(&mut ctx, u32::MAX)
        .expect("batch_size = u32::MAX must succeed via saturating_add");
    let event = assert_log_event::<anchor::events::DrawPreparationProgress>(&meta);
    assert_eq!(event.pool_id, 1, "DrawPreparationProgress pool_id mismatch");
    assert_eq!(
        event.cycle_id, 0,
        "DrawPreparationProgress cycle_id mismatch"
    );
    assert_eq!(
        event.crank,
        ctx.crank.pubkey(),
        "DrawPreparationProgress crank mismatch"
    );
    assert_eq!(
        event.batch_start, 0,
        "DrawPreparationProgress batch_start mismatch"
    );
    assert_eq!(
        event.batch_end, 10,
        "DrawPreparationProgress batch_end mismatch"
    );
    assert_eq!(
        event.user_count, 10,
        "DrawPreparationProgress user_count mismatch"
    );
    assert_eq!(
        event.is_complete, true,
        "DrawPreparationProgress is_complete must be true"
    );

    let header = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(
        header.draw_prepared_up_to, 10,
        "Registry draw_prepared_up_to must be 10"
    );
    assert_eq!(header.user_count, 10, "Registry user_count must be 10");
    assert_eq!(
        header.total_active_tickets, 50,
        "Registry total_active_tickets must be 50 (5 * 10)"
    );

    let dc = read_draw_cycle_state(&ctx.svm, 1, 0);
    assert_eq!(
        dc.status,
        anchor::DrawStatus::AwaitingRandomness,
        "Draw cycle status must be AwaitingRandomness"
    );
    assert_eq!(
        dc.locked_ticket_count, 10,
        "Draw cycle locked_ticket_count must be 10"
    );
}
