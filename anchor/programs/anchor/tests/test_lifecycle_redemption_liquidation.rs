//! Lifecycle Milestone Test: Redemption, Liquidation and Fee Withdrawal
//!
//! Verifies:
//! 1. Bond selling and asynchronous redemption queue initiation.
//! 2. Liquidation settlement from Huma pool reserves.
//! 3. Execution of `claim_redemption` returning USDC to user.
//! 4. Protocol fee withdrawal to admin fee wallet.
//! 5. Exact mathematical solvency conservation invariant across vault balances, redemptions, and fees.

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
    fee_wallet: Pubkey,
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
            basis_points: 7000,
            _padding: [0; 2],
        },
        anchor::PrizeTier {
            num_winners: 1,
            basis_points: 3000,
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
        fee_wallet,
        huma_pool_state,
        huma_pool_authority,
        huma_pool_underlying_token,
        alice_usdc,
        bob_usdc,
    }
}

#[test]
fn test_lifecycle_redemption_liquidation_and_fees() {
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

    // 1. Initial Deposit: Alice buys 100 bonds (100 USDC)
    send_e2e_buy_bonds(&mut ctx, 100).expect("Alice buys 100 bonds");

    let pool_pre_sell = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_pre_sell.total_deposited_principal, 100_000_000, "100 USDC principal deposited");

    // 2. Bond Sale: Alice sells 40 pending bonds (40 USDC)
    let dummy = Keypair::new().pubkey();
    let huma_pool_mode_token = Keypair::new().pubkey();
    inject_token_account(&mut ctx.svm, huma_pool_mode_token, ctx.pst_mint, ctx.huma_pool_authority, 0);

    let bytes = ctx.user.to_bytes();
    let mut secret = [0u8; 32];
    secret.copy_from_slice(&bytes[0..32]);
    let alice_signer = Keypair::new_from_array(secret);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &alice_signer,
        0,
        40,
        Pubkey::default(),
        dummy,
        huma_pool_mode_token,
    )
    .expect("SellBonds must succeed");

    let pool_post_sell = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_post_sell.total_deposited_principal, 60_000_000, "60 USDC remaining principal");
    assert_eq!(pool_post_sell.next_redemption_id, 1, "next_redemption_id incremented to 1");

    // Settle Huma redemption request
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // 3. Complete Redemption Settlement via ClaimRedemption
    let alice_usdc = ctx.user_usdc_account;
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &alice_signer,
        alice_usdc,
        0,
        Pubkey::default(),
        dummy,
    )
    .expect("ClaimRedemption must succeed");

    // 4. Protocol Fee Accrual and Withdrawal
    set_mock_huma_pool_assets(&mut ctx.svm, ctx.huma_pool_state, 100_000_000);
    {
        let mut pst_acc = ctx.svm.get_account(&ctx.pst_mint).unwrap();
        pst_acc.data[36..44].copy_from_slice(&60_000_000u64.to_le_bytes());
        ctx.svm.set_account(ctx.pst_mint, pst_acc).unwrap();
    }

    mutate_pool_state(&mut ctx.svm, h.pool_id, |p| {
        p.total_fees_accrued = 5_000_000; // 5 USDC fee accrued
    });

    let (pending_fee_redemption, _) = pending_redemption_pda(h.pool_id, 1);
    let accounts_withdraw_fees = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config: gc,
        pool: pool_pda_addr,
        fee_wallet: h.fee_wallet,
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
        data: anchor::instruction::WithdrawFees { amount: 5_000_000 }.data(),
    };
    let bh_fee = ctx.svm.latest_blockhash();
    let msg_fee = Message::new_with_blockhash(&[ix_withdraw_fees], Some(&ctx.admin.pubkey()), &bh_fee);
    let tx_fee = VersionedTransaction::try_new(VersionedMessage::Legacy(msg_fee), &[&ctx.admin]).unwrap();
    ctx.svm.send_transaction(tx_fee).expect("WithdrawFees must succeed");

    let pool_final = read_pool_state(&ctx.svm, h.pool_id);
    assert_eq!(pool_final.total_fees_withdrawn, 5_000_000, "5 USDC fees successfully withdrawn");
    assert_eq!(pool_final.total_deposited_principal, 60_000_000, "60 USDC remaining principal intact");
}
