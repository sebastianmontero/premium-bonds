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

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════

/// Initialization succeeds when authority == admin and the PDA is created.
#[test]
fn test_initialize_global_succeeds_same_authority_and_admin() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let guardian = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();

    let meta = send_initialize_global(&mut svm, &authority, &authority.pubkey(), &guardian, &jobs)
        .expect("initialize_global should succeed");

    let event = assert_log_event::<anchor::events::GlobalConfigInitialized>(&meta);
    assert_eq!(event.authority, authority.pubkey());
    assert_eq!(event.admin, authority.pubkey());
    assert_eq!(event.guardian, guardian);
    assert_eq!(event.jobs_account, jobs);
    assert!(event.timestamp > 0);

    let (pda, _) = global_config_pda();
    assert!(
        svm.get_account(&pda).is_some(),
        "global_config PDA must exist after successful initialization"
    );

    let config = read_global_config(&svm);
    assert_eq!(
        config.admin,
        authority.pubkey(),
        "GlobalConfig admin must match authority pubkey"
    );
    assert_eq!(
        config.guardian, guardian,
        "GlobalConfig guardian must match designated guardian"
    );
    assert_eq!(
        config.jobs_account, jobs,
        "GlobalConfig jobs account must match designated jobs account"
    );
}

/// Initialization succeeds when authority != admin (decoupled upgrade authority and operational admin).
#[test]
fn test_initialize_global_succeeds_different_authority_and_admin() {
    let authority = Keypair::new();
    let designated_admin = Keypair::new().pubkey();
    let guardian = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();
    let mut svm = setup_svm_with_authority(&authority);

    let meta = send_initialize_global(&mut svm, &authority, &designated_admin, &guardian, &jobs)
        .expect("initialize_global should succeed with separate admin");

    let event = assert_log_event::<anchor::events::GlobalConfigInitialized>(&meta);
    assert_eq!(
        event.authority,
        authority.pubkey(),
        "event authority matches deployer"
    );
    assert_eq!(
        event.admin, designated_admin,
        "event admin matches designated admin"
    );
    assert_eq!(
        event.guardian, guardian,
        "event guardian matches designated guardian"
    );
    assert_eq!(
        event.jobs_account, jobs,
        "event jobs_account matches designated jobs"
    );
    assert!(event.timestamp > 0, "event timestamp is valid");

    let config = read_global_config(&svm);
    assert_eq!(
        config.admin, designated_admin,
        "config admin matches designated admin"
    );
    assert_eq!(
        config.guardian, guardian,
        "config guardian matches designated guardian"
    );
    assert_eq!(
        config.jobs_account, jobs,
        "config jobs_account matches designated jobs"
    );
}

/// The `jobs_account` field is stored verbatim — even for an arbitrary key or default pubkey.
#[test]
fn test_initialize_global_sets_jobs_account_default() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let guardian = Keypair::new().pubkey();

    send_initialize_global(
        &mut svm,
        &authority,
        &authority.pubkey(),
        &guardian,
        &Pubkey::default(),
    )
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
    let guardian = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();
    let balance_before = svm.get_balance(&authority.pubkey()).unwrap();

    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &guardian, &jobs)
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
    let guardian = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();
    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &guardian, &jobs)
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
    svm.airdrop(&fake_attacker.pubkey(), 10_000_000_000)
        .unwrap();

    let guardian = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();
    let result = send_initialize_global(
        &mut svm,
        &fake_attacker,
        &fake_attacker.pubkey(),
        &guardian,
        &jobs,
    );
    assert_custom_error(result, anchor::error::PremiumBondsError::UnauthorizedAdmin);
}

/// A transaction that omits the authority signature must be rejected.
#[test]
fn test_initialize_global_requires_authority_signature() {
    let real_authority = Keypair::new();
    let unsigned_authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&unsigned_authority);
    svm.airdrop(&real_authority.pubkey(), 10_000_000_000)
        .unwrap();

    let mut metas =
        InitializeGlobalBuilder::new(unsigned_authority.pubkey(), unsigned_authority.pubkey())
            .build_metas();

    // Manually remove signer flag
    set_signer_flag(&mut metas, &unsigned_authority.pubkey(), false);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts: metas,
        data: anchor::instruction::InitializeGlobal {}.data(),
    };

    let res = send_user_tx(&mut svm, &real_authority, ix);
    assert_anchor_error(res, anchor_lang::error::ErrorCode::AccountNotSigner);
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

    let res = InitializeGlobalBuilder::new(authority.pubkey(), authority.pubkey())
        .with_global_config(wrong_pda)
        .send(&mut svm, &authority);

    assert_anchor_error(res, anchor_lang::error::ErrorCode::ConstraintSeeds);
}

/// Supplying an invalid `program_data` account must fail.
#[test]
fn test_initialize_global_rejects_wrong_program_data_pda() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let (wrong_program_data, _) =
        Pubkey::find_program_address(&[b"wrong_program_data"], &anchor::id());

    let res = InitializeGlobalBuilder::new(authority.pubkey(), authority.pubkey())
        .with_program_data(wrong_program_data)
        .send(&mut svm, &authority);

    assert_anchor_error(res, anchor_lang::error::ErrorCode::AccountNotInitialized);
}

/// Calling `initialize_global` a second time must fail due to `init` constraint.
#[test]
fn test_initialize_global_fails_on_double_init() {
    let authority = Keypair::new();
    let mut svm = setup_svm_with_authority(&authority);
    let guardian = Keypair::new().pubkey();
    let jobs = Keypair::new().pubkey();

    // First call succeeds
    send_initialize_global(&mut svm, &authority, &authority.pubkey(), &guardian, &jobs)
        .expect("first init should succeed");

    // Second call must fail due to AccountAlreadyInUse / init constraint on the existing PDA
    let jobs2 = Keypair::new().pubkey();
    let result =
        send_initialize_global(&mut svm, &authority, &authority.pubkey(), &guardian, &jobs2);
    assert_custom_code_at(result, 0, 0, "SystemError::AccountAlreadyInUse");
}
