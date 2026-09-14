//! Comprehensive test suite for adversarial security hardening remediations:
//! - SEC-01: Huma State Pinning & Venue Integrity
//! - SEC-03: Unified Full Liabilities Solvency Guards & Anti-Bank Run Ordering
//! - SEC-05: Supported Mint Extensions Whitelist Filter
//!
//! Run with:
//!   NO_DNA=1 cargo test --test test_adversarial_remediation -- --nocapture

use {
    anchor::error::PremiumBondsError,
    anchor_lang::{Discriminator, InstructionData, Space, ToAccountMetas},
    anchor_spl::token_2022::spl_token_2022::extension::{
        BaseStateWithExtensionsMut, ExtensionType, StateWithExtensionsMut,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::{instruction::Instruction, pubkey::Pubkey},
    solana_sdk::{account::Account, signature::Signer},
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

// ═══════════════════════════════════════════════════════════════════════════
// SEC-01: Huma State Pinning Spoofing Defense
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_buy_bonds_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        user_token_account: ctx.user_usdc_account,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: spoofed_huma_state, // Spoofed!
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
        data: anchor::instruction::BuyBonds { tickets_to_buy: 10 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_sell_bonds_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: spoofed_huma_state, // Spoofed!
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 5,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_claim_winnings_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: spoofed_huma_state, // Spoofed!
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_withdraw_fees_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (gc_pda, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (fee_wallet, _) = (read_pool_state(&ctx.svm, 1).fee_wallet, ());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config: gc_pda,
        pool: pool_pda_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: spoofed_huma_state, // Spoofed!
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
        token_mint: ctx.usdc_mint,
        fee_wallet,
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
        data: anchor::instruction::WithdrawFees { amount: 1_000 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_harvest_yield_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (gc_pda, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (draw_cycle_pda_addr, _) = draw_cycle_pda(1, 0);
    let randomness_account = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut ctx.svm, randomness_account);

    let accounts = anchor::accounts::HarvestYieldAndCommit {
        crank: ctx.admin.pubkey(),
        global_config: gc_pda,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        pool_pst_vault,
        current_draw_cycle: draw_cycle_pda_addr,
        pst_mint: ctx.pst_mint,
        huma_pool_state: spoofed_huma_state, // Spoofed!
        randomness_account,
        pst_token_program: anchor_spl::token::ID,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::HarvestYieldAndCommit {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_claim_redemption_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    inject_pending_redemption(&mut ctx.svm, 1, 0, ctx.user.pubkey(), 1_000_000, 1_000_000);

    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimRedemption {
        caller: ctx.user.pubkey(),
        beneficiary: ctx.user.pubkey(),
        pool: pool_pda_addr,
        pending_redemption,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        beneficiary_token_account: ctx.user_usdc_account,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: spoofed_huma_state, // Spoofed!
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

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimRedemption {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

#[test]
fn test_initialize_huma_lender_rejects_spoofed_huma_state() {
    let mut ctx = setup_e2e();
    let spoofed_huma_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut ctx.svm, spoofed_huma_state);

    let (global_config, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeHumaLender {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_addr,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: spoofed_huma_state, // Spoofed!
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

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeHumaLender {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolState);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEC-03: Unified Full Liabilities Solvency Guards
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_sell_bonds_fails_when_huma_sub_par() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();
    // Buy 10 bonds = 10 USDC = 10,000,000 lamports
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Make Huma sub-par: assets = 9,000,000, supply = 10,000,000 (value drops to 9 USDC < 10 USDC book liabilities)
    // ModeState vec_len = 1 at 26..30, assets at 30..46
    let mut data = ctx.svm.get_account(&ctx.huma_pool_state).unwrap().data;
    data[30..46].copy_from_slice(&9_000_000u128.to_le_bytes());
    ctx.svm
        .set_account(
            ctx.huma_pool_state,
            Account {
                lamports: 1_000_000_000,
                data,
                owner: huma_program_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Set pst_mint supply = 10_000_000
    let mut pst_data = ctx.svm.get_account(&ctx.pst_mint).unwrap().data;
    pst_data[36..44].copy_from_slice(&10_000_000u64.to_le_bytes());
    ctx.svm
        .set_account(
            ctx.pst_mint,
            Account {
                lamports: 1_000_000_000,
                data: pst_data,
                owner: anchor_spl::token::ID,
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 5,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);
}

#[test]
fn test_sell_bonds_fails_when_committed_yield_exceeds_vault() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Increase total_prizes_allocated on pool to 50,000,000 (total book liabilities = 10M principal + 50M prizes = 60M)
    // While pool vault only has 10M PST
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_prizes_allocated = 50_000_000;

    let mut data = vec![];
    data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 5,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);
}

#[test]
fn test_claim_winnings_fails_when_insolvent() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Pre-fund user with 10,000 USDC ($10,000 in 6 decimals = 10_000_000_000 base units)
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.user_usdc_account,
        &ctx.usdc_mint_authority,
        10_000_000_000,
    );

    // Buy 10,000 bonds = 10,000 USDC (10_000_000_000 base units)
    send_e2e_buy_bonds(&mut ctx, 10_000).unwrap();

    // Set up user_winnings with 5_000_000_000 unclaimed winnings and pool with 5_000_000_000 total_prizes_allocated
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_prizes_allocated = 5_000_000_000;
    // Total liabilities = 10_000_000_000 principal + 5_000_000_000 allocated = 15_000_000_000

    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (user_winnings_addr, _) = user_winnings_pda(1, &ctx.user.pubkey());
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 5_000_000_000, 0, 0);

    // Impair Huma assets to 8,000_000_000 (less than 15,000_000_000 book liabilities) with 10_000_000_000 PST supply
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        8_000_000_000,
        10_000_000_000,
    );

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: ctx.user.pubkey(),
        pool: pool_pda_addr,
        user_winnings: user_winnings_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Verify user unclaimed balance remains untouched
    let unwrapped_user_winnings = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(
        unwrapped_user_winnings.unclaimed_non_reinvested_winnings,
        5_000_000_000
    );
}

#[test]
fn test_withdraw_fees_fails_when_insolvent() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Pre-fund user with 50,000 USDC ($50,000 in 6 decimals = 50_000_000_000 base units)
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.user_usdc_account,
        &ctx.usdc_mint_authority,
        50_000_000_000,
    );

    // Buy 50,000 bonds = 50,000 USDC (50_000_000_000 base units)
    send_e2e_buy_bonds(&mut ctx, 50_000).unwrap();

    // Set accrued fees = 2,000_000_000 on pool (total book liabilities = 50B principal + 2B fees = 52B)
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 2_000_000_000;
    pool.total_fees_withdrawn = 0;

    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Impair Huma assets to 40,000_000_000 (below 52,000_000_000 book liabilities) with 50_000_000_000 PST supply
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        40_000_000_000,
        50_000_000_000,
    );

    let (global_config, _) = global_config_pda();
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);

    let accounts = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
        token_mint: ctx.usdc_mint,
        fee_wallet: pool.fee_wallet,
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
        data: anchor::instruction::WithdrawFees {
            amount: 1_000_000_000,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Verify pool total_fees_withdrawn remains 0
    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(updated_pool.total_fees_withdrawn, 0);
}

#[test]
fn test_solvency_dust_tolerance_boundary() {
    let pool = anchor::PrizePool {
        total_deposited_principal: 10_000_000,
        total_fees_accrued: 1_000_000,
        total_fees_withdrawn: 0,
        total_prizes_allocated: 5_000_000,
        ..unsafe { std::mem::zeroed() }
    };
    // Book value = 10M + 1M + 5M = 16,000,000

    // Deficit of 1,000 lamports (current_value = 15,999,000) -> within SOLVENCY_DUST_TOLERANCE -> OK
    assert!(pool.assert_solvent(16_000_000 - 1_000).is_ok());

    // Deficit of 1,001 lamports (current_value = 15,998,999) -> exceeds tolerance -> error
    assert_eq!(
        pool.assert_solvent(16_000_000 - 1_001).unwrap_err(),
        PremiumBondsError::YieldVenueInsolvent.into()
    );
}

#[test]
fn test_sell_bonds_pre_mutation_ordering() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let initial_pool = read_pool_state(&ctx.svm, 1);
    let initial_principal = initial_pool.total_deposited_principal;

    // Force insolvency by setting sub-par assets in Huma
    let mut data = ctx.svm.get_account(&ctx.huma_pool_state).unwrap().data;
    data[30..46].copy_from_slice(&5_000_000u128.to_le_bytes()); // half value
    ctx.svm
        .set_account(
            ctx.huma_pool_state,
            Account {
                lamports: 1_000_000_000,
                data,
                owner: huma_program_id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 5,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Verify on-chain state remained 100% untouched
    let post_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(post_pool.total_deposited_principal, initial_principal);
}

// ═══════════════════════════════════════════════════════════════════════════
// SEC-05: Token Extension Whitelist Filter Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_create_pool_rejects_transfer_fee_mint() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let fee_mint = Keypair::new().pubkey();
    inject_token_2022_mint(
        &mut svm,
        fee_mint,
        6,
        Some(ExtensionType::TransferFeeConfig),
    );

    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_2022_account(&mut svm, fee_wallet, fee_mint, admin.pubkey(), 0);

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

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        fee_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token_2022::ID,
        anchor_spl::token::ID,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::TransferFeeNotSupported);
}

#[test]
fn test_create_pool_rejects_transfer_hook_mint() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let hook_mint = Keypair::new().pubkey();
    inject_token_2022_mint(&mut svm, hook_mint, 6, Some(ExtensionType::TransferHook));

    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_2022_account(&mut svm, fee_wallet, hook_mint, admin.pubkey(), 0);

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

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        hook_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token_2022::ID,
        anchor_spl::token::ID,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::TransferHookNotSupported);
}

#[test]
fn test_create_pool_rejects_permanent_delegate_mint() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let perm_mint = Keypair::new().pubkey();
    inject_token_2022_mint(
        &mut svm,
        perm_mint,
        6,
        Some(ExtensionType::PermanentDelegate),
    );

    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_2022_account(&mut svm, fee_wallet, perm_mint, admin.pubkey(), 0);

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

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        perm_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token_2022::ID,
        anchor_spl::token::ID,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidTokenMint);
}

