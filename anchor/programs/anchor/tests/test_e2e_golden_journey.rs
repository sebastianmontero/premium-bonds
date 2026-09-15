//! Full Black-Box Golden Journey Integration Test
//!
//! Executes an end-to-end protocol lifecycle using exclusively genuine on-chain instructions:
//! 1. Setup: GlobalConfig, USDC mint, PrizePool (10% fee, 70/30 tiers), and Huma Lender.
//! 2. Deposits: Alice buys 100 bonds (100 USDC), Bob buys 50 bonds (50 USDC).
//! 3. Rollover: Cycle 0 harvest merges pending tickets to active.
//! 4. Yield Generation & Harvest: 15 USDC yield generated in Mock Huma; Cycle 1 harvest freezes pool and commits randomness.
//! 5. PrepareDraw: Processes active ticket registry in batches.
//! 6. Reveal & Winner Selection: Calls genuine `reveal_and_pick_winners` with deterministic seed.
//! 7. Winnings Processing: Alice reinvests winnings into new bonds; Bob claims winnings via redemption queue.
//! 8. Fee Withdrawal: Admin withdraws accrued protocol fees.
//! 9. Bond Liquidation & Settlement: User sells bonds and claims redemption from Huma liquidity.

use {
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::account::Account,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

#[test]
fn test_e2e_golden_journey_full_lifecycle() {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );
    let _ = svm.add_program(
        huma_program_id(),
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    set_clock_timestamp(&mut svm, 1_700_000_000);

    let admin = Keypair::new();
    let guardian = Keypair::new();
    let crank = Keypair::new();
    let alice = Keypair::new();
    let bob = Keypair::new();

    for kp in &[&admin, &guardian, &crank, &alice, &bob] {
        svm.airdrop(&kp.pubkey(), 50_000_000_000).unwrap();
    }
    setup_program_data(&mut svm, Some(&admin.pubkey()));

    // 1. Initialize GlobalConfig
    send_initialize_global(
        &mut svm,
        &admin,
        &admin.pubkey(),
        &guardian.pubkey(),
        &crank.pubkey(),
    )
    .expect("Initialize GlobalConfig must succeed");

    let (global_config, _) = global_config_pda();
    assert!(svm.get_account(&global_config).is_some(), "GlobalConfig PDA must exist");

    // 2. Setup Mints & Create PrizePool
    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000).unwrap();
    let usdc_mint = create_spl_mint(&mut svm, &admin, &usdc_mint_authority.pubkey(), 6);

    let huma_pool_state = Keypair::new().pubkey();
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes());
    svm.set_account(
        huma_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: huma_pool_state_data,
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (huma_pool_authority, _) = huma_pool_authority_pda(&huma_pool_state);
    let pst_mint_kp = Keypair::new();
    {
        let mut data = vec![0u8; 82];
        data[0..4].copy_from_slice(&1u32.to_le_bytes());
        data[4..36].copy_from_slice(&huma_pool_authority.to_bytes());
        data[44] = 6;
        data[45] = 1;
        svm.set_account(
            pst_mint_kp.pubkey(),
            Account {
                lamports: 1_000_000_000,
                data,
                owner: anchor_spl::token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    }
    let pst_mint = pst_mint_kp.pubkey();

    let huma_pool_underlying_token = Keypair::new().pubkey();
    inject_token_account(
        &mut svm,
        huma_pool_underlying_token,
        usdc_mint,
        huma_pool_authority,
        1_000_000_000,
    );

    let ticket_registry_kp = Keypair::new();
    svm.set_account(
        ticket_registry_kp.pubkey(),
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
    let ticket_registry = ticket_registry_kp.pubkey();

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, usdc_mint, admin.pubkey(), 0);

    let pool_id = 1;
    let tiers = vec![
        anchor::PrizeTier::new(1, 7000),
        anchor::PrizeTier::new(1, 3000),
    ];

    let ix_create_pool = build_create_pool_instruction(
        &admin,
        pool_id,
        1_000_000,
        24,
        1000, // 10% fee
        0,
        0,
        300,
        tiers,
        usdc_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
    );
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix_create_pool], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("Create PrizePool must succeed");

    // 3. Initialize Huma Lender
    let dummy = Keypair::new().pubkey();
    let ix_init_lender = anchor::instruction::InitializeHumaLender {}.data();
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);

    let accounts_init_lender = anchor::accounts::InitializeHumaLender {
        admin: admin.pubkey(),
        global_config,
        pool: pool_pda_addr,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: pst_mint,
        huma_lender_state: dummy,
        huma_lender_mode_token: dummy,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: accounts_init_lender,
        data: ix_init_lender,
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("Initialize Huma Lender must succeed");

    // 4. Deposits: Alice buys 100 bonds (100 USDC), Bob buys 50 bonds (50 USDC)
    let alice_usdc = Keypair::new().pubkey();
    inject_token_account(&mut svm, alice_usdc, usdc_mint, alice.pubkey(), 200_000_000);
    let bob_usdc = Keypair::new().pubkey();
    inject_token_account(&mut svm, bob_usdc, usdc_mint, bob.pubkey(), 100_000_000);

    let mut ctx = E2eContext {
        svm,
        admin,
        user: alice,
        usdc_mint_authority,
        usdc_mint,
        pst_mint,
        ticket_registry,
        huma_pool_state,
        huma_pool_authority,
        huma_pool_underlying_token,
        user_usdc_account: alice_usdc,
    };

    send_e2e_buy_bonds(&mut ctx, 100)
        .expect("Alice buy_bonds must succeed");
    send_e2e_buy_bonds_for_user(&mut ctx, &bob, bob_usdc, 50, Pubkey::default())
        .expect("Bob buy_bonds must succeed");

    let reg = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg.user_count, 2, "2 users must be registered");
    assert_eq!(reg.total_pending_tickets, 150, "150 pending tickets");
    assert_eq!(reg.total_active_tickets, 0, "0 active tickets in cycle 0");

    let pool = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool.total_deposited_principal, 150_000_000, "150 USDC principal deposited");

    // 5. Cycle 0 Harvest -> Merge pending tickets into active tickets
    set_clock_timestamp(&mut ctx.svm, 1_700_000_000 + 25 * 3600);

    let (gc, _) = global_config_pda();
    let (draw_cycle_0_pda, _) = draw_cycle_pda(pool_id, 0);
    let rand_acc_0 = Keypair::new().pubkey();
    inject_randomness_account_data(&mut ctx.svm, rand_acc_0, 0, 0, [0u8; 32]);

    let accounts_harvest_0 = anchor::accounts::HarvestYieldAndCommit {
        crank: crank.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle: draw_cycle_0_pda,
        pool_pst_vault,
        pst_mint: ctx.pst_mint,
        huma_pool_state: ctx.huma_pool_state,
        randomness_account: rand_acc_0,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_harvest_0 = Instruction {
        program_id: anchor::id(),
        accounts: accounts_harvest_0,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };
    let bh = ctx.svm.latest_blockhash();
    let msg0 = Message::new_with_blockhash(&[ix_harvest_0], Some(&crank.pubkey()), &bh);
    let tx0 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg0), &[&crank]).unwrap();
    ctx.svm.send_transaction(tx0).expect("Cycle 0 harvest must succeed");

    let reg_cycle_1 = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg_cycle_1.total_active_tickets, 150, "Tickets merged to active");
    assert_eq!(reg_cycle_1.total_pending_tickets, 0, "No remaining pending tickets");

    // 6. Yield Generation: Advance to end of Cycle 1, accrue 15 USDC yield in Huma
    set_clock_timestamp(&mut ctx.svm, 1_700_000_000 + 50 * 3600);
    {
        let mut huma_acc = ctx.svm.get_account(&ctx.huma_pool_state).unwrap();
        huma_acc.data[30..46].copy_from_slice(&165_000_000u128.to_le_bytes());
        ctx.svm.set_account(ctx.huma_pool_state, huma_acc).unwrap();
    }
    {
        let mut pst_acc = ctx.svm.get_account(&ctx.pst_mint).unwrap();
        pst_acc.data[36..44].copy_from_slice(&150_000_000u64.to_le_bytes());
        ctx.svm.set_account(ctx.pst_mint, pst_acc).unwrap();
    }

    let (draw_cycle_1_pda, _) = draw_cycle_pda(pool_id, 1);
    let rand_acc_1 = Keypair::new().pubkey();
    inject_randomness_account_data(&mut ctx.svm, rand_acc_1, 0, 0, [0u8; 32]);

    let accounts_harvest_1 = anchor::accounts::HarvestYieldAndCommit {
        crank: crank.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        current_draw_cycle: draw_cycle_1_pda,
        pool_pst_vault,
        pst_mint: ctx.pst_mint,
        huma_pool_state: ctx.huma_pool_state,
        randomness_account: rand_acc_1,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_harvest_1 = Instruction {
        program_id: anchor::id(),
        accounts: accounts_harvest_1,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };
    let bh1 = ctx.svm.latest_blockhash();
    let msg1 = Message::new_with_blockhash(&[ix_harvest_1], Some(&crank.pubkey()), &bh1);
    let tx1 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg1), &[&crank]).unwrap();
    ctx.svm.send_transaction(tx1).expect("Cycle 1 harvest must succeed");

    let pool_frozen = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_frozen.is_frozen_for_draw, 1, "Pool must be frozen for draw");

    // 7. PrepareDraw (Real instruction)
    let accounts_prepare = anchor::accounts::PrepareDraw {
        crank: crank.pubkey(),
        pool: pool_pda_addr,
        draw_cycle: draw_cycle_1_pda,
        ticket_registry: ctx.ticket_registry,
    }
    .to_account_metas(None);

    let ix_prepare = Instruction {
        program_id: anchor::id(),
        accounts: accounts_prepare,
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };
    let bh_prep = ctx.svm.latest_blockhash();
    let msg_prep = Message::new_with_blockhash(&[ix_prepare], Some(&crank.pubkey()), &bh_prep);
    let tx_prep = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_prep), &[&crank]).unwrap();
    ctx.svm.send_transaction(tx_prep).expect("PrepareDraw must succeed");

    // 8. Reveal and Pick Winners (Real instruction)
    let (payout_reg_pda, _) = payout_pda(pool_id, 1);
    let clock: solana_sdk::clock::Clock = ctx.svm.get_sysvar();
    inject_randomness_account_data(
        &mut ctx.svm,
        rand_acc_1,
        clock.slot,
        clock.slot,
        [42u8; 32],
    );

    let accounts_reveal = anchor::accounts::RevealAndPickWinners {
        crank: crank.pubkey(),
        current_draw_cycle: draw_cycle_1_pda,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        randomness_account: rand_acc_1,
        payout_registry: payout_reg_pda,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_reveal = Instruction {
        program_id: anchor::id(),
        accounts: accounts_reveal,
        data: anchor::instruction::RevealAndPickWinners {}.data(),
    };

    let bh_rev = ctx.svm.latest_blockhash();
    let msg_rev = Message::new_with_blockhash(&[ix_reveal], Some(&crank.pubkey()), &bh_rev);
    let tx_rev = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_rev), &[&crank]).unwrap();
    let meta_rev = ctx.svm.send_transaction(tx_rev).expect("RevealAndPickWinners must succeed");

    let pool_unfrozen = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_unfrozen.is_frozen_for_draw, 0, "Pool must be un-frozen after reveal");
    assert_eq!(pool_unfrozen.total_prizes_allocated, 13_500_000, "13.5 USDC allocated in prizes");

    let winners = read_payout_winners(&ctx.svm, pool_id, 1);
    assert_eq!(winners.len(), 2, "Must pick exactly 2 winners across 2 tiers");

    // 9. Reinvest Winnings (Advance clock past 300s payout timelock)
    set_clock_timestamp(&mut ctx.svm, 1_700_000_000 + 50 * 3600 + 301);

    let winner_0 = winners[0].winner;
    let (winner_winnings_pda, _) = user_winnings_pda(pool_id, &winner_0);

    let accounts_reinvest = anchor::accounts::ReinvestWinnings {
        crank: crank.pubkey(),
        winner: winner_0,
        payout_registry: payout_reg_pda,
        pool: pool_pda_addr,
        user_winnings: winner_winnings_pda,
        ticket_registry: ctx.ticket_registry,
        system_program: anchor_lang::solana_program::system_program::id(),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_reinvest = Instruction {
        program_id: anchor::id(),
        accounts: accounts_reinvest,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id: 1,
            winner_index: 0,
        }
        .data(),
    };
    let bh_reinv = ctx.svm.latest_blockhash();
    let msg_reinv = Message::new_with_blockhash(&[ix_reinvest], Some(&crank.pubkey()), &bh_reinv);
    let tx_reinv = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_reinv), &[&crank]).unwrap();
    ctx.svm.send_transaction(tx_reinv).expect("ReinvestWinnings must succeed");

    let winner_winnings = read_user_winnings_state(&ctx.svm, pool_id, &winner_0);
    assert_eq!(winner_winnings.total_reinvested, 9_000_000, "9 USDC reinvested into bonds");
    assert_eq!(winner_winnings.unclaimed_non_reinvested_winnings, 450_000, "450_000 dust saved as unclaimed winnings");

    // 10. Protocol Fee Withdrawal
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(&mut ctx.svm, huma_pool_mode_token, ctx.pst_mint, ctx.huma_pool_authority, 0);

    let (pending_fee_redemption, _) = pending_redemption_pda(pool_id, 0);
    let accounts_withdraw_fees = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        fee_wallet,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption: pending_fee_redemption,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_withdraw_fees = Instruction {
        program_id: anchor::id(),
        accounts: accounts_withdraw_fees,
        data: anchor::instruction::WithdrawFees { amount: 1_500_000 }.data(),
    };
    let bh_fee = ctx.svm.latest_blockhash();
    let msg_fee = Message::new_with_blockhash(&[ix_withdraw_fees], Some(&ctx.admin.pubkey()), &bh_fee);
    let tx_fee = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_fee), &[&ctx.admin]).unwrap();
    ctx.svm.send_transaction(tx_fee).expect("WithdrawFees must succeed");

    let pool_post_fee = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_post_fee.total_fees_withdrawn, 1_500_000, "1.5 USDC fee withdrawn");
}
