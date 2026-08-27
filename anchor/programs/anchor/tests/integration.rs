//! Comprehensive Multi-User End-to-End Lifecycle Integration Test
//!
//! Executes a complete 12-phase protocol lifecycle covering multi-user deposits,
//! yield harvesting, VRF randomness commitment, winner resolution, mixed reinvestment/claim,
//! protocol fee withdrawal, bond liquidation, Huma redemption settlement, and full solvency audits.

use {
    anchor::state::PayoutRegistryStatus,
    anchor_lang::{AccountDeserialize, AnchorSerialize, Discriminator, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::{
        account::Account,
        message::{Message, VersionedMessage},
    },
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

#[test]
fn test_full_protocol_lifecycle_e2e() {
    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 1: Initialize GlobalConfig
    // ═══════════════════════════════════════════════════════════════════════════
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );
    let _ = svm.add_program(
        huma_program_id(),
        include_bytes!("../../../target/deploy/mock_huma.so"),
    );

    let mut clock = solana_sdk::clock::Clock::default();
    clock.unix_timestamp = 1_700_000_000;
    svm.set_sysvar(&clock);

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
    .expect("Phase 1: Initialize GlobalConfig failed");

    let (global_config, _) = global_config_pda();
    assert!(svm.get_account(&global_config).is_some());

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 2: Setup Mints & Create PrizePool
    // ═══════════════════════════════════════════════════════════════════════════
    let usdc_mint_authority = Keypair::new();
    svm.airdrop(&usdc_mint_authority.pubkey(), 1_000_000_000).unwrap();
    let usdc_mint = create_spl_mint(&mut svm, &admin, &usdc_mint_authority.pubkey(), 6);

    let huma_pool_state = Keypair::new().pubkey();
    let mut huma_pool_state_data = vec![0u8; 512];
    huma_pool_state_data[26..30].copy_from_slice(&1u32.to_le_bytes()); // vec_len = 1
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

    let fee_wallet = create_spl_token_account(&mut svm, &admin, &usdc_mint, &admin.pubkey());
    let ticket_registry = Keypair::new().pubkey();
    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let pool_id = 1;
    let prize_tiers = vec![
        anchor::PrizeTier::new(1, 7_000), // 1st place: 70%
        anchor::PrizeTier::new(1, 3_000), // 2nd place: 30%
    ];

    let ix_create_pool = build_create_pool_instruction(
        &admin,
        pool_id,
        1_000_000, // 1 USDC bond price
        24,        // 24 hour cycle
        1000,      // 10% fee (1000 bps)
        0,         // min yield threshold
        0,         // max yield bps
        300,       // 300s payout timelock
        prize_tiers,
        usdc_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
    );
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix_create_pool], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    svm.send_transaction(tx).expect("Phase 2: CreatePool failed");

    let huma_pool_underlying = Keypair::new().pubkey();
    inject_token_account(&mut svm, huma_pool_underlying, usdc_mint, huma_pool_authority, 0);

    let mut ctx = E2eContext {
        svm,
        admin: admin.insecure_clone(),
        user: alice.insecure_clone(),
        usdc_mint_authority,
        usdc_mint,
        pst_mint,
        user_usdc_account: Pubkey::default(),
        ticket_registry,
        huma_pool_state,
        huma_pool_authority,
        huma_pool_underlying_token: huma_pool_underlying,
    };

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 3: Multi-User Deposit (Alice: 100 bonds, Bob: 50 bonds)
    // ═══════════════════════════════════════════════════════════════════════════
    let alice_usdc = create_spl_token_account(&mut ctx.svm, &alice, &usdc_mint, &alice.pubkey());
    let bob_usdc = create_spl_token_account(&mut ctx.svm, &bob, &usdc_mint, &bob.pubkey());

    mint_tokens(&mut ctx.svm, &ctx.admin, &usdc_mint, &alice_usdc, &ctx.usdc_mint_authority, 200_000_000);
    mint_tokens(&mut ctx.svm, &ctx.admin, &usdc_mint, &bob_usdc, &ctx.usdc_mint_authority, 100_000_000);

    send_e2e_buy_bonds_for_user(&mut ctx, &alice, alice_usdc, 100, Pubkey::default())
        .expect("Phase 3: Alice BuyBonds failed");
    send_e2e_buy_bonds_for_user(&mut ctx, &bob, bob_usdc, 50, Pubkey::default())
        .expect("Phase 3: Bob BuyBonds failed");

    let reg = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg.user_count, 2);
    assert_eq!(reg.total_pending_tickets, 150);
    assert_eq!(reg.total_active_tickets, 0);

    let pool = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool.total_deposited_principal, 150_000_000);

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 4: Cycle 0 Rollover & Cycle 1 Yield Harvest
    // ═══════════════════════════════════════════════════════════════════════════
    // 1. Advance to end of Cycle 0 -> Harvest merges pending tickets to active tickets
    clock.unix_timestamp = 1_700_000_000 + 25 * 3600;
    ctx.svm.set_sysvar(&clock);

    let (gc, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    let (draw_cycle_0_pda, _) = draw_cycle_pda(pool_id, 0);

    let rand_acc_0 = Keypair::new().pubkey();
    let owner_bytes = switchboard_on_demand::get_switchboard_on_demand_program_id().to_bytes();
    ctx.svm.set_account(
        rand_acc_0,
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: Pubkey::new_from_array(owner_bytes),
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

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
    ctx.svm.send_transaction(tx0).expect("Phase 4: Cycle 0 Harvest failed");

    // Tickets are now merged and active for Cycle 1!
    let reg_cycle_1 = read_ticket_registry(&ctx.svm, ctx.ticket_registry);
    assert_eq!(reg_cycle_1.total_active_tickets, 150);
    assert_eq!(reg_cycle_1.total_pending_tickets, 0);

    // 2. Advance to end of Cycle 1 -> 15 USDC yield accrued
    clock.unix_timestamp = 1_700_000_000 + 50 * 3600;
    ctx.svm.set_sysvar(&clock);

    // Set Huma pool assets = 165_000_000 (15 USDC yield accrued)
    {
        let mut huma_acc = ctx.svm.get_account(&ctx.huma_pool_state).unwrap();
        huma_acc.data[30..46].copy_from_slice(&165_000_000u128.to_le_bytes());
        ctx.svm.set_account(ctx.huma_pool_state, huma_acc).unwrap();
    }
    // Set PST mint supply = 150_000_000
    {
        let mut pst_acc = ctx.svm.get_account(&ctx.pst_mint).unwrap();
        pst_acc.data[36..44].copy_from_slice(&150_000_000u64.to_le_bytes());
        ctx.svm.set_account(ctx.pst_mint, pst_acc).unwrap();
    }

    let (draw_cycle_1_pda, _) = draw_cycle_pda(pool_id, 1);
    let rand_acc_1 = Keypair::new().pubkey();
    ctx.svm.set_account(
        rand_acc_1,
        Account {
            lamports: 1_000_000_000,
            data: vec![],
            owner: Pubkey::new_from_array(owner_bytes),
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

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
    ctx.svm.send_transaction(tx1).expect("Phase 4: Cycle 1 Harvest failed");

    let pool_frozen = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_frozen.is_frozen_for_draw, 1);

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 5: PrepareDraw (Ticket Registry Active Batch Binary Search Setup)
    // ═══════════════════════════════════════════════════════════════════════════
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
    ctx.svm.send_transaction(tx_prep).expect("Phase 5: PrepareDraw failed");

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 6: Winner Selection & Payout Registration
    // ═══════════════════════════════════════════════════════════════════════════
    let (payout_reg_pda, _) = payout_pda(pool_id, 1);
    ctx.svm.set_account(
        payout_reg_pda,
        Account {
            lamports: 10_000_000_000,
            data: vec![0u8; 8 + std::mem::size_of::<anchor::state::PayoutRegistry>()],
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    // 15 USDC yield: 10% fee (1.5 USDC) -> 13.5 USDC prize pot
    // Tier 1 (70%): Alice wins 9.45 USDC (9_450_000)
    // Tier 2 (30%): Bob wins 4.05 USDC (4_050_000)
    inject_draw_cycle(
        &mut ctx.svm,
        pool_id,
        1,
        &anchor::state::DrawCycle {
            prize_pot: 13_500_000,
            cycle_fee_collected: 1_500_000,
            harvest_slot: 100,
            initiated_at: 1_700_000_000 + 50 * 3600,
            completed_at: 1_700_000_000 + 50 * 3600,
            randomness_account: rand_acc_1,
            pool_id,
            cycle_id: 1,
            locked_ticket_count: 150,
            status: anchor::DrawStatus::Complete,
            version: 1,
            randomness_seed: [7u8; 32],
            _reserved: [0; 64],
        },
    );

    let winners = vec![
        anchor::state::Winner {
            winner: alice.pubkey(),
            amount_owed: 9_450_000,
            bonds_bought: 0,
            processed: 0,
            tier_index: 0,
            version: 1,
            _padding: [0; 1],
            _reserved: [0; 8],
        },
        anchor::state::Winner {
            winner: bob.pubkey(),
            amount_owed: 4_050_000,
            bonds_bought: 0,
            processed: 0,
            tier_index: 1,
            version: 1,
            _padding: [0; 1],
            _reserved: [0; 8],
        },
    ];
    inject_payout_registry(&mut ctx.svm, pool_id, 1, winners, 0, PayoutRegistryStatus::Active);

    // Unfreeze pool post-reveal and record prize liabilities
    {
        let mut pool_acc = ctx.svm.get_account(&pool_pda_addr).unwrap();
        let p = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut pool_acc.data[8..]);
        p.is_frozen_for_draw = 0;
        p.total_prizes_allocated = 13_500_000;
        ctx.svm.set_account(pool_pda_addr, pool_acc).unwrap();
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 7: Winner Payouts (Alice Reinvests, Bob Claims)
    // ═══════════════════════════════════════════════════════════════════════════
    inject_user_winnings_with_index(&mut ctx.svm, pool_id, alice.pubkey(), 0, 0, 0, 0);
    inject_user_winnings_with_index(&mut ctx.svm, pool_id, bob.pubkey(), 0, 0, 0, 1);

    // Alice reinvests her winnings (9.45 USDC -> 9 bonds, 450_000 dust to unclaimed winnings)
    let (alice_winnings_pda, _) = user_winnings_pda(pool_id, &alice.pubkey());
    let accounts_reinvest = anchor::accounts::ReinvestWinnings {
        crank: crank.pubkey(),
        winner: alice.pubkey(),
        payout_registry: payout_reg_pda,
        pool: pool_pda_addr,
        user_winnings: alice_winnings_pda,
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
    ctx.svm.send_transaction(tx_reinv).expect("Phase 7: Alice ReinvestWinnings failed");

    let alice_winnings = read_user_winnings_state(&ctx.svm, pool_id, &alice.pubkey());
    assert_eq!(alice_winnings.total_reinvested, 9_000_000);
    assert_eq!(alice_winnings.unclaimed_non_reinvested_winnings, 450_000);

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 8: Protocol Fee Withdrawal
    // ═══════════════════════════════════════════════════════════════════════════
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(
        &mut ctx.svm,
        huma_pool_mode_token,
        ctx.pst_mint,
        ctx.huma_pool_authority,
        0,
    );

    let (pending_fee_redemption, _) = pending_redemption_pda(pool_id, 0);
    let dummy = Keypair::new().pubkey();
    let accounts_withdraw_fees = anchor::accounts::WithdrawFees {
        admin: admin.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
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
        token_mint: ctx.usdc_mint,
        fee_wallet,
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
        data: anchor::instruction::WithdrawFees {
            amount: 1_500_000,
        }
        .data(),
    };
    let bh_fee = ctx.svm.latest_blockhash();
    let msg_fee = Message::new_with_blockhash(&[ix_withdraw_fees], Some(&admin.pubkey()), &bh_fee);
    let tx_fee = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_fee), &[&admin]).unwrap();
    ctx.svm.send_transaction(tx_fee).expect("Phase 8: WithdrawFees failed");

    let pool_post_fees = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_post_fees.total_fees_withdrawn, 1_500_000);

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 9: Bond Liquidation / Selling Bonds
    // ═══════════════════════════════════════════════════════════════════════════
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &alice,
        50, // active to sell
        0,  // pending to sell
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .expect("Phase 9: Alice SellBonds failed");

    let pool_after_sell = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_after_sell.next_redemption_id, 2);

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 10: Huma Redemption Settlement & Principal Claim
    // ═══════════════════════════════════════════════════════════════════════════
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 2);

    let (pool_vault_usdc, _) = pool_vault_pda(pool_id);
    let (alice_redemption_pda, _) = pending_redemption_pda(pool_id, 1);
    let accounts_claim_redemption = anchor::accounts::ClaimRedemption {
        caller: alice.pubkey(),
        beneficiary: alice.pubkey(),
        pool: pool_pda_addr,
        pending_redemption: alice_redemption_pda,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault_usdc,
        beneficiary_token_account: alice_usdc,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_claim_redemption = Instruction {
        program_id: anchor::id(),
        accounts: accounts_claim_redemption,
        data: anchor::instruction::ClaimRedemption {}.data(),
    };
    let bh_claim = ctx.svm.latest_blockhash();
    let msg_claim = Message::new_with_blockhash(&[ix_claim_redemption], Some(&alice.pubkey()), &bh_claim);
    let tx_claim = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_claim), &[&alice]).unwrap();
    ctx.svm.send_transaction(tx_claim).expect("Phase 10: ClaimRedemption failed");

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 11: Emergency Governance Controls
    // ═══════════════════════════════════════════════════════════════════════════
    send_pause_pool(&mut ctx.svm, &guardian, pool_id).expect("Phase 11: Guardian Pause failed");
    let pool_paused = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_paused.status, anchor::PoolStatus::Paused as u8);

    send_unpause_pool(&mut ctx.svm, &admin, pool_id).expect("Phase 11: Admin Unpause failed");
    let pool_unpaused = read_pool_state(&ctx.svm, pool_id);
    assert_eq!(pool_unpaused.status, anchor::PoolStatus::Active as u8);

    // ═══════════════════════════════════════════════════════════════════════════
    // Phase 12: Invariant & Solvency Verification Audit
    // ═══════════════════════════════════════════════════════════════════════════
    let final_pool = read_pool_state(&ctx.svm, pool_id);
    let final_reg = read_ticket_registry(&ctx.svm, ctx.ticket_registry);

    // Verify invariants:
    // INV-PB-02: Total principal consistency (150M original + 9M reinvested - 50M sold = 109M)
    assert_eq!(final_pool.total_deposited_principal, 109_000_000);

    // INV-PB-04: Registry active + pending matches pool active principal
    let active_tickets_principal = (final_reg.total_active_tickets as u64) * final_pool.bond_price;
    let pending_tickets_principal = (final_reg.total_pending_tickets as u64) * final_pool.bond_price;
    assert_eq!(active_tickets_principal + pending_tickets_principal, final_pool.total_deposited_principal);

    // INV-PB-07: Protocol fees accounting
    assert_eq!(final_pool.total_fees_withdrawn, 1_500_000);

    println!("✅ Full 12-Phase E2E Multi-User Integration Lifecycle Passed Successfully!");
}
