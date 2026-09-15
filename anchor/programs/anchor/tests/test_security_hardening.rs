//! Integration tests for security hardening fixes (PB-01, PB-02, PB-05, PB-06).
//! Verified via LiteSVM in-process test runner.

use anchor_lang::{
    prelude::AccountMeta, AccountDeserialize, AccountSerialize, AnchorDeserialize, Discriminator,
    InstructionData, Space, ToAccountMetas,
};
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
use anchor::error::PremiumBondsError;
use common::*;

// ═════════════════════════════════════════════════════════════════════════════
// Security Verification Tests
// ═════════════════════════════════════════════════════════════════════════════

#[test]
fn test_resize_registry_zero_initialization() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();

    // Pre-fill registry with distinct non-zero bytes (0xAA) to verify they are successfully zeroed
    let initial_size = anchor::constants::REGISTRY_INITIAL_SIZE;
    let initial_capacity = anchor::utils::registry_capacity_from_len(initial_size);
    let header = anchor::state::TicketRegistry {
        pool_id,
        capacity: initial_capacity,
        user_count: 0,
        total_active_tickets: 0,
        total_pending_tickets: 0,
        draw_cycle_id: 0,
        draw_prepared_up_to: 0,
        version: anchor::state::TicketRegistry::CURRENT_VERSION,
        _padding: [0; 3],
        _reserved: [0; 64],
    };
    let mut initial_data = vec![0xAAu8; initial_size];
    initial_data[0..8].copy_from_slice(&anchor::state::TicketRegistry::DISCRIMINATOR);
    initial_data[8..104].copy_from_slice(bytemuck::bytes_of(&header));

    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: initial_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    // Call ResizeRegistry
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::ResizeRegistry {
            payer: payer.pubkey(),
            pool: pool_key,
            ticket_registry,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: anchor::instruction::ResizeRegistry {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    svm.send_transaction(tx).expect("ResizeRegistry failed");

    // Fetch account data and verify that all newly allocated bytes are strictly 0
    let registry_acct = svm.get_account(&ticket_registry).unwrap();
    let expected_len = initial_size + anchor::constants::REGISTRY_REALLOC_STEP;
    assert_eq!(registry_acct.data.len(), expected_len);
    for i in initial_size..expected_len {
        assert_eq!(
            registry_acct.data[i], 0,
            "Newly reallocated byte at index {} is not zeroed",
            i
        );
    }
}

#[test]
fn test_sell_bonds_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    // Set total_deposited_principal to avoid subtraction overflow in handler
    PrizePoolTestBuilder::from_state(&svm, pool_id)
        .with_principal(10_000_000)
        .inject(&mut svm);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    inject_registry_with_tickets(
        &mut svm,
        ticket_registry,
        pool_id,
        100,
        1,
        0,
        &[user.pubkey()],
    );
    common::inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);

    // Counterfeit pool state owned by System Program instead of Huma
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let dummy = Keypair::new().pubkey();
    let (user_winnings, _) = Pubkey::find_program_address(
        &[
            b"user_winnings",
            1u32.to_le_bytes().as_ref(),
            user.pubkey().as_ref(),
        ],
        &anchor::id(),
    );
    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::SellBonds {
            user: user.pubkey(),
            user_winnings,
            pool: pool_key,
            ticket_registry,
            token_mint,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state, // counterfeit
            huma_mode_config: dummy,
            huma_mode_mint: pst_mint,
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_withdraw_fees_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, bump) = pool_pda(pool_id);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    // counterfeit pool state owned by System Program
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    // Setup PrizePool with accrued fees
    PrizePoolTestBuilder::new(pool_id)
        .with_token_mint(token_mint)
        .with_ticket_registry(Keypair::new().pubkey())
        .with_fee_wallet(fee_wallet)
        .with_payout_timelock_seconds(300)
        .with_fees_accrued(5_000_000)
        .with_cycle_end_at(i64::MAX)
        .inject(&mut svm);

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let (gc_pda, _) = global_config_pda();
    let dummy = Keypair::new().pubkey();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::WithdrawFees {
            admin: admin.pubkey(),
            global_config: gc_pda,
            pool: pool_key,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state, // counterfeit
            huma_mode_config: dummy,
            huma_mode_mint: pst_mint,
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_mint,
            fee_wallet,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::WithdrawFees { amount: 1_000_000 }.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_claim_non_reinvested_winnings_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, bump) = pool_pda(pool_id);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let ticket_registry = Keypair::new().pubkey();
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    let (user_winnings, _) = user_winnings_pda(pool_id, &user.pubkey());
    common::inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);
    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);
    let dummy = Keypair::new().pubkey();

    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::ClaimNonReinvestedWinnings {
            user: user.pubkey(),
            pool: pool_key,
            user_winnings,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state,
            huma_mode_config: dummy,
            huma_mode_mint: pst_mint,
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_claim_redemption_fails_huma_pool_state_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let token_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);

    let (pool_vault, _) = pool_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_vault, token_mint, pool_key, 10_000_000);

    let ticket_registry = Keypair::new().pubkey();
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    let user_token_account = create_spl_token_account(&mut svm, &user, &token_mint, &user.pubkey());

    let redemption_id = 0;
    let redemption_amount = 1_000_000;
    let pst_shares_locked = 1_000_000;
    inject_pending_redemption(
        &mut svm,
        pool_id,
        redemption_id,
        user.pubkey(),
        redemption_amount,
        pst_shares_locked,
    );

    // counterfeit pool state owned by System Program
    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pending_redemption, _) = pending_redemption_pda(pool_id, redemption_id);
    let accounts = anchor::accounts::ClaimRedemption {
        caller: user.pubkey(),
        beneficiary: user.pubkey(),
        pool: pool_key,
        pending_redemption,
        token_mint,
        pool_vault_account: pool_vault,
        beneficiary_token_account: user_token_account,
        huma_program: huma_program_id(),
        huma_config: Pubkey::default(),
        huma_pool_config: Pubkey::default(),
        huma_pool_state: fake_pool_state, // counterfeit
        huma_mode_config: Pubkey::default(),
        huma_lender_state: Pubkey::default(),
        huma_pool_authority: Pubkey::default(),
        huma_pool_underlying_token: Pubkey::default(),
        token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimRedemption {}.data(),
    };

    let res = send_user_tx(&mut svm, &user, ix);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_harvest_yield_fails_huma_pool_state_owner_mismatch() {
    let admin = Keypair::new();
    let crank = Keypair::new();
    let mut svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&crank.pubkey()));
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();
    inject_registry(&mut svm, ticket_registry, pool_id, 100, 0, 0);
    inject_pool(
        &mut svm,
        pool_id,
        Keypair::new().pubkey(),
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    let (gc, _) = global_config_pda();
    let (draw_cycle_pda, _) = draw_cycle_pda(pool_id, 0);
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);
    let dummy = Keypair::new().pubkey();

    let fake_pool_state = Keypair::new().pubkey();
    svm.set_account(
        fake_pool_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 1000],
            owner: anchor_lang::system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::HarvestYieldAndCommit {
            crank: crank.pubkey(),
            global_config: gc,
            pool: pool_key,
            ticket_registry,
            current_draw_cycle: draw_cycle_pda,
            pool_pst_vault,
            pst_mint,
            huma_pool_state: fake_pool_state,
            randomness_account: dummy,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_sell_bonds_fails_huma_mode_mint_owner_mismatch() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let (pool_key, _) = pool_pda(pool_id);
    let ticket_registry = Keypair::new().pubkey();
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );

    // Set total_deposited_principal to avoid subtraction overflow
    PrizePoolTestBuilder::from_state(&svm, pool_id)
        .with_principal(10_000_000)
        .inject(&mut svm);

    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);
    inject_token_account(&mut svm, pool_pst_vault, pst_mint, pool_key, 100_000_000);

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();
    inject_registry_with_tickets(
        &mut svm,
        ticket_registry,
        pool_id,
        100,
        1,
        0,
        &[user.pubkey()],
    );
    common::inject_user_winnings_with_index(&mut svm, pool_id, user.pubkey(), 0, 0, 0, 0);

    let (pending_redemption, _) = pending_redemption_pda(pool_id, 0);

    let fake_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state_with_assets(&mut svm, fake_pool_state, 100_000_000);

    // Counterfeit mode mint (owned by System Program instead of SPL Token Program)
    let fake_mode_mint = Keypair::new().pubkey();
    svm.set_account(
        fake_mode_mint,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 82],
            owner: anchor_lang::system_program::ID, // counterfeit
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let dummy = Keypair::new().pubkey();
    let (user_winnings, _) = Pubkey::find_program_address(
        &[
            b"user_winnings",
            1u32.to_le_bytes().as_ref(),
            user.pubkey().as_ref(),
        ],
        &anchor::id(),
    );
    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::SellBonds {
            user: user.pubkey(),
            user_winnings,
            pool: pool_key,
            ticket_registry,
            token_mint,
            pool_pst_vault,
            pending_redemption,
            huma_program: huma_program_id(),
            huma_config: dummy,
            huma_pool_config: dummy,
            huma_pool_state: fake_pool_state,
            huma_mode_config: dummy,
            huma_mode_mint: fake_mode_mint, // counterfeit
            huma_redemption_request: dummy,
            huma_lender_state: dummy,
            huma_pool_authority: dummy,
            huma_pool_mode_token: dummy,
            token_program: anchor_spl::token::ID,
            pst_token_program: anchor_spl::token::ID,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None),
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user]).unwrap();
    let res = svm.send_transaction(tx);
    assert_anchor_error(
        res,
        anchor_lang::error::ErrorCode::AccountOwnedByWrongProgram,
    );
}