#[test]
fn test_create_pool_rejects_mint_close_authority_mint() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let close_mint = Keypair::new().pubkey();
    inject_token_2022_mint(
        &mut svm,
        close_mint,
        6,
        Some(ExtensionType::MintCloseAuthority),
    );

    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_2022_account(&mut svm, fee_wallet, close_mint, admin.pubkey(), 0);

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

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        close_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token_2022::ID,
        anchor_spl::token::ID,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidTokenMint);
}

#[test]
fn test_create_pool_rejects_uninitialized_huma_pool_state() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;

    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, token_mint, 6);
    inject_mint(&mut svm, pst_mint, 6);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, token_mint, admin.pubkey(), 0);

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

    // Huma pool state owned by Huma program but uninitialized / empty data (vec_len = 0)
    let bad_huma_state = Keypair::new().pubkey();
    svm.set_account(
        bad_huma_state,
        Account {
            lamports: 1_000_000_000,
            data: vec![0u8; 100], // vec_len at offset 26 is 0
            owner: huma_program_id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let ix = build_create_pool_instruction(
        &admin,
        pool_id,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        token_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        bad_huma_state,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidHumaPoolData);
}

#[test]
fn test_create_pool_accepts_standard_spl_and_token_2022() {
    let (mut svm, admin) = setup_global_config();

    // 1. Standard SPL mint
    let usdc_mint = Keypair::new().pubkey();
    inject_mint(&mut svm, usdc_mint, 6);

    // 2. Clean Token-2022 mint without forbidden extensions
    let pst_mint = Keypair::new().pubkey();
    inject_token_2022_mint(&mut svm, pst_mint, 6, None);

    let fee_wallet = Keypair::new().pubkey();
    inject_token_account(&mut svm, fee_wallet, usdc_mint, admin.pubkey(), 0);

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

    let huma_pool_state = Keypair::new().pubkey();
    inject_huma_pool_state(&mut svm, huma_pool_state);

    let ix = build_create_pool_instruction_with_programs(
        &admin,
        1,
        1_000_000,
        24,
        100,
        0,
        0,
        300,
        default_prize_tiers(),
        usdc_mint,
        pst_mint,
        ticket_registry,
        fee_wallet,
        huma_pool_state,
        anchor_spl::token::ID,
        anchor_spl::token_2022::ID,
    );

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();
    let res = svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "Clean Token-2022 and SPL mints should succeed: {res:?}"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// FORMAL 7-VECTOR EFFICIENCY, SOLVENCY & REALLOC INVARIANT TEST MATRIX
// ═══════════════════════════════════════════════════════════════════════════

// ─── Vector 1: Value & Boundary Extremes ───────────────────────────────────

#[test]
fn test_v1_sell_bonds_rejects_zero_quantity() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 0,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidBondQuantity);
}

