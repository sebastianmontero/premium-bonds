//! Comprehensive test suite for adversarial security hardening remediations:
//! - SEC-01: Huma State Pinning & Venue Integrity
//! - SEC-03: Unified Full Liabilities Solvency Guards & Anti-Bank Run Ordering
//! - SEC-05: Supported Mint Extensions Whitelist Filter
//!
//! Run with:
//!   NO_DNA=1 cargo test --test test_adversarial_remediation -- --nocapture

use {
    anchor::error::PremiumBondsError,
    anchor_lang::{Discriminator, InstructionData, ToAccountMetas},
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
// Helper Functions for Adversarial Testing
// ═══════════════════════════════════════════════════════════════════════════

fn inject_token_2022_mint(
    svm: &mut LiteSVM,
    mint: Pubkey,
    decimals: u8,
    extension: Option<ExtensionType>,
) {
    let space = if let Some(ext) = extension {
        ExtensionType::try_calculate_account_len::<
            anchor_spl::token_2022::spl_token_2022::state::Mint,
        >(&[ext])
        .unwrap()
    } else {
        82
    };

    let mut data = vec![0u8; space];
    if let Some(ext) = extension {
        let mut state = StateWithExtensionsMut::<anchor_spl::token_2022::spl_token_2022::state::Mint>::unpack_uninitialized(&mut data).unwrap();
        state.init_account_type().unwrap();
        match ext {
            ExtensionType::TransferFeeConfig => {
                let _ = state.init_extension::<anchor_spl::token_2022::spl_token_2022::extension::transfer_fee::TransferFeeConfig>(true);
            }
            ExtensionType::TransferHook => {
                let _ = state.init_extension::<anchor_spl::token_2022::spl_token_2022::extension::transfer_hook::TransferHook>(true);
            }
            ExtensionType::PermanentDelegate => {
                let _ = state.init_extension::<anchor_spl::token_2022::spl_token_2022::extension::permanent_delegate::PermanentDelegate>(true);
            }
            ExtensionType::MintCloseAuthority => {
                let _ = state.init_extension::<anchor_spl::token_2022::spl_token_2022::extension::mint_close_authority::MintCloseAuthority>(true);
            }
            _ => panic!("Unsupported test extension"),
        }
    }
    // Set standard mint header fields: is_initialized = true, decimals
    data[44] = decimals;
    data[45] = 1;

    svm.set_account(
        mint,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token_2022::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

fn inject_token_2022_account(
    svm: &mut LiteSVM,
    address: Pubkey,
    mint: Pubkey,
    owner: Pubkey,
    amount: u64,
) {
    use solana_program::program_pack::Pack;
    let token_state = anchor_spl::token::spl_token::state::Account {
        mint,
        owner,
        amount,
        delegate: solana_program::program_option::COption::None,
        state: anchor_spl::token::spl_token::state::AccountState::Initialized,
        is_native: solana_program::program_option::COption::None,
        delegated_amount: 0,
        close_authority: solana_program::program_option::COption::None,
    };
    let mut data = vec![0u8; anchor_spl::token::spl_token::state::Account::LEN];
    Pack::pack_into_slice(&token_state, &mut data);

    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token_2022::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}

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
