//! Lifecycle Milestone Test: Yield Harvesting and Draw Resolution
//!
//! Verifies the core yield accumulation, draw preparation, and VRF resolution lifecycle:
//! 1. Multi-user bond purchases across cycles.
//! 2. Pending to active ticket transition on harvest.
//! 3. Yield generation and harvest commit.
//! 4. Batch prepare_draw processing.
//! 5. VRF reveal and winner selection with unfreezing.

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

struct TestHarness {
    svm: LiteSVM,
    admin: Keypair,
    crank: Keypair,
    alice: Keypair,
    bob: Keypair,
    pool_id: u32,
    usdc_mint: Pubkey,
    pst_mint: Pubkey,
    ticket_registry: Pubkey,
    huma_pool_state: Pubkey,
    huma_pool_authority: Pubkey,
    huma_pool_underlying_token: Pubkey,
    alice_usdc: Pubkey,
    bob_usdc: Pubkey,
}

fn setup_lifecycle_harness() -> TestHarness {
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

    send_initialize_global(
        &mut svm,
        &admin,
        &admin.pubkey(),
        &guardian.pubkey(),
        &crank.pubkey(),
    )
    .expect("Initialize GlobalConfig must succeed");

    let (global_config, _) = global_config_pda();
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
        anchor::PrizeTier {
            num_winners: 1,
            basis_points: 6000,
            _padding: [0; 2],
        },
        anchor::PrizeTier {
            num_winners: 2,
            basis_points: 2000,
            _padding: [0; 2],
        },
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

    let dummy = Keypair::new().pubkey();
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
        data: anchor::instruction::InitializeHumaLender {}.data(),
    };
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("Initialize Huma Lender must succeed");

    let alice_usdc = Keypair::new().pubkey();
    inject_token_account(&mut svm, alice_usdc, usdc_mint, alice.pubkey(), 200_000_000);
    let bob_usdc = Keypair::new().pubkey();
    inject_token_account(&mut svm, bob_usdc, usdc_mint, bob.pubkey(), 100_000_000);

    TestHarness {
        svm,
        admin,
        crank,
        alice,
        bob,
        pool_id,
        usdc_mint,
        pst_mint,
        ticket_registry,
        huma_pool_state,
        huma_pool_authority,
        huma_pool_underlying_token,
        alice_usdc,
        bob_usdc,
    }
}