#[test]
fn test_v1_sell_bonds_dust_single_bond() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // Sell exactly 1 dust bond (pending)
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .expect("Dust bond sale should succeed");

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 9_000_000);
    assert_eq!(pool.total_pending_redemptions, 1_000_000);
    assert_eq!(pool.next_redemption_id, 1);

    let pending = read_pending_redemption(&ctx.svm, 1, 0);
    assert_eq!(pending.amount, 1_000_000);
    assert_eq!(pending.user, user_a.pubkey());
}

#[test]
fn test_v1_registry_full_rejects_new_buyer_allows_existing_topup() {
    let mut ctx = setup_e2e();

    // Inject small registry with capacity = 2 for pool 1
    let small_registry = Keypair::new().pubkey();
    let reg_space = 8
        + std::mem::size_of::<anchor::state::TicketRegistry>()
        + 2 * std::mem::size_of::<anchor::state::UserEntry>();
    let mut reg_data = vec![0u8; reg_space];
    reg_data[0..8].copy_from_slice(&anchor::state::TicketRegistry::DISCRIMINATOR);
    let header = bytemuck::from_bytes_mut::<anchor::state::TicketRegistry>(
        &mut reg_data[8..8 + std::mem::size_of::<anchor::state::TicketRegistry>()],
    );
    header.pool_id = 1;
    header.capacity = 2;
    header.user_count = 0;
    header.version = anchor::state::TicketRegistry::CURRENT_VERSION;
    ctx.svm
        .set_account(
            small_registry,
            Account {
                lamports: 10_000_000_000,
                data: reg_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Update pool.ticket_registry = small_registry
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.ticket_registry = small_registry;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();
    ctx.ticket_registry = small_registry;

    // Helper to buy bonds for a user
    let buy_for_user = |ctx: &mut E2eContext, user: &Keypair, tickets: u32| {
        ctx.svm.expire_blockhash();
        let user_token =
            create_spl_token_account(&mut ctx.svm, &ctx.admin, &ctx.usdc_mint, &user.pubkey());
        mint_tokens(
            &mut ctx.svm,
            &ctx.admin,
            &ctx.usdc_mint,
            &user_token,
            &ctx.usdc_mint_authority,
            (tickets as u64) * 1_000_000,
        );

        let (pool_pda_addr, _) = pool_pda(1);
        let (pool_vault, _) = pool_vault_pda(1);
        let (pool_pst_vault, _) = pool_pst_vault_pda(1);
        let (user_winnings, _) = user_winnings_pda(1, &user.pubkey());
        let dummy = Keypair::new().pubkey();

        let accounts = anchor::accounts::BuyBonds {
            user: user.pubkey(),
            user_winnings,
            pool: pool_pda_addr,
            ticket_registry: ctx.ticket_registry,
            user_token_account: user_token,
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
            data: anchor::instruction::BuyBonds {
                tickets_to_buy: tickets,
            }
            .data(),
        };
        let bh = ctx.svm.latest_blockhash();
        let msg = Message::new_with_blockhash(&[ix], Some(&user.pubkey()), &bh);
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[user]).unwrap();
        ctx.svm.send_transaction(tx)
    };

    let user_1 = Keypair::new();
    let user_2 = Keypair::new();
    let user_3 = Keypair::new();
    ctx.svm.airdrop(&user_1.pubkey(), 10_000_000_000).unwrap();
    ctx.svm.airdrop(&user_2.pubkey(), 10_000_000_000).unwrap();
    ctx.svm.airdrop(&user_3.pubkey(), 10_000_000_000).unwrap();

    // User 1 fills slot 0
    assert!(buy_for_user(&mut ctx, &user_1, 5).is_ok());
    assert_eq!(read_registry_user_count(&ctx.svm, ctx.ticket_registry), 1);

    // User 2 fills slot 1 (registry is now at capacity 2)
    assert!(buy_for_user(&mut ctx, &user_2, 3).is_ok());
    assert_eq!(read_registry_user_count(&ctx.svm, ctx.ticket_registry), 2);

    // User 3 (new user needing slot) must be rejected with RegistryFull
    let res_user_3 = buy_for_user(&mut ctx, &user_3, 1);
    assert_custom_error(res_user_3, PremiumBondsError::RegistryFull);

    // Existing User 1 (already assigned slot 0) must succeed on top-up
    let res_user_1_topup = buy_for_user(&mut ctx, &user_1, 2);
    assert!(
        res_user_1_topup.is_ok(),
        "Existing user top-up should succeed even at full capacity"
    );
    let entry_1 = read_registry_entry(&ctx.svm, ctx.ticket_registry, 0);
    assert_eq!(entry_1.pending, 7); // 5 + 2
    assert_eq!(read_registry_user_count(&ctx.svm, ctx.ticket_registry), 2);
}

// ─── Vector 2: State Lifecycle & Fail-Fast ─────────────────────────────────

#[test]
fn test_v2_sell_bonds_fail_fast_on_paused_pool_with_spoofed_huma() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Pause the pool
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.status = anchor::PoolStatus::Paused as u8;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Pass valid huma_pool_state matching pool.huma_pool_state, but pool is paused so must fail fast with PoolPaused
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 1,
            pending_to_sell: 0,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

#[test]
fn test_v2_claim_winnings_fail_fast_on_frozen_pool() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // Inject claimable winnings for user
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 1_000_000, 0, 0);

    // Freeze pool for draw
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.is_frozen_for_draw = 1;
    pool.total_prizes_allocated = 1_000_000;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: ctx.user.pubkey(),
        pool: pool_pda_addr,
        user_winnings,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::AwaitingRandomnessFreeze);
}

