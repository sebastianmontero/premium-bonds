use anchor_lang::system_program;
use anchor_lang::InstructionData;
use anchor_lang::ToAccountMetas;
use litesvm::LiteSVM;
use solana_sdk::instruction::Instruction;
use solana_sdk::message::{Message, VersionedMessage};
use solana_sdk::pubkey::Pubkey;
use solana_sdk::signature::{Keypair, Signer};
use solana_sdk::transaction::VersionedTransaction;

mod common;
use common::*;

struct DynamicRevealCtx {
    svm: LiteSVM,
    crank: Keypair,
    admin: Keypair,
    jobs_account: Keypair,
    ticket_registry: Pubkey,
    tickets: Vec<Pubkey>,
    randomness_account: Pubkey,
}

fn setup_dynamic_ctx(
    tiers: Vec<anchor::PrizeTier>,
    ticket_count: u32,
    prize_pot: u64,
) -> DynamicRevealCtx {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let crank = Keypair::new();
    let jobs = crank.insecure_clone();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let registry = Keypair::new().pubkey();
    let mut tickets = Vec::new();
    for _ in 0..ticket_count {
        tickets.push(Keypair::new().pubkey());
    }
    inject_registry_with_tickets(&mut svm, registry, 1, 10_000, ticket_count, 0, &tickets);

    let (pool_pda, bump) = pool_pda(1);
    let mut prize_tiers_arr = [anchor::PrizeTier {
        num_winners: 0,
        basis_points: 0,
        _padding: [0, 0],
    }; 10];
    for (i, t) in tiers.iter().enumerate() {
        prize_tiers_arr[i] = *t;
    }

    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id: 1,
        token_mint: Keypair::new().pubkey(),
        ticket_registry: registry,
        fee_wallet: Keypair::new().pubkey(),
        huma_pool_state: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        min_yield_threshold: 0,
        fee_basis_points: 0,
        max_yield_basis_points: 0,
        payout_timelock_seconds: 0,
        status: anchor::PoolStatus::Active as u8,
        total_deposited_principal: (ticket_count as u64) * 1_000_000,
        total_fees_accrued: 0,
        total_fees_withdrawn: 0,
        total_prizes_allocated: prize_pot,
        next_redemption_id: 0,
        total_pending_redemptions: 0,
        current_cycle_end_at: 1_700_000_000,
        is_frozen_for_draw: 1,
        current_draw_cycle_id: 0,
        prize_tiers: prize_tiers_arr,
        prize_tiers_count: tiers.len() as u8,
        _padding: [0; 3],
        version: anchor::PrizePool::CURRENT_VERSION,
        _reserved: [0; 128],
    };

    use anchor_lang::Discriminator;
    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));
    svm.set_account(
        pool_pda,
        solana_sdk::account::Account {
            lamports: 10_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut svm, randomness_account);

    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let dc = anchor::DrawCycle {
        prize_pot,
        cycle_fee_collected: 0,
        harvest_slot: 0,
        initiated_at: 1_700_000_000,
        completed_at: 0,
        randomness_account,
        pool_id: 1,
        cycle_id: 0,
        locked_ticket_count: ticket_count,
        status: anchor::DrawStatus::AwaitingRandomness,
        version: anchor::DrawCycle::CURRENT_VERSION,
        randomness_seed: [0; 32],
        _reserved: [0; 64],
    };
    inject_draw_cycle(&mut svm, 1, 0, &dc);

    DynamicRevealCtx {
        svm,
        crank,
        admin,
        jobs_account: jobs,
        ticket_registry: registry,
        tickets,
        randomness_account,
    }
}

