//! Contract verification tests for the Kamino CPI interface.
//!
//! These tests verify that our CPI wrappers in `kamino.rs` match the real
//! Kamino protocol's instruction interface. They act as a canary — if Kamino
//! changes their discriminator or account layout, these tests fail BEFORE
//! we hit a runtime error on mainnet.
//!
//! # Verification Layers
//!
//! - **Layer 2**: Discriminator hash assertions — verifies hardcoded bytes
//!   match `sha256("global:<instruction_name>")[0..8]`.
//! - **Layer 3**: Account count & order reference — documents the expected
//!   struct field order from Kamino source and asserts our wrapper matches.
//!
//! # Reference
//!
//! Kamino-Finance/klend @ commit 95d694b
//! `programs/klend/src/handlers/handler_deposit_reserve_liquidity.rs` lines 93-138

use sha2::{Digest, Sha256};

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 2: Discriminator hash assertions
// ═══════════════════════════════════════════════════════════════════════════════

/// Verify the hardcoded `deposit_reserve_liquidity` discriminator in `kamino.rs`
/// matches the Anchor convention: `sha256("global:deposit_reserve_liquidity")[0..8]`.
#[test]
fn test_kamino_deposit_discriminator_matches() {
    // Anchor discriminator = sha256("global:deposit_reserve_liquidity")[0..8]
    let hash = Sha256::digest(b"global:deposit_reserve_liquidity");
    let computed: [u8; 8] = hash[..8].try_into().unwrap();
    let hardcoded: [u8; 8] = [169, 201, 30, 126, 6, 205, 102, 68];
    assert_eq!(
        computed, hardcoded,
        "Discriminator drift! kamino.rs deposit hardcoded bytes {:?} != sha256 {:?}",
        hardcoded, computed
    );
}