#[test]
fn test_v2_withdraw_fees_fail_fast_on_paused_pool() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let fee_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    // Pause pool and set accrued fees
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.status = anchor::PoolStatus::Paused as u8;
    pool.total_fees_accrued = 1_000_000;
    pool.fee_wallet = fee_wallet;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let (global_config, _) = global_config_pda();
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);

    let accounts = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_addr,
        fee_wallet,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::WithdrawFees { amount: 500_000 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::PoolPaused);
}

// ─── Vector 3: Access Control & Impersonation ──────────────────────────────

#[test]
fn test_v3_sell_bonds_rejects_unauthorized_user_entry_owner() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    // User A buys bonds (assigned slot 0)
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Attacker User B creates user_winnings pointing to slot 0 (User A's slot)
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    inject_user_winnings_with_index(&mut ctx.svm, 1, attacker.pubkey(), 0, 0, 0, 0); // entry_index = 0

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (attacker_winnings, _) = user_winnings_pda(1, &attacker.pubkey());

    let accounts = anchor::accounts::SellBonds {
        user: attacker.pubkey(),
        user_winnings: attacker_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 0,
            pending_to_sell: 5,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::InvalidUserEntryHint);
}

#[test]
fn test_v3_withdraw_fees_rejects_unauthorized_signer() {
    let mut ctx = setup_e2e();
    let attacker = Keypair::new();
    ctx.svm.airdrop(&attacker.pubkey(), 10_000_000_000).unwrap();
    let dummy = Keypair::new().pubkey();

    let (global_config, _) = global_config_pda();
    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);

    let accounts = anchor::accounts::WithdrawFees {
        admin: attacker.pubkey(), // Attacker tries to act as admin
        global_config,
        pool: pool_pda_addr,
        fee_wallet: attacker.pubkey(),
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::WithdrawFees { amount: 100_000 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&attacker.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&attacker]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert!(res.is_err(), "Non-admin signer must be rejected");
}

// ─── Vector 4: Financial Math & Zero-Mutation Invariance ───────────────────

#[test]
fn test_v4_sell_bonds_solvency_failure_preserves_liabilities() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let initial_pool = read_pool_state(&ctx.svm, 1);
    let initial_principal = initial_pool.total_deposited_principal;
    let initial_active = read_registry_active(&ctx.svm, ctx.ticket_registry);
    let initial_pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);
    let initial_entry = read_registry_entry(&ctx.svm, ctx.ticket_registry, 0);

    // Impair Huma solvency
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        5_000_000,
        10_000_000,
    );

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::SellBonds {
        user: ctx.user.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::SellBonds {
            active_to_sell: 0,
            pending_to_sell: 5,
        }
        .data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Assert 100% untouched state
    let post_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(post_pool.total_deposited_principal, initial_principal);
    assert_eq!(
        read_registry_active(&ctx.svm, ctx.ticket_registry),
        initial_active
    );
    assert_eq!(
        read_registry_pending(&ctx.svm, ctx.ticket_registry),
        initial_pending
    );
    let post_entry = read_registry_entry(&ctx.svm, ctx.ticket_registry, 0);
    assert_eq!(post_entry.active, initial_entry.active);
    assert_eq!(post_entry.pending, initial_entry.pending);
}

#[test]
fn test_v4_claim_winnings_solvency_failure_preserves_liabilities() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Set up 5,000,000 allocated prizes
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_prizes_allocated = 5_000_000;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 5_000_000, 0, 0);

    // Impair Huma assets (sub-par)
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        8_000_000,
        10_000_000,
    );

    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings, _) = user_winnings_pda(1, &ctx.user.pubkey());

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: ctx.user.pubkey(),
        pool: pool_pda_addr,
        user_winnings,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Assert liabilities and user winnings 100% unchanged
    let post_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(post_pool.total_prizes_allocated, 5_000_000);
    assert_eq!(post_pool.total_pending_redemptions, 0);
    let post_winnings = read_user_winnings_state(&ctx.svm, 1, &ctx.user.pubkey());
    assert_eq!(post_winnings.unclaimed_non_reinvested_winnings, 5_000_000);
    assert_eq!(post_winnings.total_claimed, 0);
}

