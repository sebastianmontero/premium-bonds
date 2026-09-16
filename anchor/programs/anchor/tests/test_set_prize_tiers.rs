//! Integration tests for the `set_prize_tiers` instruction.
//!
//! Run with:
//!   cargo test --package anchor --test test_set_prize_tiers -- --nocapture

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::{AccountSerialize, Space},
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::instruction::Instruction,
    solana_sdk::account::Account,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

mod common;
use common::*;

/// Helper to send `set_prize_tiers` instruction.
fn send_set_prize_tiers(
    svm: &mut LiteSVM,
    admin: &Keypair,
    pool_id: u32,
    tiers: Vec<anchor::PrizeTier>,
    admin_account_override: Option<Pubkey>,
    override_is_signer: Option<bool>,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let (global_config, _) = global_config_pda();
    let (pool, _) = pool_pda(pool_id);

    let mut accounts = anchor::accounts::SetPrizeTiers {
        global_config,
        admin: admin_account_override.unwrap_or_else(|| admin.pubkey()),
        pool,
        event_authority: event_authority_pda(),
        program: anchor::id(),
    }
    .to_account_metas(None);

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
        data: anchor::instruction::SetPrizeTiers { tiers }.data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[admin]).unwrap();

    svm.send_transaction(tx)
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_prize_tiers_succeeds() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    PrizePoolTestBuilder::new(pool_id).inject(&mut svm);

    let tiers = vec![
        anchor::PrizeTier::new(1, 5000), // 50% for 1 winner
        anchor::PrizeTier::new(5, 1000), // 50% split among 5 winners (10% each)
    ];

    let meta = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers.clone(), None, None)
        .expect("Setting valid prize tiers should succeed");
    let event = assert_cpi_event::<anchor::events::PrizeTiersUpdated>(&meta);
    assert_eq!(event.pool_id, pool_id, "event pool_id matches");
    assert_eq!(event.admin, admin.pubkey(), "event admin matches");
    assert_eq!(event.old_tiers_count, 0, "old_tiers_count is 0");
    assert_eq!(event.old_total_winners, 0, "old_total_winners is 0");
    assert_eq!(event.new_tiers_count, 2, "new_tiers_count is 2");
    assert_eq!(event.new_total_winners, 6, "new_total_winners is 6");
    assert_eq!(event.tiers.len(), 2, "event tiers len is 2");
    assert_eq!(
        event.tiers[0].basis_points, 5000,
        "event tier 0 basis points is 5000"
    );
    assert!(event.timestamp > 0, "event timestamp is valid");

    let pool = read_pool_state(&svm, pool_id);
    assert_eq!(pool.prize_tiers_count, 2, "pool prize_tiers_count is 2");
    assert_eq!(
        pool.prize_tiers[0].basis_points, 5000,
        "tier 0 basis points is 5000"
    );
    assert_eq!(
        pool.prize_tiers[0].num_winners, 1,
        "tier 0 num_winners is 1"
    );
    assert_eq!(
        pool.prize_tiers[1].basis_points, 1000,
        "tier 1 basis points is 1000"
    );
    assert_eq!(
        pool.prize_tiers[1].num_winners, 5,
        "tier 1 num_winners is 5"
    );
}

// ═══════════════════════════════════════════════════════════════════════════
// Constraint tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_prize_tiers_fails_if_frozen() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    PrizePoolTestBuilder::new(pool_id)
        .with_frozen(true)
        .inject(&mut svm);

    let tiers = vec![anchor::PrizeTier::default_single_winner()];

    let result = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers, None, None);
    assert_custom_error(
        result,
        anchor::error::PremiumBondsError::AwaitingRandomnessFreeze,
    );
}