fn inject_mock_randomness_value(
    svm: &mut LiteSVM,
    address: Pubkey,
    value: [u8; 32],
) {
    let clock: solana_sdk::clock::Clock = svm.get_sysvar();
    let mut data = vec![0u8; 8 + std::mem::size_of::<switchboard_on_demand::accounts::RandomnessAccountData>()];
    data[0..8].copy_from_slice(&[10, 66, 229, 135, 220, 239, 217, 114]);
    let mut randomness_data: switchboard_on_demand::accounts::RandomnessAccountData = bytemuck::Zeroable::zeroed();
    randomness_data.authority = solana_program_v2::pubkey::Pubkey::default();
    randomness_data.queue = solana_program_v2::pubkey::Pubkey::default();
    randomness_data.seed_slothash = [0u8; 32];
    randomness_data.seed_slot = clock.slot;
    randomness_data.oracle = solana_program_v2::pubkey::Pubkey::default();
    randomness_data.reveal_slot = clock.slot;
    randomness_data.value = value;

    let bytes: &[u8] = bytemuck::bytes_of(&randomness_data);
    data[8..8 + bytes.len()].copy_from_slice(bytes);

    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    let owner_pubkey = Pubkey::new_from_array(owner_bytes);

    svm.set_account(
        address,
        solana_sdk::account::Account {
            lamports: 1_000_000_000,
            data,
            owner: owner_pubkey,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn send_reveal(ctx: &mut DynamicRevealCtx, pool_id: u32, cycle_id: u32, seed: [u8; 32]) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    inject_mock_randomness_value(&mut ctx.svm, ctx.randomness_account, seed);
    let (pool, _) = pool_pda(pool_id);
    let (current_draw_cycle, _) = draw_cycle_pda(pool_id, cycle_id);
    let (payout_registry, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::RevealAndPickWinners {
        crank: ctx.crank.pubkey(),
        pool,
        current_draw_cycle,
        payout_registry,
        ticket_registry: ctx.ticket_registry,
        randomness_account: ctx.randomness_account,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }.to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::RevealAndPickWinners {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.crank]).unwrap();
    ctx.svm.send_transaction(tx)
}

fn send_crank_close(
    svm: &mut LiteSVM,
    caller: &Keypair,
    pool_id: u32,
    cycle_id: u32,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let (global_config, _) = global_config_pda();
    let (payout_registry, _) = payout_pda(pool_id, cycle_id);

    let accounts = anchor::accounts::CrankClosePayoutRegistry {
        global_config,
        crank: caller.pubkey(),
        payout_registry,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }.to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::CrankClosePayoutRegistry { pool_id, cycle_id }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&caller.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[caller]).unwrap();
    svm.send_transaction(tx)
}

fn send_reinvest(
    svm: &mut LiteSVM,
    crank: &Keypair,
    winner: Pubkey,
    ticket_registry: Pubkey,
    pool_id: u32,
    cycle_id: u32,
    winner_index: u32,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let (uw_pda, _) = user_winnings_pda(pool_id, &winner);
    if svm.get_account(&uw_pda).is_none() {
        inject_user_winnings(svm, pool_id, winner, 0, 0, 0);
    }

    let (pool, _) = pool_pda(pool_id);
    let (payout_registry, _) = payout_pda(pool_id, cycle_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &winner);

    let accounts = anchor::accounts::ReinvestWinnings {
        crank: crank.pubkey(),
        winner,
        payout_registry,
        pool,
        user_winnings,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }.to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ReinvestWinnings { cycle_id, winner_index }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[crank]).unwrap();
    svm.send_transaction(tx)
}

// ─── Vectors 1-18 ─────────────────────────────────────────────────────────────

#[test]
fn test_vector_1_minimal_allocation_1_winner() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    let res = send_reveal(&mut ctx, 1, 0, [1u8; 32]);
    assert!(res.is_ok(), "Reveal with 1 winner must succeed: {:?}", res);

    let (pda, _) = payout_pda(1, 0);
    let acc = ctx.svm.get_account(&pda).expect("payout registry exists");
    assert_eq!(acc.data.len(), 104 + 1 * 56); // 160 bytes exact

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 1);
    assert_eq!(winners.len(), 1);
    assert_eq!(winners[0].amount_owed, 1_000_000);
    assert_eq!(winners[0].processed, 0);
}

#[test]
fn test_vector_2_maximum_sizing_boundary_180_winners() {
    // 100 winners @ 60 bps + 80 winners @ 50 bps = 180 winners total, exactly 10,000 bps
    let tiers = vec![
        anchor::PrizeTier { num_winners: 100, basis_points: 60, _padding: [0, 0] },
        anchor::PrizeTier { num_winners: 80, basis_points: 50, _padding: [0, 0] },
    ];
    let mut ctx = setup_dynamic_ctx(tiers, 200, 10_000_000);
    let res = send_reveal(&mut ctx, 1, 0, [2u8; 32]);
    assert!(res.is_ok(), "Reveal with 180 winners must succeed: {:?}", res);

    let (pda, _) = payout_pda(1, 0);
    let acc = ctx.svm.get_account(&pda).expect("payout registry exists");
    assert_eq!(acc.data.len(), 104 + 180 * 56); // 10,184 bytes exact

    let pr = read_payout_registry(&ctx.svm, 1, 0);
    let winners = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(pr.winners_count, 180);
    assert_eq!(winners.len(), 180);
}

