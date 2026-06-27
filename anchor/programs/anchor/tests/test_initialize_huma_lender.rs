//! Integration tests for the `initialize_huma_lender` instruction.
//!
//! Strategy
//! ─────────
//! Tests load compiled .so binaries for both our anchor program and the mock Huma program.
//! Using LiteSVM, we verify happy paths and all security constraints (admin signer, global config,
//! pool PDAs, pool PST vaults, Huma program ID, token programs, and Huma CPI errors).

use {
    anchor_lang::{AccountSerialize, InstructionData, Space, ToAccountMetas},
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

pub const FAIL_CREATE_LENDER_PUBKEY: Pubkey = Pubkey::new_from_array([4; 32]);

/// Build an `InitializeHumaLender` instruction.
fn build_initialize_huma_lender_ix(
    admin: Pubkey,
    pool_id: u32,
    pst_token_program: Pubkey,
    huma_program: Pubkey,
    huma_config: Pubkey,
    huma_pool_config: Pubkey,
    huma_pool_state: Pubkey,
    huma_mode_config: Pubkey,
    huma_mode_mint: Pubkey,
    huma_lender_state: Pubkey,
    huma_lender_mode_token: Pubkey,
) -> Instruction {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);
    let (pool_pst_vault, _) = pool_pst_vault_pda(pool_id);

    let accounts = anchor::accounts::InitializeHumaLender {
        admin,
        global_config,
        pool,
        pool_pst_vault,
        huma_program,
        huma_config,
        huma_pool_config,
        huma_pool_state,
        huma_mode_config,
        huma_mode_mint,
        huma_lender_state,
        huma_lender_mode_token,
        token_program: anchor_spl::token::ID,
        pst_token_program,
        associated_token_program: anchor_spl::associated_token::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeHumaLender {}.data(),
    }
}

/// Send an `InitializeHumaLender` instruction signed by the admin.
fn send_initialize_huma_lender(
    svm: &mut LiteSVM,
    admin: &Keypair,
    ix: Instruction,
) -> Result<(), String> {
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

/// Send an `InitializeHumaLender` instruction unsigned by the admin (marked as non-signer).
fn send_initialize_huma_lender_unsigned(
    svm: &mut LiteSVM,
    admin_pubkey: Pubkey,
    mut ix: Instruction,
) -> Result<(), String> {
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();

    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == admin_pubkey {
            meta.is_signer = false;
        }
    }
    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&payer.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();
    svm.send_transaction(tx)
        .map(|_| ())
        .map_err(|e| format!("{e:?}"))
}

// ═══════════════════════════════════════════════════════════════════════════════
// Happy-path Scenario
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_succeeds() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_ok(),
        "initialize_huma_lender should succeed: {:?}",
        res
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Access Control Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_unsigned_admin() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    let ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender_unsigned(&mut ctx.svm, ctx.admin.pubkey(), ix);
    assert!(res.is_err(), "Must fail when admin is not a signer");
}

#[test]
fn test_initialize_huma_lender_fails_unauthorized_admin() {
    let mut ctx = setup_e2e(10);
    let hacker = Keypair::new();
    ctx.svm.airdrop(&hacker.pubkey(), 10_000_000_000).unwrap();
    let dummy = Keypair::new().pubkey();

    // Signer is hacker, but global_config expects admin
    let ix = build_initialize_huma_lender_ix(
        hacker.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender(&mut ctx.svm, &hacker, ix);
    assert!(res.is_err(), "Must fail with unauthorized admin error");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne"),
        "Expected UnauthorizedAdmin or ConstraintHasOne, got: {}",
        err_str
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Seed/PDA Checks
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_wrong_global_config_pda() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();
    let wrong_global_config = Keypair::new().pubkey();

    let mut ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    // Mismatched global_config address
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == global_config_pda().0 {
            meta.pubkey = wrong_global_config;
        }
    }

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail when wrong global config PDA is supplied"
    );
}

#[test]
fn test_initialize_huma_lender_fails_wrong_pool_pda() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();
    let wrong_pool = Keypair::new().pubkey();
    let (pool_pda_addr, _) = pool_pda(1);

    let mut ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    // Mismatched pool PDA address
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == pool_pda_addr {
            meta.pubkey = wrong_pool;
        }
    }

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail when wrong pool PDA is supplied");
}

#[test]
fn test_initialize_huma_lender_fails_pool_vault_authority_bump_mismatch() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();
    let (pool_pda_addr, _) = pool_pda(1);

    // Corrupt the pool state bump
    let mut pool = read_pool_state(&ctx.svm, 1);
    pool.vault_authority_bump ^= 1; // Mismatch bump

    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();
    data.resize(8 + anchor::PrizePool::INIT_SPACE, 0);

    ctx.svm
        .set_account(
            pool_pda_addr,
            Account {
                lamports: 1_000_000_000,
                data,
                owner: anchor::id(),
                executable: false,
                rent_epoch: 0,
            },
        )
        .unwrap();

    let ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail when vault_authority_bump does not match derivation bump"
    );
}

#[test]
fn test_initialize_huma_lender_fails_wrong_pool_pst_vault_pda() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();
    let wrong_pst_vault = Keypair::new().pubkey();
    let (pool_pst_vault_addr, _) = pool_pst_vault_pda(1);

    let mut ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    // Mismatched pool_pst_vault PDA address
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == pool_pst_vault_addr {
            meta.pubkey = wrong_pst_vault;
        }
    }

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail when wrong pool PST vault PDA is supplied"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Huma Program Check
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_invalid_huma_program() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();
    let wrong_huma_program = Keypair::new().pubkey();

    let ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        wrong_huma_program, // Mismatched huma_program ID
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail when wrong huma_program address is supplied"
    );
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("ConstraintAddress") || err_str.contains("Raw"),
        "Expected ConstraintAddress error, got: {}",
        err_str
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Token Program Check
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_invalid_pst_token_program() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();
    let wrong_pst_token_program = anchor_spl::associated_token::ID; // Mismatched program

    let ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        wrong_pst_token_program,
        huma_program_id(),
        dummy,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(
        res.is_err(),
        "Must fail when wrong pst_token_program is supplied"
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// CPI Failure Check
// ═══════════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_huma_lender_fails_huma_cpi_error() {
    let mut ctx = setup_e2e(10);
    let dummy = Keypair::new().pubkey();

    // Use FAIL_CREATE_LENDER_PUBKEY as the huma_config account to trigger simulated failure
    let ix = build_initialize_huma_lender_ix(
        ctx.admin.pubkey(),
        1,
        anchor_spl::token::ID,
        huma_program_id(),
        FAIL_CREATE_LENDER_PUBKEY,
        dummy,
        ctx.huma_pool_state,
        dummy,
        ctx.pst_mint,
        dummy,
        dummy,
    );

    let res = send_initialize_huma_lender(&mut ctx.svm, &ctx.admin, ix);
    assert!(res.is_err(), "Must fail with simulated Huma CPI error");
    let err_str = format!("{:?}", res.unwrap_err());
    assert!(
        err_str.contains("SimulatedCreateLenderFailure")
            || err_str.contains("6003")
            || err_str.contains("0x1773"),
        "Expected SimulatedCreateLenderFailure error (6003 or 0x1773), got: {}",
        err_str
    );
}