#[test]
fn test_set_prize_tiers_constraint_matrix() {
    struct TestCase {
        name: &'static str,
        tiers: Vec<anchor::PrizeTier>,
        expected_error: anchor::error::PremiumBondsError,
    }

    let cases = vec![
        TestCase {
            name: "empty_tiers",
            tiers: vec![],
            expected_error: anchor::error::PremiumBondsError::InvalidPrizeTierConfig,
        },
        TestCase {
            name: "exceeding_max_tiers (11 tiers)",
            tiers: (0..11).map(|_| anchor::PrizeTier::new(1, 100)).collect(),
            expected_error: anchor::error::PremiumBondsError::InvalidPrizeTierConfig,
        },
        TestCase {
            name: "zero_basis_points",
            tiers: vec![anchor::PrizeTier::new(1, 0)],
            expected_error: anchor::error::PremiumBondsError::InvalidPrizeTierConfig,
        },
        TestCase {
            name: "zero_winners",
            tiers: vec![anchor::PrizeTier::new(0, 10000)],
            expected_error: anchor::error::PremiumBondsError::InvalidPrizeTierConfig,
        },
        TestCase {
            name: "exceeding_max_winners (181 winners)",
            tiers: vec![anchor::PrizeTier::new(181, 10000)],
            expected_error: anchor::error::PremiumBondsError::TooManyWinners,
        },
        TestCase {
            name: "basis_points_sum_9999",
            tiers: vec![anchor::PrizeTier::new(1, 9999)],
            expected_error: anchor::error::PremiumBondsError::BasisPointsMustEqual10000,
        },
        TestCase {
            name: "basis_points_sum_10001",
            tiers: vec![
                anchor::PrizeTier::new(1, 5000),
                anchor::PrizeTier::new(1, 5001),
            ],
            expected_error: anchor::error::PremiumBondsError::BasisPointsMustEqual10000,
        },
    ];

    for case in cases {
        let (mut svm, admin) = setup_global_config();
        let pool_id = 1;
        PrizePoolTestBuilder::new(pool_id).inject(&mut svm);

        let res = send_set_prize_tiers(&mut svm, &admin, pool_id, case.tiers, None, None);
        assert_custom_error_msg(
            res,
            case.expected_error,
            &format!("Failed for test case: {}", case.name),
        );
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Access-control tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_prize_tiers_unauthorized_admin() {
    let (mut svm, _admin) = setup_global_config();
    let pool_id = 1;
    PrizePoolTestBuilder::new(pool_id).inject(&mut svm);

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let tiers = vec![anchor::PrizeTier::default_single_winner()];

    let result = send_set_prize_tiers(
        &mut svm, &attacker, // Attacker signs the tx
        pool_id, tiers,
        None, // The admin account passed in the IX defaults to `attacker.pubkey()`
        None,
    );

    assert_custom_error(result, anchor::error::PremiumBondsError::UnauthorizedAdmin);
}

#[test]
fn test_set_prize_tiers_requires_admin_signature() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    PrizePoolTestBuilder::new(pool_id).inject(&mut svm);

    let random_payer = Keypair::new();
    svm.airdrop(&random_payer.pubkey(), 1_000_000_000).unwrap();

    let tiers = vec![anchor::PrizeTier::default_single_winner()];

    // We pass `admin.pubkey()` as the admin account in the instruction,
    // BUT we override `is_signer` to `false`. Then we sign with a random payer.
    let result = send_set_prize_tiers(
        &mut svm,
        &random_payer,
        pool_id,
        tiers,
        Some(admin.pubkey()), // Pass the true admin
        Some(false),          // But clear the signer flag
    );

    assert_anchor_error(result, anchor_lang::error::ErrorCode::AccountNotSigner);
}

#[test]
fn test_set_prize_tiers_fails_on_math_overflow() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    PrizePoolTestBuilder::new(pool_id).inject(&mut svm);

    // This will cause a math overflow because 2 * u32::MAX overflows u32 checked_mul
    let tiers = vec![anchor::PrizeTier::new(u32::MAX, 2)];

    let result = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers, None, None);
    assert_custom_error(result, anchor::error::PremiumBondsError::MathOverflow);
}