#[test]
fn test_v4_withdraw_fees_solvency_failure_preserves_liabilities() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let fee_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    // Accrue 2,000,000 fees in pool
    let (pool_pda_addr, _) = pool_pda(1);
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_fees_accrued = 2_000_000;
    pool.fee_wallet = fee_wallet;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Impair Huma solvency
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        1_000_000,
        10_000_000,
    );

    let (global_config, _) = global_config_pda();
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);

    let accounts = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_addr,
        fee_wallet,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
        huma_lender_state: dummy,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_mode_token: Keypair::new().pubkey(),
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
        data: anchor::instruction::WithdrawFees { amount: 1_000_000 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::YieldVenueInsolvent);

    // Assert fees withdrawn and pending redemptions 100% unchanged
    let post_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(post_pool.total_fees_withdrawn, 0);
    assert_eq!(post_pool.total_pending_redemptions, 0);
}

// ─── Vector 5: Account Closure & Realloc Safety ────────────────────────────

#[test]
fn test_v5_pending_redemption_exact_rent_refund_and_closure() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Fund underlying token vault for disburse
    mint_tokens(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.huma_pool_underlying_token,
        &ctx.usdc_mint_authority,
        10_000_000,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // Sell 3 bonds -> creates PendingRedemption 0
    send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    )
    .unwrap();

    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    let pending_acc = ctx
        .svm
        .get_account(&pending_redemption_key)
        .expect("PendingRedemption must exist");
    // Verify exact 160 bytes layout (8-byte discriminator + 152-byte INIT_SPACE)
    assert_eq!(
        pending_acc.data.len(),
        8 + anchor::state::PendingRedemption::INIT_SPACE,
        "PendingRedemption must be exactly 160 bytes"
    );
    let rent_lamports = pending_acc.lamports;

    // Settle Huma redemption
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 3_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    let user_balance_before = ctx.svm.get_account(&user_a.pubkey()).unwrap().lamports;

    // Claim redemption
    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::ClaimRedemption {
        caller: user_a.pubkey(),
        beneficiary: user_a.pubkey(),
        pool: pool_pda_addr,
        pending_redemption: pending_redemption_key,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        beneficiary_token_account: ctx.user_usdc_account,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_lender_state,
        huma_pool_authority: ctx.huma_pool_authority,
        huma_pool_underlying_token: ctx.huma_pool_underlying_token,
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

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user_a.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user_a]).unwrap();
    ctx.svm
        .send_transaction(tx)
        .expect("claim redemption should succeed");

    // PendingRedemption must be closed (account is None)
    assert!(ctx.svm.get_account(&pending_redemption_key).is_none());

    // User's SOL balance must increase by rent refunded minus tx fee (5000 lamports)
    let user_balance_after = ctx.svm.get_account(&user_a.pubkey()).unwrap().lamports;
    assert_eq!(
        user_balance_after + 5000 - user_balance_before,
        rent_lamports
    );
}

#[test]
fn test_v5_ticket_registry_trailing_bytes_rejected() {
    let mut ctx = setup_e2e();
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    // Corrupt ticket registry account data by appending 1 trailing byte
    let mut reg_acc = ctx.svm.get_account(&ctx.ticket_registry).unwrap();
    reg_acc.data.push(0xAA);
    ctx.svm.set_account(ctx.ticket_registry, reg_acc).unwrap();

    // Attempt sell_bonds -> must fail with InvalidRegistryState
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );
    let user_a = clone_keypair(&ctx.user);
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        1,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert_custom_error(res, anchor::error::PremiumBondsError::InvalidRegistryState);
}

// ─── Vector 6: Time & Sysvar Boundaries ────────────────────────────────────

