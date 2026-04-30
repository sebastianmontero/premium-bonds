//! Integration tests for the `initialize_global` instruction.
//!
//! Strategy
//! ─────────
//! Each test loads the compiled `.so` into a fresh LiteSVM instance, then
//! attempts to execute `initialize_global` via a real versioned transaction.
//! This exercises account constraint checks (PDA seeds, init, payer, system
//! program) as well as the handler field-population logic — all without a
//! live validator.
//!
//! Run with:
//!   cargo +nightly test --package anchor --test test_initialize_global -- --nocapture

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

/// Load the compiled program bytes and set up a funded SVM environment.
///
/// Returns `(svm, admin_keypair)` ready for test use.
fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();

    // Load the compiled BPF program.  The path is relative to the Cargo
    // workspace root so it works from any `cargo test` invocation directory.
    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    svm.add_program(anchor::id(), program_bytes);

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap(); // 10 SOL

    (svm, admin)
}

/// Derive the canonical `global_config` PDA for the program under test.
fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

/// Build and send an `initialize_global` transaction.
///
/// Returns the raw LiteSVM send result so callers can assert success or failure.
fn send_initialize_global(
    svm: &mut LiteSVM,
    admin: &Keypair,
    jobs_account: Pubkey,
    max_tickets_per_buy: u32,
) -> litesvm::types::FailedTransactionMetadata {
    let (global_config, _bump) = global_config_pda();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();

    // Use the infallible send so we can inspect errors
    match svm.send_transaction(tx) {
        Ok(meta) => {
            // Hack: wrap success as a "failed" with empty logs so the
            // return type is uniform.  Callers that expect success use
            // `send_initialize_global_ok` instead.
            let _ = meta;
            panic!("expected FailedTransactionMetadata but got Ok — use send_initialize_global_ok");
        }
        Err(failed) => failed,
    }
}

/// Variant of `send_initialize_global` that asserts success and
/// returns the confirmed transaction metadata.
fn send_initialize_global_ok(
    svm: &mut LiteSVM,
    admin: &Keypair,
    jobs_account: Pubkey,
    max_tickets_per_buy: u32,
) -> litesvm::types::TransactionMetadata {
    let (global_config, _bump) = global_config_pda();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: admin.pubkey(),
        jobs_account,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();

    svm.send_transaction(tx)
        .expect("initialize_global should succeed")
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

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════

/// The most basic case: initialization succeeds and the PDA is created.
#[test]
fn test_initialize_global_succeeds() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    send_initialize_global_ok(&mut svm, &admin, jobs, 10);

    let (pda, _) = global_config_pda();
    assert!(
        svm.get_account(&pda).is_some(),
        "global_config PDA must exist after successful initialization"
    );
}

/// After initialization the `admin` field equals the signing admin key.
#[test]
fn test_initialize_global_sets_admin() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    send_initialize_global_ok(&mut svm, &admin, jobs, 5);

    let config = read_global_config(&svm);
    assert_eq!(
        config.admin,
        admin.pubkey(),
        "GlobalConfig.admin must equal the signer"
    );
}

/// The `jobs_account` field is stored verbatim — even for an arbitrary key.
#[test]
fn test_initialize_global_sets_jobs_account() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    send_initialize_global_ok(&mut svm, &admin, jobs, 1);

    let config = read_global_config(&svm);
    assert_eq!(
        config.jobs_account, jobs,
        "GlobalConfig.jobs_account must equal the jobs_account passed in"
    );
}

/// The `max_tickets_per_buy` argument is stored exactly as supplied.
#[test]
fn test_initialize_global_sets_max_tickets_per_buy() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();
    let expected: u32 = 42;

    send_initialize_global_ok(&mut svm, &admin, jobs, expected);

    let config = read_global_config(&svm);
    assert_eq!(
        config.max_tickets_per_buy, expected,
        "GlobalConfig.max_tickets_per_buy must equal the argument"
    );
}

/// Minimum boundary: max_tickets_per_buy = 0 is still valid at the instruction level.
#[test]
fn test_initialize_global_zero_max_tickets() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    send_initialize_global_ok(&mut svm, &admin, jobs, 0);

    let config = read_global_config(&svm);
    assert_eq!(config.max_tickets_per_buy, 0);
}

/// Maximum boundary: u32::MAX is accepted without overflow.
#[test]
fn test_initialize_global_max_u32_tickets() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    send_initialize_global_ok(&mut svm, &admin, jobs, u32::MAX);

    let config = read_global_config(&svm);
    assert_eq!(config.max_tickets_per_buy, u32::MAX);
}

/// `jobs_account` can be the same key as `admin` (no constraint forbids it).
#[test]
fn test_initialize_global_jobs_equals_admin() {
    let (mut svm, admin) = setup();
    let jobs = admin.pubkey(); // same key

    send_initialize_global_ok(&mut svm, &admin, jobs, 10);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.jobs_account, admin.pubkey());
}

/// `jobs_account` can be `Pubkey::default()` (zero address) — the instruction
/// accepts any unchecked public key.
#[test]
fn test_initialize_global_jobs_default_pubkey() {
    let (mut svm, admin) = setup();

    send_initialize_global_ok(&mut svm, &admin, Pubkey::default(), 1);

    let config = read_global_config(&svm);
    assert_eq!(config.jobs_account, Pubkey::default());
}

