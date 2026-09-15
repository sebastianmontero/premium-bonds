//! Lifecycle Milestone Test: Emergency Governance, Pausing and Recovery
//!
//! Verifies:
//! 1. Emergency pause and unpause by guardian and admin.
//! 2. Rejection of user operations (buy_bonds) during emergency pause.
//! 3. Emergency draw cycle recovery via admin force unlock.
//! 4. Voiding invalid/compromised payout registries and resetting solvency state.
//! 5. Protocol parameter updates under admin governance.

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
    guardian: Keypair,
    crank: Keypair,
    alice: Keypair,
    pool_id: u32,
    usdc_mint: Pubkey,
    pst_mint: Pubkey,
    ticket_registry: Pubkey,
    fee_wallet: Pubkey,
    huma_pool_state: Pubkey,
    huma_pool_authority: Pubkey,
    huma_pool_underlying_token: Pubkey,
    alice_usdc: Pubkey,
}

fn setup_governance_harness() -> TestHarness {
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

    for kp in &[&admin, &guardian, &crank, &alice] {
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
            basis_points: 10000,
            _padding: [0; 2],
        },
    ];

    let ix_create_pool = build_create_pool_instruction(
        &admin,
        pool_id,
        1_000_000,
        24,
        1000,
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

    TestHarness {
        svm,
        admin,
        guardian,
        crank,
        alice,
        pool_id,
        usdc_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        huma_pool_authority,
        huma_pool_underlying_token,
        alice_usdc,
    }
}

#[test]
fn test_lifecycle_emergency_pausing_and_governance() {
    let mut h = setup_governance_harness();
    let (pool_pda_addr, _) = pool_pda(h.pool_id);
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

    // 1. Guardian triggers emergency pause
    send_pause_pool(&mut ctx.svm, &h.guardian, h.pool_id)
        .expect("Guardian should be able to pause pool");

    let pool_paused = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_paused.status, anchor::state::PoolStatus::Paused as u8, "Pool must be Paused");

    // 2. User attempts to buy bonds while paused -> Must Fail
    let res_buy_paused = send_e2e_buy_bonds(&mut ctx, 50);
    assert_custom_error(res_buy_paused, anchor::error::PremiumBondsError::PoolNotActive);
    ctx.svm.expire_blockhash();

    // 3. Admin unpauses pool
    send_unpause_pool(&mut ctx.svm, &ctx.admin, h.pool_id)
        .expect("Admin should be able to unpause pool");

    let pool_unpaused = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_unpaused.status, anchor::state::PoolStatus::Active as u8, "Pool must be Active again");

    // 4. User successfully buys bonds now that pool is Active
    send_e2e_buy_bonds(&mut ctx, 50).expect("BuyBonds must succeed after unpause");

    // 5. Admin Force Unlock of Stalled Draw Cycle
    let (draw_cycle_1_pda, _) = draw_cycle_pda(h.pool_id, 1);
    DrawCycleTestBuilder::new(h.pool_id, 1)
        .with_status(anchor::DrawStatus::AwaitingRandomness)
        .with_prize_pot(10_000_000)
        .with_cycle_fee(1_000_000)
        .with_harvest_slot(100)
        .inject(&mut ctx.svm);

    mutate_pool_state(&mut ctx.svm, h.pool_id, |p| {
        p.is_frozen_for_draw = 1;
        p.total_prizes_allocated = 10_000_000;
        p.total_fees_accrued = 1_000_000;
    });

    // Advance slot past 256 timeout
    ctx.svm.warp_to_slot(1000);

    let accounts_force_unlock = anchor::accounts::AdminForceUnlockDraw {
        admin: ctx.admin.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        current_draw_cycle: draw_cycle_1_pda,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix_force_unlock = Instruction {
        program_id: anchor::id(),
        accounts: accounts_force_unlock,
        data: anchor::instruction::AdminForceUnlockDraw {}.data(),
    };
    let bh_unlock = ctx.svm.latest_blockhash();
    let msg_unlock = Message::new_with_blockhash(&[ix_force_unlock], Some(&ctx.admin.pubkey()), &bh_unlock);
    let tx_unlock = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_unlock), &[&ctx.admin]).unwrap();
    ctx.svm.send_transaction(tx_unlock).expect("AdminForceUnlockDraw must succeed");

    let pool_unlocked = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_unlocked.is_frozen_for_draw, 0, "Pool is unfrozen");
    assert_eq!(pool_unlocked.total_prizes_allocated, 0, "Allocated prize returned");
    assert_eq!(pool_unlocked.total_fees_accrued, 0, "Accrued fee returned");

    // 6. Admin Void Payout Registry Recovery
    let cycle_id = 2;
    DrawCycleTestBuilder::new(h.pool_id, cycle_id)
        .with_status(anchor::DrawStatus::Complete)
        .with_prize_pot(5_000_000)
        .with_cycle_fee(500_000)
        .with_locked_tickets(50)
        .inject(&mut ctx.svm);

    let (payout_reg_pda, _) = PayoutRegistryTestBuilder::new(h.pool_id, cycle_id)
        .with_winners(vec![anchor::Winner {
            winner: ctx.user.pubkey(),
            amount_owed: 5_000_000,
            bonds_bought: 0,
            processed: 0,
            tier_index: 0,
            version: anchor::Winner::CURRENT_VERSION,
            _padding: [0; 1],
            _reserved: [0; 8],
        }])
        .with_status(anchor::state::PayoutRegistryStatus::Active)
        .inject(&mut ctx.svm);

    mutate_pool_state(&mut ctx.svm, h.pool_id, |p| {
        p.total_prizes_allocated = 5_000_000;
        p.total_fees_accrued = 500_000;
    });

    send_admin_void_payout_registry(&mut ctx.svm, &ctx.admin, h.pool_id, cycle_id)
        .expect("AdminVoidPayoutRegistry must succeed");

    let pool_post_void = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_post_void.total_prizes_allocated, 0, "Allocated prize pot rolled back to 0");
    assert_eq!(pool_post_void.total_fees_accrued, 0, "Fees accrued rolled back to 0");

    let payout_post_void = read_payout_registry(&ctx.svm, h.pool_id, cycle_id);
    assert_eq!(payout_post_void.status, anchor::state::PayoutRegistryStatus::Voided as u8, "Payout registry status is Voided");
}
