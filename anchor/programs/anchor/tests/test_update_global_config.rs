//! Integration tests for `update_global_config` and two-step admin governance lifecycle.
//!
//! Run with:
//!   cargo +nightly test --package anchor --test test_update_global_config -- --nocapture

use {
    anchor::error::PremiumBondsError,
    anchor_lang::prelude::Pubkey,
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::instruction::Instruction,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

fn setup_and_initialize() -> (LiteSVM, Keypair, Pubkey) {
    let admin = Keypair::new();
    let initial_jobs_account = Keypair::new().pubkey();
    let svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&initial_jobs_account));
    (svm, admin, initial_jobs_account)
}

/// Deserialize the `GlobalConfig` account from raw LiteSVM account data.
fn read_global_config(svm: &LiteSVM) -> anchor::GlobalConfig {
    let (global_config_pda, _) = global_config_pda();
    let account = svm
        .get_account(&global_config_pda)
        .expect("global_config account must exist after init");

    // Skip the 8-byte Anchor discriminator before deserializing.
    anchor_lang::AccountDeserialize::try_deserialize(&mut account.data.as_slice())
        .expect("account data should deserialize as GlobalConfig")
}

/// Helper to send `update_global_config` and return the `Result`.
fn send_update_global_config_test(
    svm: &mut LiteSVM,
    admin: &Keypair,
    global_config_account: Pubkey,
    admin_account_override: Option<Pubkey>,
    override_is_signer: Option<bool>,
    new_guardian: Option<Pubkey>,
    new_jobs_account: Option<Pubkey>,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let mut accounts = anchor::accounts::UpdateGlobalConfig {
        global_config: global_config_account,
        admin: admin_account_override.unwrap_or_else(|| admin.pubkey()),
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

    // Apply signer override if provided (e.g. for testing missing signatures)
    if let Some(is_signer) = override_is_signer {
        for meta in accounts.iter_mut() {
            if meta.pubkey == admin_account_override.unwrap_or_else(|| admin.pubkey()) {
                meta.is_signer = is_signer;
            }
        }
    }

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::UpdateGlobalConfig {
            new_guardian,
            new_jobs_account,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);

    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();
    svm.send_transaction(tx)
}

// ═══════════════════════════════════════════════════════════════════════════
// Update Global Config Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_update_global_config_no_fields() {
    let (mut svm, admin, jobs) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    send_update_global_config_test(&mut svm, &admin, global_config, None, None, None, None)
        .expect("Updating no fields should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.jobs_account, jobs);
}

#[test]
fn test_update_global_config_guardian_only() {
    let (mut svm, admin, jobs) = setup_and_initialize();
    let (global_config, _) = global_config_pda();
    let initial_config = read_global_config(&svm);

    let new_guardian = Keypair::new().pubkey();

    let meta = send_update_global_config_test(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        Some(new_guardian),
        None,
    )
    .expect("Updating guardian should succeed");
    let event = assert_cpi_event::<anchor::events::GlobalConfigUpdated>(&meta);
    assert_eq!(event.authority, admin.pubkey());
    assert_eq!(event.old_guardian, initial_config.guardian);
    assert_eq!(event.new_guardian, new_guardian);
    assert_eq!(event.old_jobs_account, jobs);
    assert_eq!(event.new_jobs_account, jobs);
    assert!(event.timestamp > 0);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.guardian, new_guardian);
    assert_eq!(config.jobs_account, jobs);
}

#[test]
fn test_update_global_config_jobs_account_only() {
    let (mut svm, admin, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let new_jobs_account = Keypair::new().pubkey();

    let meta = send_update_global_config_test(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        None,
        Some(new_jobs_account),
    )
    .expect("Updating jobs account should succeed");
    let event = assert_cpi_event::<anchor::events::GlobalConfigUpdated>(&meta);
    assert_eq!(event.authority, admin.pubkey());
    assert_eq!(event.new_jobs_account, new_jobs_account);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey()); // unchanged
    assert_eq!(config.jobs_account, new_jobs_account);
}

