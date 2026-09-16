//! Integration tests for `update_global_config` and two-step admin governance lifecycle.
//!
//! Run with:
//!   cargo +nightly test --package anchor --test test_update_global_config -- --nocapture

use {
    anchor::error::PremiumBondsError, anchor_lang::prelude::Pubkey, litesvm::LiteSVM,
    solana_keypair::Keypair, solana_signer::Signer,
};

mod common;
use common::*;

fn setup_and_initialize() -> (LiteSVM, Keypair, Pubkey) {
    let admin = Keypair::new();
    let initial_jobs_account = Keypair::new().pubkey();
    let svm = setup_global_config_with_admin(&admin, &admin.pubkey(), Some(&initial_jobs_account));
    (svm, admin, initial_jobs_account)
}

// ═══════════════════════════════════════════════════════════════════════════
// Update Global Config Tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_update_global_config_no_fields() {
    let (mut svm, admin, jobs) = setup_and_initialize();

    send_update_global_config(&mut svm, &admin, None, None)
        .expect("Updating no fields should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.jobs_account, jobs);
}

#[test]
fn test_update_global_config_guardian_only() {
    let (mut svm, admin, jobs) = setup_and_initialize();
    let initial_config = read_global_config(&svm);

    let new_guardian = Keypair::new().pubkey();

    let meta = send_update_global_config(&mut svm, &admin, Some(new_guardian), None)
        .expect("Updating guardian should succeed");
    let event = assert_cpi_event::<anchor::events::GlobalConfigUpdated>(&meta);
    assert_eq!(
        event.authority,
        admin.pubkey(),
        "event authority matches admin"
    );
    assert_eq!(
        event.old_guardian, initial_config.guardian,
        "old_guardian matches initial"
    );
    assert_eq!(
        event.new_guardian, new_guardian,
        "new_guardian matches updated"
    );
    assert_eq!(
        event.old_jobs_account, jobs,
        "old_jobs_account matches initial"
    );
    assert_eq!(
        event.new_jobs_account, jobs,
        "new_jobs_account matches unchanged"
    );
    assert!(event.timestamp > 0, "event timestamp is valid");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey(), "config admin unchanged");
    assert_eq!(config.guardian, new_guardian, "config guardian updated");
    assert_eq!(config.jobs_account, jobs, "config jobs_account unchanged");
}

#[test]
fn test_update_global_config_jobs_account_only() {
    let (mut svm, admin, _) = setup_and_initialize();

    let new_jobs_account = Keypair::new().pubkey();

    let meta = send_update_global_config(&mut svm, &admin, None, Some(new_jobs_account))
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

    let new_guardian = Keypair::new().pubkey();
    let new_jobs_account = Keypair::new().pubkey();

    send_update_global_config(&mut svm, &admin, Some(new_guardian), Some(new_jobs_account))
        .expect("Updating all fields should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.guardian, new_guardian);
    assert_eq!(config.jobs_account, new_jobs_account);
}

#[test]
fn test_update_global_config_unauthorized_admin() {
    let (mut svm, _admin, _) = setup_and_initialize();

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let result =
        send_update_global_config(&mut svm, &attacker, Some(Keypair::new().pubkey()), None);

    assert_custom_error(result, PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_update_global_config_requires_admin_signature() {
    let (mut svm, admin, _) = setup_and_initialize();

    let ix = build_update_global_config_ix(&admin.pubkey(), Some(Keypair::new().pubkey()), None);

    assert_signer_required(
        &mut svm,
        ix,
        1,
        &admin.pubkey(),
        &[],
        "update_global_config",
        "admin",
    );
}

#[test]
fn test_update_global_config_wrong_pda() {
    let (mut svm, admin, _) = setup_and_initialize();
    let (wrong_pda, _) = Pubkey::find_program_address(&[b"wrong_seed"], &anchor::id());
    let (global_config_pda, _) = global_config_pda();

    // Inject initialized global_config account data to wrong_pda so seed constraint is evaluated
    let global_config_acc = svm.get_account(&global_config_pda).unwrap();
    svm.set_account(wrong_pda, global_config_acc).unwrap();

    let mut ix =
        build_update_global_config_ix(&admin.pubkey(), Some(Keypair::new().pubkey()), None);
    substitute_account_meta(&mut ix, global_config_pda, wrong_pda);

    let result = send_user_tx(&mut svm, &admin, ix);
    assert_anchor_error(result, anchor_lang::error::ErrorCode::ConstraintSeeds);
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