#[test]
fn test_lifecycle_yield_harvest_and_draw_resolution() {
    let mut h = setup_lifecycle_harness();
    let (pool_pda_addr, _) = pool_pda(h.pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(h.pool_id);
    let (gc, _) = global_config_pda();

    let mut ctx = E2eContext {
        svm: h.svm,
        admin: h.admin,
        user: h.alice,
        usdc_mint_authority: Keypair::new(),
        usdc_mint: h.usdc_mint,
        pst_mint: h.pst_mint,
        ticket_registry: h.ticket_registry,
        huma_pool_state: h.huma_pool_state,
        huma_pool_authority: h.huma_pool_authority,
        huma_pool_underlying_token: h.huma_pool_underlying_token,
        user_usdc_account: h.alice_usdc,
    };

    // 1. Deposits in Cycle 0
    send_e2e_buy_bonds(&mut ctx, 100).expect("Alice buy_bonds must succeed");
    send_e2e_buy_bonds_for_user(&mut ctx, &h.bob, h.bob_usdc, 50, Pubkey::default())
        .expect("Bob buy_bonds must succeed");

    let reg_0 = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg_0.user_count, 2, "2 users registered in ticket registry");
    assert_eq!(reg_0.total_pending_tickets, 150, "150 pending tickets");
    assert_eq!(reg_0.total_active_tickets, 0, "0 active tickets before cycle 0 harvest");

    // 2. Cycle 0 Harvest -> Rolls pending tickets into active tickets
    set_clock_timestamp(&mut ctx.svm, 1_700_000_000 + 25 * 3600);
    let (draw_cycle_0_pda, _) = draw_cycle_pda(h.pool_id, 0);
    let rand_acc_0 = Keypair::new().pubkey();
    inject_randomness_account_data(&mut ctx.svm, rand_acc_0, 0, 0, [0u8; 32]);

    let accounts_harvest_0 = anchor::accounts::HarvestYieldAndCommit {
        crank: h.crank.pubkey(),
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
    let msg0 = Message::new_with_blockhash(&[ix_harvest_0], Some(&h.crank.pubkey()), &bh);
    let tx0 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg0), &[&h.crank]).unwrap();
    ctx.svm.send_transaction(tx0).expect("Cycle 0 harvest must succeed");

    let reg_1 = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg_1.total_active_tickets, 150, "Pending tickets converted to active");
    assert_eq!(reg_1.total_pending_tickets, 0, "No remaining pending tickets");

    // 3. Cycle 1 Yield Generation and Harvest
    set_clock_timestamp(&mut ctx.svm, 1_700_000_000 + 50 * 3600);
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 170_000_000);
    {
        let mut pst_acc = ctx.svm.get_account(&ctx.pst_mint).unwrap();
        pst_acc.data[36..44].copy_from_slice(&150_000_000u64.to_le_bytes());
        ctx.svm.set_account(ctx.pst_mint, pst_acc).unwrap();
    }

    let (draw_cycle_1_pda, _) = draw_cycle_pda(h.pool_id, 1);
    let rand_acc_1 = Keypair::new().pubkey();
    inject_randomness_account_data(&mut ctx.svm, rand_acc_1, 0, 0, [0u8; 32]);

    let accounts_harvest_1 = anchor::accounts::HarvestYieldAndCommit {
        crank: h.crank.pubkey(),
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
    let msg1 = Message::new_with_blockhash(&[ix_harvest_1], Some(&h.crank.pubkey()), &bh1);
    let tx1 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg1), &[&h.crank]).unwrap();
    ctx.svm.send_transaction(tx1).expect("Cycle 1 harvest must succeed");

    let pool_frozen = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_frozen.is_frozen_for_draw, 1, "Pool must be frozen for draw");

    // 4. Batch PrepareDraw
    let accounts_prepare = anchor::accounts::PrepareDraw {
        crank: h.crank.pubkey(),
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
    let msg_prep = Message::new_with_blockhash(&[ix_prepare], Some(&h.crank.pubkey()), &bh_prep);
    let tx_prep = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_prep), &[&h.crank]).unwrap();
    ctx.svm.send_transaction(tx_prep).expect("PrepareDraw must succeed");

    let reg_prep = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg_prep.draw_prepared_up_to, 2, "All 2 entries prepared for draw");

    // 5. Reveal VRF Randomness and Pick Winners
    let (payout_reg_pda, _) = payout_pda(h.pool_id, 1);
    let clock: solana_sdk::clock::Clock = ctx.svm.get_sysvar();
    inject_randomness_account_data(
        &mut ctx.svm,
        rand_acc_1,
        clock.slot,
        clock.slot,
        [42u8; 32],
    );

    let accounts_reveal = anchor::accounts::RevealAndPickWinners {
        crank: h.crank.pubkey(),
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
    let msg_rev = Message::new_with_blockhash(&[ix_reveal], Some(&h.crank.pubkey()), &bh_rev);
    let tx_rev = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_rev), &[&h.crank]).unwrap();
    ctx.svm.send_transaction(tx_rev).expect("RevealAndPickWinners must succeed");

    let pool_unfrozen = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_unfrozen.is_frozen_for_draw, 0, "Pool must be un-frozen after reveal");
    assert_eq!(pool_unfrozen.total_prizes_allocated, 18_000_000, "18 USDC prizes allocated (20 USDC total yield - 10% fee = 18 USDC)");

    let winners = read_payout_winners(&ctx.svm, h.pool_id, 1);
    assert_eq!(winners.len(), 3, "Must pick exactly 3 winners across configured tiers (1 in Tier 1, 2 in Tier 2)");
}