#[test]
fn test_update_global_config_all_fields() {
    let (mut svm, admin, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let new_guardian = Keypair::new().pubkey();
    let new_jobs_account = Keypair::new().pubkey();

    send_update_global_config_test(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        Some(new_guardian),
        Some(new_jobs_account),
    )
    .expect("Updating all fields should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.guardian, new_guardian);
    assert_eq!(config.jobs_account, new_jobs_account);
}

#[test]
fn test_update_global_config_unauthorized_admin() {
    let (mut svm, _admin, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let result = send_update_global_config_test(
        &mut svm,
        &attacker,
        global_config,
        None,
        None,
        Some(Keypair::new().pubkey()),
        None,
    );

    assert_custom_error(result, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_update_global_config_requires_admin_signature() {
    let (mut svm, admin, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let random_payer = Keypair::new();
    svm.airdrop(&random_payer.pubkey(), 1_000_000_000).unwrap();

    let result = send_update_global_config_test(
        &mut svm,
        &random_payer,
        global_config,
        Some(admin.pubkey()),
        Some(false),
        Some(Keypair::new().pubkey()),
        None,
    );

    assert!(
        result.is_err(),
        "Update must fail if the admin account is not a signer"
    );
}

#[test]
fn test_update_global_config_wrong_pda() {
    let (mut svm, admin, _) = setup_and_initialize();
    let (wrong_pda, _) = Pubkey::find_program_address(&[b"wrong_seed"], &anchor::id());

    let result = send_update_global_config_test(
        &mut svm,
        &admin,
        wrong_pda,
        None,
        None,
        Some(Keypair::new().pubkey()),
        None,
    );

    assert!(
        result.is_err(),
        "Update must fail when passing the wrong PDA"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Two-Step Admin Governance Lifecycle Tests (SEC-04)
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_initialize_global_rejects_zero_admin() {
    let mut svm = LiteSVM::new();
    let _ = svm.add_program(
        anchor::id(),
        include_bytes!("../../../target/deploy/anchor.so"),
    );

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    setup_program_data(&mut svm, Some(&payer.pubkey()));

    let res = send_initialize_global(
        &mut svm,
        &payer,
        &Pubkey::default(),
        &payer.pubkey(),
        &payer.pubkey(),
    );
    assert_custom_error(res, PremiumBondsError::InvalidAdminAddress);
}

#[test]
fn test_nominate_admin_happy_path() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new().pubkey();

    let meta = send_nominate_admin(&mut svm, &admin, alice).expect("Nominate admin should succeed");
    let event = assert_cpi_event::<anchor::events::AdminNominated>(&meta);
    assert_eq!(event.current_admin, admin.pubkey());
    assert_eq!(event.pending_admin, alice);
    assert!(event.timestamp > 0);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.pending_admin, alice);
}

#[test]
fn test_nominate_admin_overwrite_prior_nomination() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new().pubkey();
    let bob = Keypair::new().pubkey();

    send_nominate_admin(&mut svm, &admin, alice).expect("Nominate Alice");
    let meta = send_nominate_admin(&mut svm, &admin, bob).expect("Nominate Bob (overwrite)");
    let event = assert_cpi_event::<anchor::events::AdminNominated>(&meta);
    assert_eq!(event.current_admin, admin.pubkey());
    assert_eq!(event.pending_admin, bob);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.pending_admin, bob);
}

#[test]
fn test_nominate_admin_rejects_self_nomination() {
    let (mut svm, admin, _) = setup_and_initialize();

    let res = send_nominate_admin(&mut svm, &admin, admin.pubkey());
    assert_custom_error(res, PremiumBondsError::CannotNominateSelf);
}

#[test]
fn test_nominate_admin_rejects_zero_address() {
    let (mut svm, admin, _) = setup_and_initialize();

    let res = send_nominate_admin(&mut svm, &admin, Pubkey::default());
    assert_custom_error(res, PremiumBondsError::InvalidAdminAddress);
}

#[test]
fn test_nominate_admin_unauthorized_fails() {
    let (mut svm, _admin, _) = setup_and_initialize();
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let res = send_nominate_admin(&mut svm, &attacker, Keypair::new().pubkey());
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_cancel_admin_nomination_happy_path() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new().pubkey();

    send_nominate_admin(&mut svm, &admin, alice).expect("Nominate Alice");
    let meta = send_cancel_admin_nomination(&mut svm, &admin)
        .expect("Cancel admin nomination should succeed");
    let event = assert_cpi_event::<anchor::events::AdminNominationCancelled>(&meta);
    assert_eq!(event.current_admin, admin.pubkey());
    assert_eq!(event.cancelled_pending_admin, alice);
    assert!(event.timestamp > 0);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.pending_admin, Pubkey::default());
}

#[test]
fn test_cancel_admin_nomination_fails_when_none_pending() {
    let (mut svm, admin, _) = setup_and_initialize();

    let res = send_cancel_admin_nomination(&mut svm, &admin);
    assert_custom_error(res, PremiumBondsError::NoPendingAdmin);
}

#[test]
fn test_cancel_admin_nomination_unauthorized_fails() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new().pubkey();
    send_nominate_admin(&mut svm, &admin, alice).expect("Nominate Alice");

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let res = send_cancel_admin_nomination(&mut svm, &attacker);
    assert_custom_error(res, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_accept_admin_happy_path() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new();
    svm.airdrop(&alice.pubkey(), 1_000_000_000).unwrap();

    send_nominate_admin(&mut svm, &admin, alice.pubkey()).expect("Nominate Alice");
    let meta = send_accept_admin(&mut svm, &alice).expect("Accept admin should succeed");
    let event = assert_cpi_event::<anchor::events::AdminTransferred>(&meta);
    assert_eq!(event.old_admin, admin.pubkey());
    assert_eq!(event.new_admin, alice.pubkey());
    assert!(event.timestamp > 0);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, alice.pubkey());
    assert_eq!(config.pending_admin, Pubkey::default());
}

#[test]
fn test_accept_admin_unauthorized_caller_fails() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new().pubkey();
    let bob = Keypair::new();
    svm.airdrop(&bob.pubkey(), 1_000_000_000).unwrap();

    send_nominate_admin(&mut svm, &admin, alice).expect("Nominate Alice");
    let res = send_accept_admin(&mut svm, &bob);
    assert_custom_error(res, PremiumBondsError::NotPendingAdmin);
}

#[test]
fn test_accept_admin_fails_when_none_pending() {
    let (mut svm, _admin, _) = setup_and_initialize();
    let caller = Keypair::new();
    svm.airdrop(&caller.pubkey(), 1_000_000_000).unwrap();

    let res = send_accept_admin(&mut svm, &caller);
    assert_custom_error(res, PremiumBondsError::NoPendingAdmin);
}

#[test]
fn test_accept_admin_second_call_fails() {
    let (mut svm, admin, _) = setup_and_initialize();
    let alice = Keypair::new();
    svm.airdrop(&alice.pubkey(), 1_000_000_000).unwrap();

    send_nominate_admin(&mut svm, &admin, alice.pubkey()).expect("Nominate Alice");
    send_accept_admin(&mut svm, &alice).expect("First accept succeeds");

    svm.expire_blockhash();
    let res = send_accept_admin(&mut svm, &alice);
    assert_custom_error(res, PremiumBondsError::NoPendingAdmin);
}