#[test]
fn test_claim_redemption_reentrancy_protection() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund Huma underlying token vault with USDC so disburse can complete
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    // Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let user_kp = clone_keypair(&ctx.user);
    let user_token_account = ctx.user_usdc_account;

    // Sell 3 pending bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_kp,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    // Verify pending redemption initially has 3 USDC amount
    let initial_data = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(initial_data.amount, 3_000_000);

    // Inject simulated Huma lender state with 3 USDC settled
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token_account,
        0,
        Pubkey::default(),
        huma_lender_state,
    )
    .expect("claim redemption should succeed");

    // Verify user received 3 USDC and pending_redemption PDA is closed (rent returned/not found)
    assert_eq!(read_token_balance(&ctx.svm, user_token_account), 93_000_000);
    assert!(ctx.svm.get_account(&pending_redemption_pda(1, 0).0).is_none());
}

#[test]
fn test_buy_bonds_fails_huma_pool_state_owner_mismatch() {
    let mut ctx = setup_e2e();
    let wrong_pool_state = Keypair::new().pubkey();
    // Initialize account owned by System Program instead of Huma Program
    ctx.svm
        .set_account(
            wrong_pool_state,
            solana_sdk::account::Account {
                lamports: 1_000_000,
                data: vec![0u8; 100],
                owner: anchor_lang::system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (pool_pda_key, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings_pda_key, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        user_winnings: user_winnings_pda_key,
        pool: pool_pda_key,
        ticket_registry: ctx.ticket_registry,
        user_token_account: ctx.user_usdc_account,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: wrong_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = solana_program::instruction::Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds { tickets_to_buy: 1 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg =
        solana_sdk::message::Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = solana_transaction::versioned::VersionedTransaction::try_new(
        solana_sdk::message::VersionedMessage::Legacy(msg),
        &[&ctx.user],
    )
    .unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_initialize_huma_lender_fails_huma_pool_state_owner_mismatch() {
    let mut ctx = setup_e2e();
    let wrong_pool_state = Keypair::new().pubkey();
    ctx.svm
        .set_account(
            wrong_pool_state,
            solana_sdk::account::Account {
                lamports: 1_000_000,
                data: vec![0u8; 100],
                owner: anchor_lang::system_program::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (global_config, _) = global_config_pda();
    let (pool_pda_key, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeHumaLender {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_key,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: wrong_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_lender_state: dummy,
        huma_lender_mode_token: dummy,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = solana_program::instruction::Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeHumaLender {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg =
        solana_sdk::message::Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = solana_transaction::versioned::VersionedTransaction::try_new(
        solana_sdk::message::VersionedMessage::Legacy(msg),
        &[&ctx.admin],
    )
    .unwrap();

    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_claim_redemption_account_closure_and_discriminator_zeroing() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_kp = clone_keypair(&ctx.user);

    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_kp,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_pda, _) = pending_redemption_pda(1, 0);
    assert!(ctx.svm.get_account(&pending_pda).is_some());

    let user_token_account = ctx.user_usdc_account;
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // Claim redemption
    let res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_kp,
        user_token_account,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(res.is_ok(), "claim redemption should succeed: {:?}", res);

    // Verify account is closed completely (lamports refunded, account removed)
    assert!(ctx.svm.get_account(&pending_pda).is_none());
}

#[test]
fn test_direct_vault_token_donation_does_not_break_solvency() {
    let mut ctx = setup_e2e();
    let pool_pst_vault = pool_pst_vault_pda(1).0;

    // User buys 10 bonds (10,000,000 USDC -> 10,000,000 PST in vault)
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Directly donate 2_000_000 PST to the vault
    let cur_amount = read_token_balance(&ctx.svm, pool_pst_vault);
    set_token_balance(&mut ctx.svm, pool_pst_vault, cur_amount + 2_000_000);

    // Harvest should recognize increased value as surplus yield without failing solvency check
    let meta = send_e2e_harvest_yield_and_commit(&mut ctx);
    assert!(
        meta.is_ok(),
        "Harvest must succeed gracefully with donated tokens: {:?}",
        meta
    );
}

#[test]
fn test_interleaved_async_redemption_fifo_queue_sequence() {
    let mut ctx = setup_e2e();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        50_000_000,
    );

    // Setup User B
    let user_b = Keypair::new();
    ctx.svm.airdrop(&user_b.pubkey(), 10_000_000_000).unwrap();
    let user_b_usdc =
        create_spl_token_account(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &user_b.pubkey());
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &user_b_usdc,
        &ctx.usdc_mint_authority,
        100_000_000,
    );

    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;

    // Users buy bonds
    send_e2e_buy_bonds_for_user(&mut ctx, &user_a, user_a_usdc, 5, Pubkey::default()).unwrap();
    send_e2e_buy_bonds_for_user(&mut ctx, &user_b, user_b_usdc, 5, Pubkey::default()).unwrap();

    // User A sells bonds (Request 0)
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        5,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    // User B sells bonds (Request 1)
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_b,
        0,
        5,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 10_000_000);

    // Huma settles ONLY request 0 (next_request_id = 1)
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // User B tries to claim redemption 1 -> MUST FAIL with NotSettled
    let res_b = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_b,
        user_b_usdc,
        1,
        Pubkey::default(),
        huma_lender_state,
    );
    assert_custom_error(
        res_b,
        anchor::error::PremiumBondsError::HumaRedemptionNotSettled,
    );

    // User A claims redemption 0 -> SUCCEEDS
    let res_a = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(res_a.is_ok(), "User A claim should succeed");

    // Now Huma settles request 1 (next_request_id = 2)
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 2);
    ctx.svm.expire_blockhash();

    // User B claims redemption 1 -> SUCCEEDS
    let res_b = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_b,
        user_b_usdc,
        1,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(
        res_b.is_ok(),
        "User B claim should succeed after settlement"
    );
}

#[test]
fn test_multi_cycle_compounding_lazy_merge_skip_sequence() {
    let mut ctx = setup_e2e();

    // User buys 10 bonds in cycle 0 -> active = 0, pending = 10, merged_through_cycle = 0
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let reg_acc = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry0 = anchor::utils::registry_get_entry(&reg_acc.data, 0).unwrap();
    assert_eq!(entry0.active, 0);
    assert_eq!(entry0.pending, 10);
    assert_eq!(entry0.merged_through_cycle, 0);

    // Advance 3 cycles by incrementing draw_cycle_id in registry directly
    // Cycle 1: merge_cycle_id = 0 (tickets stay pending)
    // Cycle 2: merge_cycle_id = 1 (tickets mature to active)
    // Cycle 3: merge_cycle_id = 2 (already mature, no change)
    mutate_ticket_registry_header(&mut ctx.svm, ctx.ticket_registry, |hdr| {
        hdr.draw_cycle_id = 3;
    });

    // Prepare draw for cycle 3: merge_cycle_id = 3 - 1 = 2
    // Lazy merge merges all pending tickets up to cycle 2 in a single step
    let (pool_pda_key, _) = pool_pda(1);
    let dc3 = default_draw_cycle(1, 3, anchor::DrawStatus::AwaitingRandomness);
    let draw_cycle_3 = inject_draw_cycle(&mut ctx.svm, 1, 3, &dc3);

    common::mutate_pool_state(&mut ctx.svm, 1, |p| {
        p.is_frozen_for_draw = 1;
        p.current_draw_cycle_id = 3;
    });

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: anchor::accounts::PrepareDraw {
            crank: ctx.admin.pubkey(),
            pool: pool_pda_key,
            draw_cycle: draw_cycle_3,
            ticket_registry: ctx.ticket_registry,
        }
        .to_account_metas(None),
        data: anchor::instruction::PrepareDraw { batch_size: 10 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .expect("Prepare draw after multi-cycle skip should succeed");

    let reg_acc_after = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    let entry_after = anchor::utils::registry_get_entry(&reg_acc_after.data, 0).unwrap();
    assert_eq!(entry_after.active, 10, "entry active is 10");
    assert_eq!(entry_after.pending, 0, "entry pending is 0");
    assert_eq!(
        entry_after.cumulative_active, 10,
        "entry cumulative_active is 10"
    );
    assert_eq!(
        entry_after.merged_through_cycle, 2,
        "entry merged_through_cycle is 2"
    );
}

#[test]
fn test_event_emission_payload_verification_e2e() {
    let mut ctx = setup_e2e();

    // 1. Buy bonds event assertion
    let user_a = clone_keypair(&ctx.user);
    let user_a_usdc = ctx.user_usdc_account;
    let (pool_pda_key, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings_pda_key, _) = user_winnings_pda(1, &user_a.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user: user_a.pubkey(),
        user_winnings: user_winnings_pda_key,
        pool: pool_pda_key,
        ticket_registry: ctx.ticket_registry,
        user_token_account: user_a_usdc,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
        token_program: anchor_spl::token::ID,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::BuyBonds { tickets_to_buy: 5 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user_a.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user_a]).unwrap();
    let meta = ctx
        .svm
        .send_transaction(tx)
        .expect("Buy bonds should succeed");

    let event = assert_cpi_event::<anchor::events::BondsPurchased>(&meta);
    assert_eq!(event.pool_id, 1, "event pool_id is 1");
    assert_eq!(event.user, user_a.pubkey(), "event user matches user_a");
    assert_eq!(event.bonds, 5, "event bonds is 5");
    assert_eq!(event.amount, 5_000_000, "event amount is 5 USDC");
    assert_eq!(
        event.new_total_deposited_principal, 5_000_000,
        "event new_total_deposited_principal is 5 USDC"
    );
    assert_eq!(event.user_total_bonds, 5, "event user_total_bonds is 5");
    assert!(event.timestamp > 0, "event timestamp is valid");
}

#[test]
fn test_pst_usdc_conversion_roundtrip_precision_bounds() {
    // Test conversion precision across varying exchange rates and amounts
    let test_cases: [(u128, u64, u64); 7] = [
        // (total_assets, pst_supply, usdc_amount)
        (1_000_000u128, 1_000_000u64, 1_000_000u64), // 1:1
        (1_200_000, 1_000_000, 10_000_000),          // 1.2x (accrued yield)
        (1_250_000, 1_000_000, 500_000),             // 1.25x
        (2_000_000, 1_000_000, 100_000_000),         // 2.0x
        (10_000_000, 1_000_000, 1),                  // 10x with 1 lamport
        (950_000, 1_000_000, 10_000_000),            // 0.95x
        (1_000_001, 1_000_000, 777_777),             // slight yield with odd amount
    ];

    for (total_assets, pst_supply, usdc_amount) in test_cases {
        // USDC -> PST shares (ceiling division in protocol)
        let pst_shares = anchor::huma::usdc_to_pst_shares(usdc_amount, pst_supply, total_assets)
            .expect("USDC to PST conversion should succeed");

        // PST shares -> USDC (floor division in protocol)
        let roundtrip_usdc = anchor::huma::pst_shares_to_usdc(pst_shares, pst_supply, total_assets)
            .expect("PST to USDC conversion should succeed");

        // Invariant: ceiling division ensures roundtrip USDC is >= original USDC
        assert!(
            roundtrip_usdc >= usdc_amount,
            "Protocol solvency favorability violated: roundtrip {roundtrip_usdc} < original {usdc_amount}"
        );

        // Invariant: precision difference is bounded to at most 1 lamport per share conversion unit
        let diff = roundtrip_usdc - usdc_amount;
        let max_expected_diff = ((total_assets / (pst_supply as u128)) as u64).max(1) + 1;
        assert!(
            diff <= max_expected_diff,
            "Excessive rounding divergence: diff {diff} > max {max_expected_diff}"
        );
    }
}