#[test]
fn test_v6_reinvest_winnings_enforces_payout_timelock() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let token_mint = Keypair::new().pubkey();
    let pst_mint = Keypair::new().pubkey();
    let crank = Keypair::new();
    let winner = Keypair::new();
    svm.airdrop(&crank.pubkey(), 10_000_000_000).unwrap();

    inject_mint(&mut svm, token_mint, 6);
    inject_token_2022_mint(&mut svm, pst_mint, 6, None);

    let ticket_registry = Keypair::new().pubkey();
    let mut reg_data = vec![0u8; anchor::constants::REGISTRY_INITIAL_SIZE];
    reg_data[0..8].copy_from_slice(&anchor::state::TicketRegistry::DISCRIMINATOR);
    let header = bytemuck::from_bytes_mut::<anchor::state::TicketRegistry>(
        &mut reg_data[8..8 + std::mem::size_of::<anchor::state::TicketRegistry>()],
    );
    header.pool_id = pool_id;
    header.capacity = 100;
    header.user_count = 1;
    header.total_active_tickets = 10;
    header.version = anchor::state::TicketRegistry::CURRENT_VERSION;

    let entry_offset = 8 + std::mem::size_of::<anchor::state::TicketRegistry>();
    let entry = bytemuck::from_bytes_mut::<anchor::state::UserEntry>(
        &mut reg_data[entry_offset..entry_offset + std::mem::size_of::<anchor::state::UserEntry>()],
    );
    entry.owner = winner.pubkey();
    entry.active = 10;
    entry.pending = 0;

    svm.set_account(
        ticket_registry,
        Account {
            lamports: 10_000_000_000,
            data: reg_data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let (pool_pda_addr, _) = pool_pda(pool_id);
    let (user_winnings, _) = user_winnings_pda(pool_id, &winner.pubkey());
    let (payout_reg, _) = payout_pda(pool_id, 0);

    // Initialize pool with 3600 seconds payout timelock
    inject_pool(
        &mut svm,
        pool_id,
        token_mint,
        ticket_registry,
        anchor::PoolStatus::Active,
        false,
    );
    {
        let mut acc = svm.get_account(&pool_pda_addr).unwrap();
        let pool = bytemuck::from_bytes_mut::<anchor::PrizePool>(&mut acc.data[8..]);
        pool.total_prizes_allocated = 10_000_000;
        pool.payout_timelock_seconds = 3600;
        svm.set_account(pool_pda_addr, acc).unwrap();
    }

    // Initialize completed draw cycle completed at timestamp 1000
    let mut dc = default_draw_cycle(pool_id, 0, anchor::DrawStatus::Complete);
    dc.completed_at = 1000;
    inject_draw_cycle(&mut svm, pool_id, 0, &dc);

    let winner_entry = anchor::Winner {
        winner: winner.pubkey(),
        amount_owed: 1_000_000,
        bonds_bought: 0,
        processed: 0,
        tier_index: 0,
        version: anchor::Winner::CURRENT_VERSION,
        _padding: [0; 1],
        _reserved: [0; 8],
    };
    inject_payout_registry(
        &mut svm,
        pool_id,
        0,
        vec![winner_entry],
        0,
        anchor::PayoutRegistryStatus::Active,
    );
    inject_user_winnings_with_index(&mut svm, pool_id, winner.pubkey(), 0, 0, 0, 0);

    let build_reinvest_ix = |payout_reg: Pubkey, user_winnings: Pubkey| {
        let accounts = anchor::accounts::ReinvestWinnings {
            crank: crank.pubkey(),
            winner: winner.pubkey(),
            payout_registry: payout_reg,
            pool: pool_pda_addr,
            user_winnings,
            ticket_registry,
            system_program: anchor_lang::system_program::ID,
            event_authority: event_authority_pda(),
            program: anchor::id(),
        }
        .to_account_metas(None);

        Instruction {
            program_id: anchor::id(),
            accounts,
            data: anchor::instruction::ReinvestWinnings {
                cycle_id: 0,
                winner_index: 0,
            }
            .data(),
        }
    };

    // 1. Clock timestamp = 1_700_002_000 (< 1_700_000_000 + 3600 = 1_700_003_600) -> fails with PayoutTimelockActive
    set_clock_timestamp(&mut svm, 1_700_002_000);

    let ix = build_reinvest_ix(payout_reg, user_winnings);
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&crank.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&crank]).unwrap();
    let res = svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::PayoutTimelockActive);

    // 2. Advance clock timestamp to 1_700_003_601 (>= 1_700_003_600) -> succeeds!
    let crank2 = Keypair::new();
    svm.airdrop(&crank2.pubkey(), 10_000_000_000).unwrap();
    set_clock_timestamp(&mut svm, 1_700_003_601);

    let accounts2 = anchor::accounts::ReinvestWinnings {
        crank: crank2.pubkey(),
        winner: winner.pubkey(),
        payout_registry: payout_reg,
        pool: pool_pda_addr,
        user_winnings,
        ticket_registry,
        system_program: anchor_lang::system_program::ID,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    let ix2 = Instruction {
        program_id: anchor::id(),
        accounts: accounts2,
        data: anchor::instruction::ReinvestWinnings {
            cycle_id: 0,
            winner_index: 0,
        }
        .data(),
    };
    let bh2 = svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix2], Some(&crank2.pubkey()), &bh2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&crank2]).unwrap();
    let res2 = svm.send_transaction(tx2);
    assert!(
        res2.is_ok(),
        "Reinvesting after timelock expiration must succeed: {res2:?}"
    );
}

// ─── Vector 7: CPI & Reentrancy Rollback Atomicity ─────────────────────────

#[test]
fn test_v7_sell_bonds_huma_cpi_failure_atomic_rollback() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    send_e2e_buy_bonds(&mut ctx, 10).unwrap();

    let initial_pool = read_pool_state(&ctx.svm, 1);
    let initial_principal = initial_pool.total_deposited_principal;
    let initial_redemption_id = initial_pool.next_redemption_id;
    let initial_pending = read_registry_pending(&ctx.svm, ctx.ticket_registry);

    let user_a = clone_keypair(&ctx.user);

    // Attempt to sell bonds passing FAIL_REDEMPTION_PUBKEY to trigger simulated Huma CPI failure
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        3,
        FAIL_REDEMPTION_PUBKEY,
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert_error_contains(res, &["SimulatedRedemptionFailure"]);

    // Verify all on-chain states were atomically rolled back by the runtime
    let post_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(
        post_pool.total_deposited_principal, initial_principal,
        "Principal must not be decremented on CPI failure"
    );
    assert_eq!(
        post_pool.next_redemption_id, initial_redemption_id,
        "next_redemption_id must not be incremented on CPI failure"
    );
    assert_eq!(
        read_registry_pending(&ctx.svm, ctx.ticket_registry),
        initial_pending,
        "Tickets must not be debited on CPI failure"
    );

    let (pending_redemption_key, _) = pending_redemption_pda(1, 0);
    assert!(
        ctx.svm.get_account(&pending_redemption_key).is_none(),
        "PendingRedemption account must not exist on CPI failure"
    );
}

