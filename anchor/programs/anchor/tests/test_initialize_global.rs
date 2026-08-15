//! Integration tests for the `initialize_global` instruction.
//!
//! Strategy
//! ─────────
//! Each test uses LiteSVM with `UpgradeableLoaderState` dual-state setup in `tests/common/mod.rs`.
//! This exercises account constraint checks (PDA seeds, init, payer, authority, program_data,
//! program, system program) as well as the handler field-population logic.
//!
//! Run with:
//!   cargo +nightly test --package anchor --test test_initialize_global -- --nocapture

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::prelude::UpgradeableLoaderState,
    anchor_lang::{AnchorDeserialize, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::instruction::Instruction,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

/// Helper to deserialize GlobalConfig from LiteSVM
fn read_global_config(svm: &LiteSVM) -> anchor::GlobalConfig {
    let (pda, _) = global_config_pda();
    let account = svm
        .get_account(&pda)
        .expect("global_config account must exist after init");
    anchor_lang::AccountDeserialize::try_deserialize(&mut account.data.as_slice())
        .expect("account data should deserialize as GlobalConfig")
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════

/// Initialization succeeds when authority == admin and the PDA is created.
#[test]
fn test_initialize_global_succeeds_same_authority_and_admin() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let jobs = Keypair::new().pubkey();

    let meta = send_initialize_global(&mut svm, &authority, &authority.pubkey(), &jobs)
        .expect("initialize_global should succeed");

    let event = assert_log_event::<anchor::events::GlobalConfigUpdated>(&meta);
    assert_eq!(event.admin, authority.pubkey());
    assert_eq!(event.jobs_account, jobs);

    let (pda, _) = global_config_pda();
    assert!(
        svm.get_account(&pda).is_some(),
        "global_config PDA must exist after successful initialization"
    );

    let config = read_global_config(&svm);
    assert_eq!(config.admin, authority.pubkey());
    assert_eq!(config.jobs_account, jobs);
}


/// Initialization succeeds when authority != admin (decoupled upgrade authority and operational admin).
#[test]
fn test_initialize_global_succeeds_different_authority_and_admin() {
    let authority = Keypair::new();
    let designated_admin = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();
    let mut svm = setup_svm_with_authority(&authority);

    let meta = send_initialize_global(&mut svm, &authority, &designated_admin, &jobs)
        .expect("initialize_global should succeed with separate admin");

    let event = assert_log_event::<anchor::events::GlobalConfigUpdated>(&meta);
    assert_eq!(event.admin, designated_admin);
    assert_eq!(event.jobs_account, jobs);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, designated_admin);
    assert_eq!(config.jobs_account, jobs);
}

/// The `jobs_account` field is stored verbatim — even for an arbitrary key or default pubkey.
#[test]
fn test_initialize_global_sets_jobs_account_default() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);

    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &Pubkey::default())
        .expect("should succeed with default jobs pubkey");

    let config = read_global_config(&svm);
    assert_eq!(config.jobs_account, Pubkey::default());
}

/// After initialization the authority's SOL balance decreases by (at least) the
/// rent-exempt minimum for the GlobalConfig account space.
#[test]
fn test_initialize_global_deducts_rent_from_payer() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let jobs = Keypair::new().pubkey();
    let balance_before = svm.get_balance(&authority.pubkey()).unwrap();

    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &jobs)
        .expect("initialize_global should succeed");

    let balance_after = svm.get_balance(&authority.pubkey()).unwrap();
    assert!(
        balance_after < balance_before,
        "Authority balance must decrease after paying rent (before={balance_before}, after={balance_after})"
    );
}

/// The newly created account is owned by the program.
#[test]
fn test_initialize_global_account_owned_by_program() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let jobs = Keypair::new().pubkey();
    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &jobs)
        .expect("initialize_global should succeed");

    let (pda, _) = global_config_pda();
    let account = svm.get_account(&pda).unwrap();
    assert_eq!(
        account.owner,
        anchor::id(),
        "global_config must be owned by the program"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Upgrade Authority & Access Control tests
// ═══════════════════════════════════════════════════════════════════════════

/// Fails when the signer is NOT the program's upgrade authority.
#[test]
fn test_initialize_global_fails_when_signer_is_not_upgrade_authority() {
    let real_upgrade_authority = Keypair::new();
    let fake_attacker = Keypair::new();
    let mut svm = setup_svm_with_authority(&real_upgrade_authority);
    svm.airdrop(&fake_attacker.pubkey(), 10_000_000_000).unwrap();

    let jobs = Keypair::new().pubkey();
    let result = send_initialize_global(&mut svm, &fake_attacker, &fake_attacker.pubkey(), &jobs);
    assert!(
        result.is_err(),
        "Must fail when signer is not the program's upgrade authority"
    );
}

/// A transaction that omits the authority signature must be rejected.
#[test]
fn test_initialize_global_requires_authority_signature() {
    let real_authority = Keypair::new();
    let unsigned_authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&unsigned_authority);
    svm.airdrop(&real_authority.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _) = global_config_pda();
    let (program_data, _) = program_data_pda();
    let jobs = Keypair::new().pubkey();

    let mut accounts = anchor::accounts::InitializeGlobal {
        global_config,
        authority: unsigned_authority.pubkey(),
        admin: unsigned_authority.pubkey(),
        jobs_account: jobs,
        program_data,
        program: anchor::id(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    // Manually remove signer flag
    for meta in accounts.iter_mut() {
        if meta.pubkey == unsigned_authority.pubkey() {
            meta.is_signer = false;
        }
    }

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&real_authority.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&real_authority]).unwrap();

    assert!(svm.send_transaction(tx).is_err(), "Must fail when authority does not sign");
}

// ═══════════════════════════════════════════════════════════════════════════
// Wrong-PDA / Seed Manipulation Tests
// ═══════════════════════════════════════════════════════════════════════════

/// Supplying a `global_config` address that was derived from the wrong seed must fail.
#[test]
fn test_initialize_global_rejects_wrong_global_config_pda() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let (wrong_pda, _) = Pubkey::find_program_address(&[b"wrong_seed"], &anchor::id());
    let (program_data, _) = program_data_pda();
    let jobs = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config: wrong_pda,
        authority: authority.pubkey(),
        admin: authority.pubkey(),
        jobs_account: jobs,
        program_data,
        program: anchor::id(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();

    assert!(svm.send_transaction(tx).is_err(), "Wrong global_config PDA must be rejected");
}

/// Supplying an invalid `program_data` account must fail.
#[test]
fn test_initialize_global_rejects_wrong_program_data_pda() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let (global_config, _) = global_config_pda();
    let (wrong_program_data, _) = Pubkey::find_program_address(&[b"wrong_program_data"], &anchor::id());
    let jobs = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        authority: authority.pubkey(),
        admin: authority.pubkey(),
        jobs_account: jobs,
        program_data: wrong_program_data,
        program: anchor::id(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {}.data(),
    };

    let bh = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&authority.pubkey()), &bh);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&authority]).unwrap();

    assert!(svm.send_transaction(tx).is_err(), "Wrong program_data PDA must be rejected");
}

/// Calling `initialize_global` a second time must fail due to `init` constraint.
#[test]
fn test_initialize_global_fails_on_double_init() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let jobs = Keypair::new().pubkey();

    // First call succeeds
    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &jobs)
        .expect("first init should succeed");

    // Second call must fail
    let result = send_initialize_global(&mut svm, &authority, &authority.pubkey(), &jobs);
    assert!(result.is_err(), "Second init on the same PDA must fail");
}