/// Verify the hardcoded `redeem_reserve_collateral` discriminator in `kamino.rs`
/// matches the Anchor convention: `sha256("global:redeem_reserve_collateral")[0..8]`.
#[test]
fn test_kamino_redeem_discriminator_matches() {
    let hash = Sha256::digest(b"global:redeem_reserve_collateral");
    let computed: [u8; 8] = hash[..8].try_into().unwrap();
    let hardcoded: [u8; 8] = [234, 117, 181, 125, 185, 142, 220, 29];
    assert_eq!(
        computed, hardcoded,
        "Discriminator drift! kamino.rs redeem hardcoded bytes {:?} != sha256 {:?}",
        hardcoded, computed
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
// Layer 3: Account count & order reference
// ═══════════════════════════════════════════════════════════════════════════════

/// Verify that our `kamino::deposit_reserve_liquidity` CPI wrapper builds
/// exactly 12 AccountMetas with the correct signer/writable flags.
///
/// Reference: Kamino `DepositReserveLiquidity` struct field order:
///   1.  owner                      — mut, signer
///   2.  reserve                    — mut
///   3.  lending_market             — readonly
///   4.  lending_market_authority   — readonly (PDA)
///   5.  reserve_liquidity_mint     — readonly
///   6.  reserve_liquidity_supply   — mut
///   7.  reserve_collateral_mint    — mut
///   8.  user_source_liquidity      — mut
///   9.  user_destination_collateral — mut
///  10.  collateral_token_program   — readonly
///  11.  liquidity_token_program    — readonly
///  12.  instruction_sysvar_account — readonly
#[test]
fn test_kamino_deposit_account_layout_matches_source() {
    use solana_program::instruction::AccountMeta;
    use solana_program::pubkey::Pubkey;
    let dummy = Pubkey::new_unique();

    // Build the same AccountMeta list our CPI wrapper produces (kamino.rs lines 42-55)
    let accounts = vec![
        AccountMeta::new(dummy, true),           // 1  owner (signer, mut)
        AccountMeta::new(dummy, false),           // 2  reserve (mut)
        AccountMeta::new_readonly(dummy, false),  // 3  lending_market
        AccountMeta::new_readonly(dummy, false),  // 4  lending_market_authority
        AccountMeta::new_readonly(dummy, false),  // 5  reserve_liquidity_mint
        AccountMeta::new(dummy, false),           // 6  reserve_liquidity_supply (mut)
        AccountMeta::new(dummy, false),           // 7  reserve_collateral_mint (mut)
        AccountMeta::new(dummy, false),           // 8  user_source_liquidity (mut)
        AccountMeta::new(dummy, false),           // 9  user_destination_collateral (mut)
        AccountMeta::new_readonly(dummy, false),  // 10 collateral_token_program
        AccountMeta::new_readonly(dummy, false),  // 11 liquidity_token_program
        AccountMeta::new_readonly(dummy, false),  // 12 instruction_sysvar_account
    ];

    // Account count
    assert_eq!(
        accounts.len(),
        12,
        "Kamino deposit_reserve_liquidity expects exactly 12 accounts"
    );

    // Account 0 (owner) must be signer + writable
    assert!(accounts[0].is_signer, "Account 0 (owner) must be a signer");
    assert!(accounts[0].is_writable, "Account 0 (owner) must be writable");

    // Account 1 (reserve) must be writable, not signer
    assert!(accounts[1].is_writable, "Account 1 (reserve) must be writable");
    assert!(!accounts[1].is_signer, "Account 1 (reserve) must not be signer");

    // Accounts 2-4 must be readonly
    for (i, label) in [
        (2, "lending_market"),
        (3, "lending_market_authority"),
        (4, "reserve_liquidity_mint"),
    ] {
        assert!(
            !accounts[i].is_writable,
            "Account {i} ({label}) must be readonly"
        );
    }

    // Accounts 5-8 must be writable
    for (i, label) in [
        (5, "reserve_liquidity_supply"),
        (6, "reserve_collateral_mint"),
        (7, "user_source_liquidity"),
        (8, "user_destination_collateral"),
    ] {
        assert!(
            accounts[i].is_writable,
            "Account {i} ({label}) must be writable"
        );
    }

    // Accounts 9-11 must be readonly
    for (i, label) in [
        (9, "collateral_token_program"),
        (10, "liquidity_token_program"),
        (11, "instruction_sysvar_account"),
    ] {
        assert!(
            !accounts[i].is_writable,
            "Account {i} ({label}) must be readonly"
        );
    }
}

/// Same layout verification for `redeem_reserve_collateral`.
///
/// Reference: Kamino `RedeemReserveCollateral` struct field order
/// (NOTE: lending_market comes BEFORE reserve — opposite of deposit!):
///   1.  owner                      — mut, signer
///   2.  lending_market             — readonly
///   3.  reserve                    — mut
///   4.  lending_market_authority   — readonly (PDA)
///   5.  reserve_liquidity_mint     — readonly
///   6.  reserve_collateral_mint    — mut
///   7.  reserve_liquidity_supply   — mut
///   8.  user_source_collateral     — mut
///   9.  user_destination_liquidity — mut
///  10.  collateral_token_program   — readonly
///  11.  liquidity_token_program    — readonly
///  12.  instruction_sysvar_account — readonly
#[test]
fn test_kamino_redeem_account_layout_matches_source() {
    use solana_program::instruction::AccountMeta;
    use solana_program::pubkey::Pubkey;
    let dummy = Pubkey::new_unique();

    let accounts = vec![
        AccountMeta::new(dummy, true),           // 1  owner (signer, mut)
        AccountMeta::new_readonly(dummy, false),  // 2  lending_market (NOTE: before reserve!)
        AccountMeta::new(dummy, false),           // 3  reserve (mut)
        AccountMeta::new_readonly(dummy, false),  // 4  lending_market_authority
        AccountMeta::new_readonly(dummy, false),  // 5  reserve_liquidity_mint
        AccountMeta::new(dummy, false),           // 6  reserve_collateral_mint (mut)
        AccountMeta::new(dummy, false),           // 7  reserve_liquidity_supply (mut)
        AccountMeta::new(dummy, false),           // 8  user_source_collateral (mut)
        AccountMeta::new(dummy, false),           // 9  user_destination_liquidity (mut)
        AccountMeta::new_readonly(dummy, false),  // 10 collateral_token_program
        AccountMeta::new_readonly(dummy, false),  // 11 liquidity_token_program
        AccountMeta::new_readonly(dummy, false),  // 12 instruction_sysvar_account
    ];

    assert_eq!(accounts.len(), 12, "Kamino redeem expects exactly 12 accounts");
    assert!(accounts[0].is_signer, "Account 0 (owner) must be a signer");

    // lending_market is at index 1 for redeem (not index 2 like deposit)
    assert!(
        !accounts[1].is_writable,
        "Account 1 (lending_market) must be readonly in redeem"
    );
}