#[test]
fn test_v4_buy_bonds_zero_share_inflation_guard() {
    let mut ctx = setup_e2e();
    let initial_vault_amount = read_token_balance(&ctx.svm, pool_pst_vault_pda(1).0);
    assert_eq!(initial_vault_amount, 0);

    let user_a = clone_keypair(&ctx.user);
    let user_token_account = ctx.user_usdc_account;

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_vault, _) = pool_vault_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (user_winnings, _) = user_winnings_pda(1, &user_a.pubkey());
    let dummy = Keypair::new().pubkey();

    let accounts = anchor::accounts::BuyBonds {
        user: user_a.pubkey(),
        user_winnings,
        pool: pool_pda_addr,
        ticket_registry: ctx.ticket_registry,
        user_token_account,
        token_mint: ctx.usdc_mint,
        pool_vault_account: pool_vault,
        pool_pst_vault,
        huma_program: huma_program_id(),
        huma_config: FAIL_ZERO_SHARES_PUBKEY,
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
        data: anchor::instruction::BuyBonds { tickets_to_buy: 10 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&user_a.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&user_a]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert_custom_error(res, PremiumBondsError::ZeroSharesMinted);

    let post_vault_amount = read_token_balance(&ctx.svm, pool_pst_vault_pda(1).0);
    assert_eq!(
        post_vault_amount, 0,
        "Vault PST balance must remain 0 when zero shares minted error is thrown"
    );

    // Normal deposit succeeds
    let ok_res = send_e2e_buy_bonds(&mut ctx, 10);
    assert!(ok_res.is_ok(), "Normal buy_bonds must succeed: {ok_res:?}");

    let final_vault_amount = read_token_balance(&ctx.svm, pool_pst_vault_pda(1).0);
    assert_eq!(
        final_vault_amount, 10_000_000,
        "10 bonds = 10,000,000 PST shares"
    );

    // ZeroSharesMinted error definition and code verification
    let err = PremiumBondsError::ZeroSharesMinted;
    assert_eq!(format!("{err:?}"), "ZeroSharesMinted");
    assert_eq!((err as u32) + anchor_lang::error::ERROR_CODE_OFFSET, 6046);
}

#[test]
fn test_v4_terminal_share_clamping_all_exits() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // Buy 10 bonds = 10 USDC = 10_000_000 base units
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // Terminal sell: sell all 10 bonds -> pool.calculate_book_value() becomes 0
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        10,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert!(
        res.is_ok(),
        "Terminal bond sale with book value 0 must clamp shares and succeed: {res:?}"
    );

    let pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(pool.total_deposited_principal, 0);
    assert_eq!(pool.calculate_book_value().unwrap(), 0);
}

#[test]
fn test_v4_terminal_share_clamping_withdraw_fees() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    let fee_wallet = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.usdc_mint,
        &ctx.admin.pubkey(),
    );

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);

    // Set pool state to 0 principal, 0 prizes allocated, 5 USDC accrued fees
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_deposited_principal = 0;
    pool.total_prizes_allocated = 0;
    pool.total_fees_accrued = 5_000_000;
    pool.total_fees_withdrawn = 0;
    pool.fee_wallet = fee_wallet;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Inject pool_pst_vault with 5_000_000 PST tokens
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_addr,
        5_000_000,
    );

    // Set 1:1 Huma solvency
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        5_000_000,
        5_000_000,
    );

    let (global_config, _) = global_config_pda();
    let accounts = anchor::accounts::WithdrawFees {
        admin: ctx.admin.pubkey(),
        global_config,
        pool: pool_pda_addr,
        fee_wallet,
        token_mint: ctx.usdc_mint,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
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

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::WithdrawFees { amount: 5_000_000 }.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.admin]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "Terminal fee withdrawal with book value 0 must clamp shares and succeed: {res:?}"
    );

    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(updated_pool.total_fees_withdrawn, 5_000_000);
    assert_eq!(updated_pool.calculate_book_value().unwrap(), 0);
}

#[test]
fn test_v4_terminal_share_clamping_claim_non_reinvested_winnings() {
    let mut ctx = setup_e2e();
    let dummy = Keypair::new().pubkey();

    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    let (pool_pda_addr, _) = pool_pda(1);
    let (pool_pst_vault, _) = pool_pst_vault_pda(1);
    let (pending_redemption, _) = pending_redemption_pda(1, 0);
    let (user_winnings_addr, _) = user_winnings_pda(1, &ctx.user.pubkey());

    // Pool has 0 principal, 0 fees, 3 USDC prizes allocated (unawarded remainder/winnings)
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.total_deposited_principal = 0;
    pool.total_fees_accrued = 0;
    pool.total_fees_withdrawn = 0;
    pool.total_prizes_allocated = 3_000_000;
    let mut pool_data = vec![];
    pool_data.extend_from_slice(&anchor::PrizePool::DISCRIMINATOR);
    pool_data.extend_from_slice(bytemuck::bytes_of(&pool));
    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 10_000_000,
                data: pool_data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    // Set user winnings to 3 USDC unclaimed
    inject_user_winnings(&mut ctx.svm, 1, ctx.user.pubkey(), 3_000_000, 0, 0);

    // Inject pool_pst_vault with 3_000_000 PST tokens
    inject_token_account(
        &mut ctx.svm,
        pool_pst_vault,
        ctx.pst_mint,
        pool_pda_addr,
        3_000_000,
    );

    // Set 1:1 Huma solvency
    set_huma_solvency_state(
        &mut ctx.svm,
        ctx.huma_pool_state,
        ctx.pst_mint,
        3_000_000,
        3_000_000,
    );

    let accounts = anchor::accounts::ClaimNonReinvestedWinnings {
        user: ctx.user.pubkey(),
        pool: pool_pda_addr,
        user_winnings: user_winnings_addr,
        pool_pst_vault,
        pending_redemption,
        huma_program: huma_program_id(),
        huma_config: dummy,
        huma_pool_config: dummy,
        huma_pool_state: ctx.huma_pool_state,
        huma_mode_config: dummy,
        huma_mode_mint: ctx.pst_mint,
        huma_redemption_request: Keypair::new().pubkey(),
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

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::ClaimNonReinvestedWinnings {}.data(),
    };

    let bh = ctx.svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&ctx.user.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&ctx.user]).unwrap();
    let res = ctx.svm.send_transaction(tx);
    assert!(
        res.is_ok(),
        "Terminal prize winnings claim with book value 0 must clamp shares and succeed: {res:?}"
    );

    let updated_pool = read_pool_state(&ctx.svm, 1);
    assert_eq!(updated_pool.total_prizes_allocated, 0);
    assert_eq!(updated_pool.calculate_book_value().unwrap(), 0);
}

