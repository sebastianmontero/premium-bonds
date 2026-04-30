//! Integration tests for the `set_prize_tiers` instruction.
//!
//! Run with:
//!   cargo test --package anchor --test test_set_prize_tiers -- --nocapture

use {
    anchor_lang::prelude::Pubkey,
    anchor_lang::{InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_program::instruction::Instruction,
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
    solana_sdk::account::Account,
    anchor_lang::{AccountSerialize, Space},
};

// ─── Constants mirrored from the program ────────────────────────────────────

const GLOBAL_CONFIG_SEED: &[u8] = b"global_config";
const PRIZE_POOL_SEED: &[u8] = b"prize_pool";

// ─── Test helpers ────────────────────────────────────────────────────────────

fn global_config_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[GLOBAL_CONFIG_SEED], &anchor::id())
}

fn pool_pda(pool_id: u32) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[PRIZE_POOL_SEED, pool_id.to_le_bytes().as_ref()],
        &anchor::id(),
    )
}

/// Setup the basic SVM environment with the program and an initialized GlobalConfig.
fn setup_global_config() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();

    let program_bytes = include_bytes!("../../../target/deploy/anchor.so");
    svm.add_program(anchor::id(), program_bytes);

    let admin = Keypair::new();
    svm.airdrop(&admin.pubkey(), 10_000_000_000).unwrap();

    let (global_config, _bump) = global_config_pda();
    let jobs_account = Keypair::new().pubkey();

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
            max_tickets_per_buy: 100,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[ix], Some(&admin.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&admin]).unwrap();

    svm.send_transaction(tx).expect("initialize_global should succeed");

    (svm, admin)
}

/// Helper to inject a `PrizePool` account directly into the SVM, bypassing `create_pool`.
fn inject_pool(svm: &mut LiteSVM, pool_id: u32, is_frozen_for_draw: bool) -> Pubkey {
    let (pda, bump) = pool_pda(pool_id);

    let pool = anchor::PrizePool {
        vault_authority_bump: bump,
        pool_id,
        token_mint: Pubkey::default(),
        ticket_registry: Pubkey::default(),
        fee_wallet: Pubkey::default(),
        bond_price: 1_000_000,
        stake_cycle_duration_hrs: 24,
        fee_basis_points: 100,
        status: anchor::PoolStatus::Active,
        total_deposited_principal: 0,
        total_fees_collected: 0,
        current_cycle_end_at: 0,
        is_frozen_for_draw,
        current_draw_cycle_id: 0,
        max_withdrawal_slippage_dust: 0,
        prize_tiers: vec![],
        auto_reinvest_default: false,
    };

    let mut data = vec![];
    pool.try_serialize(&mut data).unwrap();

    // Pad the data to the full account size to prevent serialization errors when adding items to the Vec.
    let full_size = 8 + anchor::PrizePool::INIT_SPACE;
    data.resize(full_size, 0);

    svm.set_account(
        pda,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    ).unwrap();

    pda
}

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

/// Deserialize the `PrizePool` account from raw LiteSVM account data.
fn read_prize_pool(svm: &LiteSVM, pool_id: u32) -> anchor::PrizePool {
    let (pda, _) = pool_pda(pool_id);
    let account = svm
        .get_account(&pda)
        .expect("prize_pool account must exist");

    anchor_lang::AccountDeserialize::try_deserialize(&mut account.data.as_slice())
        .expect("account data should deserialize as PrizePool")
}

// ═══════════════════════════════════════════════════════════════════════════
// Happy-path tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_prize_tiers_succeeds() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    let tiers = vec![
        anchor::PrizeTier { basis_points: 5000, num_winners: 1 }, // 50% for 1 winner
        anchor::PrizeTier { basis_points: 1000, num_winners: 5 }, // 50% split among 5 winners (10% each)
    ];

    send_set_prize_tiers(&mut svm, &admin, pool_id, tiers.clone(), None, None)
        .expect("Setting valid prize tiers should succeed");

    let pool = read_prize_pool(&svm, pool_id);
    assert_eq!(pool.prize_tiers.len(), 2);
    assert_eq!(pool.prize_tiers[0].basis_points, 5000);
    assert_eq!(pool.prize_tiers[0].num_winners, 1);
    assert_eq!(pool.prize_tiers[1].basis_points, 1000);
    assert_eq!(pool.prize_tiers[1].num_winners, 5);
}