#[test]
fn test_vector_3_oversized_rejection_181_winners() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 181,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    let res = send_reveal(&mut ctx, 1, 0, [3u8; 32]);
    assert_custom_error(res, anchor::error::PremiumBondsError::TooManyWinners);
}

#[test]
fn test_vector_4_tier_sum_consistency() {
    let authority = Keypair::new();
    let admin = Keypair::new();
    let mut svm = setup_global_config_with_admin(&authority, &admin.pubkey(), None);
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();
    let (pool_pda, _) = pool_pda(1);
    inject_pool(&mut svm, 1, Pubkey::new_unique(), Pubkey::new_unique(), anchor::PoolStatus::Active, false);

    // 1. Setting tiers totalling 180 winners succeeds
    let valid_tiers = vec![
        anchor::PrizeTier { num_winners: 100, basis_points: 60, _padding: [0, 0] },
        anchor::PrizeTier { num_winners: 80, basis_points: 50, _padding: [0, 0] },
    ];
    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::SetPrizeTiers {
        global_config,
        admin: admin.pubkey(),
        pool: pool_pda,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }.to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: accounts.clone(),
        data: anchor::instruction::SetPrizeTiers {
            tiers: valid_tiers,
        }.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(res.is_ok(), "Setting 180 winners must succeed: {:?}", res);

    // 2. Setting tiers totalling 181 winners fails
    let invalid_tiers = vec![
        anchor::PrizeTier { num_winners: 101, basis_points: 60, _padding: [0, 0] },
        anchor::PrizeTier { num_winners: 80, basis_points: 50, _padding: [0, 0] },
    ];
    let ix_invalid = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::SetPrizeTiers {
            tiers: invalid_tiers,
        }.data(),
    };
    let bh = svm.latest_blockhash();
    let msg_invalid = Message::new_with_blockhash(&[ix_invalid], Some(&admin.pubkey()), &bh);
    let tx_invalid = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_invalid), &[&admin]).unwrap();
    let res_invalid = svm.send_transaction(tx_invalid);
    assert_custom_error(res_invalid, anchor::error::PremiumBondsError::TooManyWinners);
}

#[test]
fn test_vector_5_clean_crank_close_reimbursement() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [5u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");

    let (pda, _) = payout_pda(1, 0);
    let acc_before = ctx.svm.get_account(&pda).expect("exists before close");
    let rent_before = acc_before.lamports;
    let crank_before = ctx.svm.get_account(&ctx.crank.pubkey()).unwrap().lamports;

    let meta = send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0).expect("crank_close must succeed");

    // Verify account is closed
    let acc_after = ctx.svm.get_account(&pda);
    assert!(acc_after.is_none() || acc_after.unwrap().lamports == 0, "Account must be zeroed");

    let crank_after = ctx.svm.get_account(&ctx.crank.pubkey()).unwrap().lamports;
    assert_eq!(crank_after + meta.fee, crank_before + rent_before, "Crank receives 100% rent reimbursement");
}

#[test]
fn test_vector_6_jobs_account_authorized_close() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [6u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");

    let res = send_crank_close(&mut ctx.svm, &ctx.jobs_account, 1, 0);
    assert!(res.is_ok(), "Jobs account close must succeed: {:?}", res);
}

#[test]
fn test_vector_7_admin_fallback_close() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [7u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");

    let res = send_crank_close(&mut ctx.svm, &ctx.admin, 1, 0);
    assert!(res.is_ok(), "Admin fallback close must succeed: {:?}", res);
}

#[test]
fn test_vector_8_unauthorized_crank_rejected() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [8u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");

    let stranger = Keypair::new();
    ctx.svm.airdrop(&stranger.pubkey(), 10_000_000_000).unwrap();

    let res = send_crank_close(&mut ctx.svm, &stranger, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::UnauthorizedCrank);
}