#[test]
fn test_v4_terminal_dust_clamping_claim_redemption() {
    let mut ctx = setup_e2e();
    let huma_pool_mode_token = create_spl_token_account(
        &mut ctx.svm,
        &ctx.admin,
        &ctx.pst_mint,
        &ctx.huma_pool_authority,
    );

    // 1. Buy 10 bonds
    send_e2e_buy_bonds(&mut ctx, 10).unwrap();
    let user_a = clone_keypair(&ctx.user);

    // 2. Sell 10 bonds to create PendingRedemption for 10_000_000 USDC
    let res = send_e2e_sell_bonds_for_user(
        &mut ctx,
        &user_a,
        0,
        10,
        Pubkey::default(),
        Pubkey::default(),
        huma_pool_mode_token,
    );
    assert!(res.is_ok(), "Sell bonds should succeed: {res:?}");

    // 3. Settle Huma redemption
    let huma_lender_state = Keypair::new().pubkey();
    inject_lender_state(&mut ctx.svm, huma_lender_state, 10_000_000);
    settle_huma_redemption(&mut ctx.svm, ctx.huma_pool_state, 1);

    // 4. Inject huma_pool_underlying_token with 1 unit LESS (9_999_999 instead of 10_000_000)
    // so disburse delivers 9_999_999 to pool_vault_account
    inject_token_account(
        &mut ctx.svm,
        ctx.huma_pool_underlying_token,
        ctx.usdc_mint,
        ctx.huma_pool_authority,
        9_999_999,
    );

    let user_a_usdc = ctx.user_usdc_account;
    let initial_user_balance = read_token_balance(&ctx.svm, user_a_usdc);

    let claim_res = send_e2e_claim_redemption_for_user(
        &mut ctx,
        &user_a,
        user_a_usdc,
        0,
        Pubkey::default(),
        huma_lender_state,
    );
    assert!(
        claim_res.is_ok(),
        "Claim redemption with 1 base unit deficit must clamp to available vault amount and succeed: {claim_res:?}"
    );

    let final_user_balance = read_token_balance(&ctx.svm, user_a_usdc);
    assert_eq!(
        final_user_balance,
        initial_user_balance + 9_999_999,
        "User should have received 9_999_999 USDC (clamped vault amount)"
    );

    let (pool_vault, _) = pool_vault_pda(1);
    let final_vault_balance = read_token_balance(&ctx.svm, pool_vault);
    assert_eq!(
        final_vault_balance, 0,
        "Pool vault should be completely drained"
    );
}

#[test]
fn test_v6_rebind_two_layer_anti_reroll_guard() {
    let mut ctx = setup_e2e();
    let pool_id = 1;
    let cycle_id = 0;
    let harvest_slot = 100;

    // Inject draw cycle awaiting randomness committed at harvest_slot 100
    let current_randomness = Keypair::new().pubkey();
    let mut dc = default_draw_cycle(pool_id, cycle_id, anchor::DrawStatus::AwaitingRandomness);
    dc.harvest_slot = harvest_slot;
    dc.randomness_account = current_randomness;
    inject_draw_cycle(&mut ctx.svm, pool_id, cycle_id, &dc);

    // Inject Switchboard randomness account with seed_slot = 1050 (requested after harvest)
    inject_randomness_account_data(&mut ctx.svm, current_randomness, 1050, 0, [0u8; 32]);

    let new_randomness = Keypair::new().pubkey();
    inject_mock_randomness_account(&mut ctx.svm, new_randomness);

    // Scenario 1: Clock slot = 1000.
    // clock.slot (1000) - harvest_slot (100) = 900 <= 1000 -> Fails Layer 1 (Macro window)
    ctx.svm.warp_to_slot(1000);
    let ix1 = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let bh1 = ctx.svm.latest_blockhash();
    let msg1 = Message::new_with_blockhash(&[ix1], Some(&ctx.admin.pubkey()), &bh1);
    let tx1 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg1), &[&ctx.admin]).unwrap();
    let res1 = ctx.svm.send_transaction(tx1);
    assert_custom_error(res1, PremiumBondsError::RandomnessNotExpired);

    // Scenario 2: Clock slot = 1200.
    // clock.slot (1200) - harvest_slot (100) = 1100 > 1000 (Passes Layer 1), BUT
    // clock.slot (1200) - seed_slot (1050) = 150 <= 1000 -> Fails Layer 2 (Micro anti-re-roll window!)
    ctx.svm.warp_to_slot(1200);
    ctx.svm.expire_blockhash();
    let ix2 = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let bh2 = ctx.svm.latest_blockhash();
    let msg2 = Message::new_with_blockhash(&[ix2], Some(&ctx.admin.pubkey()), &bh2);
    let tx2 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg2), &[&ctx.admin]).unwrap();
    let res2 = ctx.svm.send_transaction(tx2);
    assert_custom_error(res2, PremiumBondsError::RandomnessNotExpired);

    // Scenario 3: Clock slot = 2051.
    // clock.slot (2051) - harvest_slot (100) = 1951 > 1000 (Passes Layer 1) AND
    // clock.slot (2051) - seed_slot (1050) = 1001 > 1000 (Passes Layer 2) -> SUCCEEDS!
    ctx.svm.warp_to_slot(2051);
    ctx.svm.expire_blockhash();
    let ix3 = build_crank_rebind_instruction(
        &ctx.admin,
        pool_id,
        cycle_id,
        current_randomness,
        new_randomness,
    );
    let bh3 = ctx.svm.latest_blockhash();
    let msg3 = Message::new_with_blockhash(&[ix3], Some(&ctx.admin.pubkey()), &bh3);
    let tx3 = VersionedTransaction::try_new(VersionedMessage::Legacy(msg3), &[&ctx.admin]).unwrap();
    let res3 = ctx.svm.send_transaction(tx3);
    assert!(
        res3.is_ok(),
        "Two-layer expired randomness rebind must succeed: {res3:?}"
    );
}
