//! Integration tests for the `update_global_config` instruction.
//!
//! Run with:
//!   cargo +nightly test --package anchor --test test_update_global_config -- --nocapture

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::instruction::Instruction,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

// ─── Constants mirrored from the program ────────────────────────────────────

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";

// ─── Test helpers ────────────────────────────────────────────────────────────

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

/// Load the compiled program bytes, set up a funded SVM environment, and initialize the global config.
///
/// Returns `(svm, admin_keypair, initial_jobs_account, initial_max_tickets)`.
fn setup_and_initialize() -> (LiteSVM, Keypair, Pubkey, u32) {
    let mut svm = LiteSVM::new();

    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    svm.add_program(anchor::id(), program_bytes);

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap(); // 10 SOL

    let initial_jobs_account = Keypair::new().pubkey();
    let initial_max_tickets = 100;

    let (global_config, _bump) = global_config_pda();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account: initial_jobs_account,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy: initial_max_tickets,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    svm.send_transaction(tx).expect("initialize_global should succeed");

    (svm, admin, initial_jobs_account, initial_max_tickets)
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
fn send_update_global_config(
    svm: &mut LiteSVM,
    admin: &Keypair,
    global_config_account: Pubkey,
    admin_account_override: Option<Pubkey>,
    override_is_signer: Option<bool>,
    new_admin: Option<Pubkey>,
    new_jobs_account: Option<Pubkey>,
    new_max_tickets_per_buy: Option<u32>,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let mut accounts = anchor::accounts::UpdateGlobalConfig {
        global_config: global_config_account,
        admin: admin_account_override.unwrap_or_else(|| admin.pubkey()),
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
            new_admin,
            new_jobs_account,
            new_max_tickets_per_buy,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    
    // Sign the tx. Only the keys provided here will sign. If `override_is_signer` is false,
    // the client won't panic, but SVM program verification will fail it.
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();

    svm.send_transaction(tx)
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_update_global_config_no_fields() {
    let (mut svm, admin, jobs, max_tickets) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    send_update_global_config(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("Updating no fields should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.jobs_account, jobs);
    assert_eq!(config.max_tickets_per_buy, max_tickets);
}

#[test]
fn test_update_global_config_admin_only() {
    let (mut svm, admin, jobs, max_tickets) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let new_admin = Keypair::new().pubkey();

    send_update_global_config(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        Some(new_admin),
        None,
        None,
    )
    .expect("Updating admin should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, new_admin);
    assert_eq!(config.jobs_account, jobs); // remains unchanged
    assert_eq!(config.max_tickets_per_buy, max_tickets); // remains unchanged
}

#[test]
fn test_update_global_config_jobs_account_only() {
    let (mut svm, admin, _, max_tickets) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let new_jobs_account = Keypair::new().pubkey();

    send_update_global_config(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        None,
        Some(new_jobs_account),
        None,
    )
    .expect("Updating jobs account should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey()); // unchanged
    assert_eq!(config.jobs_account, new_jobs_account);
    assert_eq!(config.max_tickets_per_buy, max_tickets); // unchanged
}

#[test]
fn test_update_global_config_max_tickets_only() {
    let (mut svm, admin, jobs, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let new_max_tickets = 500;

    send_update_global_config(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        None,
        None,
        Some(new_max_tickets),
    )
    .expect("Updating max tickets should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey()); // unchanged
    assert_eq!(config.jobs_account, jobs); // unchanged
    assert_eq!(config.max_tickets_per_buy, new_max_tickets);
}

#[test]
fn test_update_global_config_all_fields() {
    let (mut svm, admin, _, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    let new_admin = Keypair::new().pubkey();
    let new_jobs_account = Keypair::new().pubkey();
    let new_max_tickets = 999;

    send_update_global_config(
        &mut svm,
        &admin,
        global_config,
        None,
        None,
        Some(new_admin),
        Some(new_jobs_account),
        Some(new_max_tickets),
    )
    .expect("Updating all fields should succeed");

    let config = read_global_config(&svm);
    assert_eq!(config.admin, new_admin);
    assert_eq!(config.jobs_account, new_jobs_account);
    assert_eq!(config.max_tickets_per_buy, new_max_tickets);
}

// ═══════════════════════════════════════════════════════════════════════════
// Access-control tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_update_global_config_unauthorized_admin() {
    let (mut svm, _admin, _, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    // A random attacker tries to call update
    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let new_admin = Keypair::new().pubkey();

    let result = send_update_global_config(
        &mut svm,
        &attacker, // Attacker signs the tx
        global_config,
        None,      // The admin account passed in the IX defaults to `attacker.pubkey()`
        None,
        Some(new_admin),
        None,
        None,
    );

    assert!(
        result.is_err(),
        "Update should fail with an unauthorized admin"
    );
    
    // We expect a ConstraintHasOne error because `attacker.pubkey() != global_config.admin`.
    let err = result.unwrap_err();
    let err_str = format!("{:?}", err);
    assert!(
        err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne") || err_str.contains("custom program error"),
        "Expected constraint error but got: {}", err_str
    );
}

#[test]
fn test_update_global_config_requires_admin_signature() {
    let (mut svm, admin, _, _) = setup_and_initialize();
    let (global_config, _) = global_config_pda();

    // We pass `admin.pubkey()` as the admin account in the instruction,
    // BUT we override `is_signer` to `false`. Then we sign with a random payer.
    let random_payer = Keypair::new();
    svm.airdrop(&random_payer.pubkey(), 1_000_000_000).unwrap();

    // Here we use `random_payer` to build and sign the Tx.
    // The `admin_account_override` is the true admin pubkey.
    // We must override `is_signer` to `false` so the client doesn't panic.
    let result = send_update_global_config(
        &mut svm,
        &random_payer,
        global_config,
        Some(admin.pubkey()), // Pass the true admin
        Some(false),          // But clear the signer flag
        Some(Keypair::new().pubkey()),
        None,
        None,
    );

    assert!(
        result.is_err(),
        "Update must fail if the admin account is not a signer"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Wrong PDA tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_update_global_config_wrong_pda() {
    let (mut svm, admin, _, _) = setup_and_initialize();

    let (wrong_pda, _) = Pubkey::find_program_address(&[b"wrong_seed"], &anchor::id());

    let result = send_update_global_config(
        &mut svm,
        &admin,
        wrong_pda, // Incorrect PDA
        None,
        None,
        Some(Keypair::new().pubkey()),
        None,
        None,
    );

    assert!(
        result.is_err(),
        "Update must fail when passing the wrong PDA"
    );
}