// ═══════════════════════════════════════════════════════════════════════════
// Constraint tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_prize_tiers_fails_if_frozen() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    // Inject pool WITH is_frozen_for_draw = true
    inject_pool(&mut svm, pool_id, true);

    let tiers = vec![
        anchor::PrizeTier { basis_points: 10000, num_winners: 1 },
    ];

    let result = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers, None, None);
    assert!(result.is_err(), "Must fail if pool is frozen");
    
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(err_str.contains("AwaitingRandomnessFreeze"));
}

#[test]
fn test_set_prize_tiers_fails_on_empty_tiers() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    let tiers = vec![];

    let result = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers, None, None);
    assert!(result.is_err(), "Must fail if tiers is empty");
    
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(err_str.contains("InvalidPrizeTierConfig"));
}

#[test]
fn test_set_prize_tiers_fails_on_exceeding_max_tiers() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    // Create 11 tiers (MAX_PRIZE_TIERS is 10)
    let mut tiers = vec![];
    for _ in 0..11 {
        // Technically invalid basis points but array length is checked first
        tiers.push(anchor::PrizeTier { basis_points: 100, num_winners: 1 });
    }

    let result = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers, None, None);
    assert!(result.is_err(), "Must fail if exceeding max tiers");
    
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(err_str.contains("InvalidPrizeTierConfig"));
}

#[test]
fn test_set_prize_tiers_fails_on_invalid_basis_points_or_winners() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    // Zero basis points
    let tiers1 = vec![anchor::PrizeTier { basis_points: 0, num_winners: 1 }];
    let res1 = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers1, None, None);
    assert!(format!("{:?}", res1.unwrap_err()).contains("InvalidPrizeTierConfig"));

    // Zero winners
    let tiers2 = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 0 }];
    let res2 = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers2, None, None);
    assert!(format!("{:?}", res2.unwrap_err()).contains("InvalidPrizeTierConfig"));
}

#[test]
fn test_set_prize_tiers_fails_on_exceeding_total_winners() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    // MAX_TOTAL_WINNERS is 50. Let's send 51 winners.
    let tiers = vec![
        anchor::PrizeTier { basis_points: 10000, num_winners: 51 },
    ];

    let result = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers, None, None);
    assert!(result.is_err(), "Must fail if total winners > MAX_TOTAL_WINNERS");
    
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(err_str.contains("InvalidPrizeTierConfig"));
}

#[test]
fn test_set_prize_tiers_fails_on_incorrect_total_basis_points() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    // Total = 9,999 (not 10,000)
    let tiers1 = vec![anchor::PrizeTier { basis_points: 9999, num_winners: 1 }];
    let res1 = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers1, None, None);
    assert!(format!("{:?}", res1.unwrap_err()).contains("BasisPointsMustEqual10000"));

    // Total = 10,001
    let tiers2 = vec![
        anchor::PrizeTier { basis_points: 5000, num_winners: 1 },
        anchor::PrizeTier { basis_points: 5001, num_winners: 1 },
    ];
    let res2 = send_set_prize_tiers(&mut svm, &admin, pool_id, tiers2, None, None);
    assert!(format!("{:?}", res2.unwrap_err()).contains("BasisPointsMustEqual10000"));
}

// ═══════════════════════════════════════════════════════════════════════════
// Access-control tests
// ═══════════════════════════════════════════════════════════════════════════

#[test]
fn test_set_prize_tiers_unauthorized_admin() {
    let (mut svm, _admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    let attacker = Keypair::new();
    svm.airdrop(&attacker.pubkey(), 1_000_000_000).unwrap();

    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];

    let result = send_set_prize_tiers(
        &mut svm,
        &attacker, // Attacker signs the tx
        pool_id,
        tiers,
        None,      // The admin account passed in the IX defaults to `attacker.pubkey()`
        None,
    );

    assert!(result.is_err(), "Must fail with an unauthorized admin");
    
    let err_str = format!("{:?}", result.unwrap_err());
    assert!(
        err_str.contains("UnauthorizedAdmin") || err_str.contains("ConstraintHasOne") || err_str.contains("custom program error"),
        "Expected constraint error but got: {}", err_str
    );
}

#[test]
fn test_set_prize_tiers_requires_admin_signature() {
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    inject_pool(&mut svm, pool_id, false);

    let random_payer = Keypair::new();
    svm.airdrop(&random_payer.pubkey(), 1_000_000_000).unwrap();

    let tiers = vec![anchor::PrizeTier { basis_points: 10000, num_winners: 1 }];

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

    assert!(result.is_err(), "Must fail if the admin account is not a signer");
}