#[test]
fn test_vector_9_premature_close_rejected() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 2,
        basis_points: 5000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [9u8; 32]).expect("reveal");

    // Process only 1 of 2 winners
    let winner0 = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner0, ctx.ticket_registry, 1, 0, 0).expect("reinvest 0");

    let res = send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::PayoutsPending);
}

#[test]
fn test_vector_10_voided_draw_close_permitted() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 2,
        basis_points: 5000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [10u8; 32]).expect("reveal");

    // Void the draw cycle and payout registry via admin
    let (global_config, _) = global_config_pda();
    let (pool_pda, _) = pool_pda(1);
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let (payout_pda, _) = payout_pda(1, 0);

    let accounts = anchor::accounts::AdminVoidPayoutRegistry {
        global_config,
        admin: ctx.admin.pubkey(),
        pool: pool_pda,
        current_draw_cycle: dc_pda,
        payout_registry: payout_pda,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }.to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
    };
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    ctx.svm.send_transaction(tx).expect("Admin void must succeed");

    // Close must succeed immediately even with 0 payouts completed
    let res = send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0);
    assert!(res.is_ok(), "Closing voided payout registry must succeed: {:?}", res);
}

#[test]
fn test_vector_11_double_close_rejected() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [11u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");

    send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0).expect("first close");

    // Second close must fail
    let res = send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0);
    assert!(res.is_err(), "Second close must fail");
}

#[test]
fn test_vector_12_reinvest_on_closed_account_rejected() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [12u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");
    send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0).expect("close");

    // Reinvest attempt on closed registry fails
    let res = send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0);
    assert!(res.is_err(), "Reinvest on closed account must fail");
}

#[test]
fn test_vector_13_voiding_on_closed_account_rejected() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [13u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");
    send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0).expect("close");

    let (global_config, _) = global_config_pda();
    let (pool_pda, _) = pool_pda(1);
    let (dc_pda, _) = draw_cycle_pda(1, 0);
    let (payout_pda, _) = payout_pda(1, 0);

    let accounts = anchor::accounts::AdminVoidPayoutRegistry {
        global_config,
        admin: ctx.admin.pubkey(),
        pool: pool_pda,
        current_draw_cycle: dc_pda,
        payout_registry: payout_pda,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }.to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::AdminVoidPayoutRegistry {}.data(),
    };
    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_err(), "Voiding on closed account must fail");
}

#[test]
fn test_vector_14_corrupted_trailing_slice_safety() {
    let tiers = vec![anchor::PrizeTier {
        num_winners: 1,
        basis_points: 10_000,
        _padding: [0, 0],
    }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [14u8; 32]).expect("reveal");

    let (pda, _) = payout_pda(1, 0);
    let mut acc = ctx.svm.get_account(&pda).unwrap();
    // Truncate trailing slice by 10 bytes
    acc.data.truncate(acc.data.len() - 10);
    ctx.svm.set_account(pda, acc).unwrap();

    let winner = ctx.tickets[0];
    let res = send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidRegistryState);
}

#[test]
fn test_vector_15_winner_slice_in_place_mutation_parity() {
    let tiers = vec![
        anchor::PrizeTier { num_winners: 1, basis_points: 5000, _padding: [0, 0] },
        anchor::PrizeTier { num_winners: 1, basis_points: 5000, _padding: [0, 0] },
    ];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 2_000_000);
    send_reveal(&mut ctx, 1, 0, [15u8; 32]).expect("reveal");

    let winners_before = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners_before.len(), 2);
    assert_eq!(winners_before[0].processed, 0);
    assert_eq!(winners_before[1].processed, 0);

    // Process winner 0
    send_reinvest(&mut ctx.svm, &ctx.crank, winners_before[0].winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest 0");

    let winners_after = read_payout_winners(&ctx.svm, 1, 0);
    assert_eq!(winners_after[0].processed, 1);
    assert_eq!(winners_after[0].bonds_bought, 1); // 1M owed -> 1 bond
    // Winner 1 must remain untouched
    assert_eq!(winners_after[1].processed, 0);
    assert_eq!(winners_after[1].bonds_bought, 0);
    assert_eq!(winners_after[1].amount_owed, winners_before[1].amount_owed);
    assert_eq!(winners_after[1].winner, winners_before[1].winner);
}

