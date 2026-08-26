# Surviving Mutant Triage & Patch Synthesis Playbook

This reference document provides a systematic protocol for analyzing why mutants survived and synthesizing mutant-killing test patches.

---

## 1. Surviving Mutant Triage Protocol

When `cargo-mutants` reports a surviving mutant:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SURVIVING MUTANT TRIAGE FLOWCHART                               │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
                                            ▼
                        ┌──────────────────────────────────────┐
                        │ Read Mutated Line & Replaced Value   │
                        └───────────────────┬──────────────────┘
                                            │
                    ┌───────────────────────┴───────────────────────┐
                    ▼                                               ▼
      ┌──────────────────────────┐                    ┌──────────────────────────┐
      │  Violates Domain Invariant│                   │ Produces Equivalent State│
      │  or Security Check?      │                    │ (Harmless Code Variation)│
      └─────────────┬────────────┘                    └─────────────┬────────────┘
                    │                                               │
                    ▼                                               ▼
      ┌──────────────────────────┐                    ┌──────────────────────────┐
      │ 🔴 REAL INTENT BLINDSPOT │                    │ 🟡 EQUIVALENT MUTANT     │
      │ Synthesize Killing Test  │                    │ Mark `#[mutants::skip]`  │
      └──────────────────────────┘                    └──────────────────────────┘
```

---

## 2. Common Surviving Mutant Patterns & Killing Test Recipes

### Pattern 1: Guard Operator Mutation (`>` changed to `>=`)

- **Injected Mutation:** `require!(amount > 0, ...)` replaced with `require!(amount >= 0, ...)`.
- **Why it Survived:** Test suite tested `amount = 5` and `amount = 10`, but never tested the exact boundary `amount = 0`.
- **Mutant-Killing Test Patch:**

```rust
#[test]
fn test_buy_bonds_fails_on_exact_zero_boundary() {
    let mut ctx = setup_pool(PoolStatus::Active);
    let err = send_buy_bonds(&mut ctx, 0).unwrap_err();
    assert!(err.contains("InvalidBondQuantity"));
}
```

### Pattern 2: Return Value Replaced with Default (`Ok(())`)

- **Injected Mutation:** Deleted check `require!(pool.is_frozen == false, ...)` inside `buy_bonds`.
- **Why it Survived:** Test suite never attempted to call `buy_bonds` while the pool was in frozen state.
- **Mutant-Killing Test Patch:**

```rust
#[test]
fn test_buy_bonds_fails_when_pool_is_frozen_for_draw() {
    let mut ctx = setup_pool_frozen_for_draw();
    let err = send_buy_bonds(&mut ctx, 10).unwrap_err();
    assert!(err.contains("AwaitingRandomnessFreeze"));
}
```

### Pattern 3: Arithmetic Expression Zeroed Out

- **Injected Mutation:** `let fee = (gross * fee_bps) / 10000;` replaced with `let fee = 0;`.
- **Why it Survived:** Test checked `assert!(tx.is_ok())` or `assert!(vault_balance > 0)` without asserting that the `fee_wallet` received the exact non-zero basis point fee.
- **Mutant-Killing Test Patch:**

```rust
#[test]
fn test_harvest_transfers_exact_fee_to_treasury() {
    let gross_yield = 1_000_000;
    let fee_bps = 500; // 5%
    let mut ctx = setup_harvest(gross_yield);

    let fee_wallet_before = get_fee_wallet_balance(&ctx);
    send_harvest(&mut ctx).unwrap();
    let fee_wallet_after = get_fee_wallet_balance(&ctx);

    assert_eq!(
        fee_wallet_after - fee_wallet_before,
        gross_yield * fee_bps / 10_000,
        "Mutant Killed: Fee treasury must receive exact calculated fee"
    );
}
```