/// After initialization the admin's SOL balance decreases by (at least) the
/// rent-exempt minimum for the GlobalConfig account space.
#[test]
fn test_initialize_global_deducts_rent_from_payer() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();
    let balance_before = svm.get_balance(&admin.pubkey()).unwrap();

    send_initialize_global_ok(&mut svm, &admin, jobs, 1);

    let balance_after = svm.get_balance(&admin.pubkey()).unwrap();
    assert!(
        balance_after < balance_before,
        "Admin balance must decrease after paying rent (before={balance_before}, after={balance_after})"
    );
}

/// The newly created account is owned by the program (ensures PDA allocation
/// is performed under the correct program owner).
#[test]
fn test_initialize_global_account_owned_by_program() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();
    send_initialize_global_ok(&mut svm, &admin, jobs, 10);

    let (pda, _) = global_config_pda();
    let account = svm.get_account(&pda).unwrap();
    assert_eq!(
        account.owner,
        anchor::id(),
        "global_config must be owned by the program"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Idempotency / double-init guard
// ═══════════════════════════════════════════════════════════════════════════

/// Calling `initialize_global` a second time on an already-initialized PDA
/// must fail — Anchor's `init` constraint prevents re-initialization.
#[test]
fn test_initialize_global_fails_on_double_init() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    // First call: must succeed.
    send_initialize_global_ok(&mut svm, &admin, jobs, 10);

    // Second call: must fail (PDA already exists).
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        send_initialize_global_ok(&mut svm, &admin, jobs, 99)
    }));
    assert!(
        result.is_err(),
        "A second initialize_global call on the same PDA must fail"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Access-control tests
// ═══════════════════════════════════════════════════════════════════════════

/// A transaction that omits the admin signature must be rejected.
/// We test this by using a payer that is NOT a signer in the accounts list.
#[test]
fn test_initialize_global_requires_admin_signature() {
    let mut svm = LiteSVM::new();
    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    svm.add_program(anchor::id(), program_bytes);

    let admin = Keypair::new();
    let unsigned_admin = Keypair::new(); // will NOT sign the tx
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _) = global_config_pda();
    let jobs = Keypair::new().pubkey();

    // Build accounts using unsigned_admin as the admin (but sign with `admin`)
    let mut accounts = anchor::accounts::InitializeGlobal {
        global_config,
        admin: unsigned_admin.pubkey(), // mismatched
        jobs_account: jobs,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    // Manually remove the signer flag so the client builder doesn't panic.
    // The program itself should reject this instruction.
    for meta in accounts.iter_mut() {
        if meta.pubkey == unsigned_admin.pubkey() {
            meta.is_signer = false;
        }
    }

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy: 10,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    // Sign only with `admin`, not with `unsigned_admin`.
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    let result = svm.send_transaction(tx);
    assert!(
        result.is_err(),
        "Transaction must fail when admin does not sign"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Wrong-PDA / seed manipulation tests
// ═══════════════════════════════════════════════════════════════════════════

/// Supplying a `global_config` address that was derived from the **wrong seed**
/// must be rejected by Anchor's PDA verification.
#[test]
fn test_initialize_global_rejects_wrong_pda() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();

    // Derive a PDA with a different seed prefix.
    let (wrong_pda, _) = Pubkey::find_program_address(&[b"wrong_seed"], &anchor::id());

    let accounts = anchor::accounts::InitializeGlobal {
        global_config: wrong_pda, // intentionally wrong
        admin: admin.pubkey(),
        jobs_account: jobs,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy: 10,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    assert!(
        svm.send_transaction(tx).is_err(),
        "Wrong PDA must be rejected"
    );
}

/// Supplying a random non-PDA address as `global_config` must be rejected.
#[test]
fn test_initialize_global_rejects_arbitrary_address() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();
    let random_key = Keypair::new().pubkey();

    let accounts = anchor::accounts::InitializeGlobal {
        global_config: random_key, // not a PDA at all
        admin: admin.pubkey(),
        jobs_account: jobs,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(None);

    let ix = Instruction {
        program_id: anchor::id(),
        accounts,
        data: anchor::instruction::InitializeGlobal {
            max_tickets_per_buy: 5,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    assert!(
        svm.send_transaction(tx).is_err(),
        "Non-PDA global_config must be rejected"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Multi-field consistency check
// ═══════════════════════════════════════════════════════════════════════════

/// All three mutable fields are set atomically in a single instruction.
/// Vary all inputs simultaneously and verify every field independently.
#[test]
fn test_initialize_global_all_fields_consistent() {
    let (mut svm, admin) = setup();
    let jobs = Keypair::new().pubkey();
    let max_tickets: u32 = 777;

    send_initialize_global_ok(&mut svm, &admin, jobs, max_tickets);

    let config = read_global_config(&svm);
    assert_eq!(config.admin, admin.pubkey());
    assert_eq!(config.jobs_account, jobs);
    assert_eq!(config.max_tickets_per_buy, max_tickets);
}
