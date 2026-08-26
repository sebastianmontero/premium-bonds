# LiteSVM Test Stub Patterns & Invariant Verification Recipes

This reference document provides standardized, executable LiteSVM test templates for synthesizing tests to cover missing invariants.

---

## 1. Core Invariant LiteSVM Test Pattern

When synthesizing a test for an unverified invariant, use this structural recipe:

```rust
//! Invariant Test for INV-[DOMAIN]-[NUM]: [Invariant Title]
//! Vector: [VectorTag]
//!
//! Verifies:
//! 1. [Precondition Check]
//! 2. [State Transition Execution]
//! 3. [Global Conservation Law & Postcondition Assertion]

use {
    anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas},
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_program::instruction::Instruction,
    solana_sdk::{
        message::{Message, VersionedMessage},
        pubkey::Pubkey,
        signer::Signer,
        transaction::versioned::VersionedTransaction,
    },
};

mod common;
use common::*;

#[test]
fn test_invariant_inv_domain_001_conservation_of_capital() {
    // 1. Arrange: Setup initial state with explicit domain fixtures
    let (mut svm, admin) = setup_global_config();
    let pool_id = 1;
    let initial_deposit = 1_000_000_000; // 1,000 USDC

    let user = Keypair::new();
    svm.airdrop(&user.pubkey(), 10_000_000_000).unwrap();

    // 2. Capture Initial Balances (System Conservation Snapshot)
    let (pool_vault_pda, _) = pool_vault_pda(pool_id);
    let vault_balance_before = get_token_balance(&svm, pool_vault_pda);

    // 3. Act: Execute instruction sequence
    let res = send_buy_bonds(&mut svm, &user, pool_id, initial_deposit);
    assert!(res.is_ok(), "Expected buy_bonds to succeed: {:?}", res);

    // 4. Assert: Invariant Conservation Law (NOT hardcoded internal struct fields)
    let vault_balance_after = get_token_balance(&svm, pool_vault_pda);
    let user_token_balance_after = get_user_token_balance(&svm, &user);

    // INVARIANT 1: Total vault assets strictly increase by user deposited principal
    assert_eq!(
        vault_balance_after,
        vault_balance_before + initial_deposit,
        "Invariant Broken: Vault balance did not conserve deposited principal"
    );

    // INVARIANT 2: User ticket allocation contiguity
    let registry = get_ticket_registry(&svm, pool_id);
    let mut total_cumulative = 0;
    for entry in registry.entries() {
        assert_eq!(
            entry.cumulative_active,
            total_cumulative + entry.active,
            "Invariant Broken: Cumulative tickets must equal running sum of active tickets"
        );
        total_cumulative += entry.active;
    }
}
```

---

## 2. Boundary & Negative Invariant LiteSVM Test Pattern

When asserting on negative boundary conditions, enforce **exact custom error code matching** and **zero state mutation rollback**:

```rust
#[test]
fn test_invariant_inv_time_002_reveal_fails_before_lockup_expiry() {
    // 1. Arrange: Prepare draw cycle in frozen state at slot S
    let (mut svm, admin, pool_id, cycle_id) = setup_frozen_draw_cycle();
    let freeze_slot = 1000;
    let lockup_window = 100;
    set_clock_slot(&mut svm, freeze_slot + lockup_window - 1); // 1 slot BEFORE lockup ends

    // Capture state before failed attempt
    let draw_state_before = get_draw_cycle_state(&svm, pool_id, cycle_id);

    // 2. Act: Attempt reveal prematurely
    let ix = build_reveal_and_pick_winners_ix(admin.pubkey(), pool_id, cycle_id);
    let res = send_transaction(&mut svm, &[ix], &[&admin]);

    // 3. Assert Exact Error Variant (NOT generic error string)
    let err = res.unwrap_err();
    assert!(
        err.contains("RandomnessNotReady") || err.contains("LockupActive"),
        "Expected RandomnessNotReady / LockupActive error, got: {:?}",
        err
    );

    // 4. Assert Zero Partial State Mutation (State Rollback)
    let draw_state_after = get_draw_cycle_state(&svm, pool_id, cycle_id);
    assert_eq!(
        draw_state_before, draw_state_after,
        "Invariant Broken: Failed transaction corrupted on-chain state"
    );
}
```