#[test]
fn test_vector_16_dust_conservation_under_dynamic_sizing() {
    // 3 tiers: 3333 bps (1 winner), 3333 bps (1 winner), 3333 bps (1 winner) = 9999 bps distributed, 1 bps remainder dust
    let tiers = vec![
        anchor::PrizeTier { num_winners: 1, basis_points: 3333, _padding: [0, 0] },
        anchor::PrizeTier { num_winners: 1, basis_points: 3333, _padding: [0, 0] },
        anchor::PrizeTier { num_winners: 1, basis_points: 3333, _padding: [0, 0] },
    ];
    let prize_pot = 10_000_000u64;
    let mut ctx = setup_dynamic_ctx(tiers, 10, prize_pot);
    let meta = send_reveal(&mut ctx, 1, 0, [16u8; 32]).expect("reveal");

    let event = assert_cpi_event::<anchor::events::DrawCompleted>(&meta);
    // 3 * 3_333_000 = 9_999_000 distributed, 1_000 dust refunded from liabilities
    assert_eq!(event.total_distributed, 9_999_000);

    let (pool_pda, _) = pool_pda(1);
    let pool_acc = ctx.svm.get_account(&pool_pda).unwrap();
    let pool = *bytemuck::from_bytes::<anchor::PrizePool>(&pool_acc.data[8..8 + std::mem::size_of::<anchor::PrizePool>()]);
    assert_eq!(pool.total_prizes_allocated, 9_999_000);
}

#[test]
fn test_vector_17_rent_exemption_dynamic_verification() {
    let tiers_1 = vec![anchor::PrizeTier { num_winners: 1, basis_points: 10_000, _padding: [0, 0] }];
    let mut ctx1 = setup_dynamic_ctx(tiers_1, 10, 1_000_000);
    send_reveal(&mut ctx1, 1, 0, [17u8; 32]).expect("reveal 1 winner");
    let (pda1, _) = payout_pda(1, 0);
    let acc1 = ctx1.svm.get_account(&pda1).unwrap();

    let tiers_10 = vec![anchor::PrizeTier { num_winners: 10, basis_points: 1000, _padding: [0, 0] }];
    let mut ctx10 = setup_dynamic_ctx(tiers_10, 20, 10_000_000);
    send_reveal(&mut ctx10, 1, 0, [17u8; 32]).expect("reveal 10 winners");
    let (pda10, _) = payout_pda(1, 0);
    let acc10 = ctx10.svm.get_account(&pda10).unwrap();

    // 10 winners account size > 1 winner account size
    assert!(acc10.data.len() > acc1.data.len());
    assert_eq!(acc1.data.len(), 104 + 1 * 56);
    assert_eq!(acc10.data.len(), 104 + 10 * 56);
    // Dynamic rent required is proportional to space
    assert!(acc10.lamports > acc1.lamports);
}

#[test]
fn test_vector_18_crank_close_event_payload_parity() {
    let tiers = vec![anchor::PrizeTier { num_winners: 1, basis_points: 10_000, _padding: [0, 0] }];
    let mut ctx = setup_dynamic_ctx(tiers, 10, 1_000_000);
    send_reveal(&mut ctx, 1, 0, [18u8; 32]).expect("reveal");

    let winner = read_payout_winners(&ctx.svm, 1, 0)[0].winner;
    send_reinvest(&mut ctx.svm, &ctx.crank, winner, ctx.ticket_registry, 1, 0, 0).expect("reinvest");

    let (pda, _) = payout_pda(1, 0);
    let rent_expected = ctx.svm.get_account(&pda).unwrap().lamports;

    let meta = send_crank_close(&mut ctx.svm, &ctx.crank, 1, 0).expect("close");
    let event = assert_cpi_event::<anchor::events::PayoutRegistryClosed>(&meta);

    assert_eq!(event.pool_id, 1);
    assert_eq!(event.cycle_id, 0);
    assert_eq!(event.crank, ctx.crank.pubkey());
    assert_eq!(event.rent_reclaimed_lamports, rent_expected);
    assert!(event.timestamp > 0);
}
