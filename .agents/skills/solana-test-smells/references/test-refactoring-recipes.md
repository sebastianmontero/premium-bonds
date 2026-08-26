# Test Refactoring Recipes (Before & After Code Diff Playbook)

This reference document provides concrete, paired **Before (Smelly/Coupled)** and **After (Clean/Intent-Driven)** code refactoring recipes for Rust (Anchor/LiteSVM) and TypeScript (React/Framework-Kit).

---

## 1. Tautological Assertion / Copy-Paste Math

### ❌ Before (Smelly / Tautological Math):

```rust
#[test]
fn test_harvest_fees() {
    let gross_yield = 100_000;
    let fee_bps = 500;

    // SMELL: Re-implementing the exact production arithmetic in the test
    let expected_fee = (gross_yield * fee_bps) / 10_000;

    let mut ctx = setup_harvest(gross_yield);
    send_harvest(&mut ctx).unwrap();

    let fee_collected = get_fee_wallet_balance(&ctx);
    assert_eq!(fee_collected, expected_fee);
}
```

### ✅ After (Intent-Driven Invariant Assertion):

```rust
#[test]
fn test_harvest_conserves_solvency_and_respects_fee_bounds() {
    let gross_yield = 100_000;
    let mut ctx = setup_harvest(gross_yield);

    let vault_before = get_vault_balance(&ctx);
    let fee_wallet_before = get_fee_wallet_balance(&ctx);

    send_harvest(&mut ctx).unwrap();

    let vault_after = get_vault_balance(&ctx);
    let fee_wallet_after = get_fee_wallet_balance(&ctx);
    let fee_collected = fee_wallet_after - fee_wallet_before;

    // Invariant 1: Fee adheres strictly to configured ceiling
    assert!(fee_collected <= gross_yield * 500 / 10_000, "Fee exceeded basis point ceiling");

    // Invariant 2: Conservation of assets (vault + fees == total initial + gross yield)
    assert_eq!(
        vault_after + fee_collected,
        vault_before + gross_yield,
        "Invariant Broken: Gross harvested yield was not fully conserved"
    );
}
```

---

## 2. Primitive Error Matching

### ❌ Before (Smelly / Primitive Error Match):

```rust
#[test]
fn test_buy_bonds_when_paused() {
    let mut ctx = setup_pool(PoolStatus::Paused);
    let res = send_buy_bonds(&mut ctx, 10);

    // SMELL: Merely checking for any error or loose substring
    assert!(res.is_err());
    assert!(res.unwrap_err().contains("Error"));
}
```

### ✅ After (Strict Typed Anchor Error Matching):

```rust
#[test]
fn test_buy_bonds_fails_with_pool_not_active_when_paused() {
    let mut ctx = setup_pool(PoolStatus::Paused);
    let err = send_buy_bonds(&mut ctx, 10).unwrap_err();

    // INTENT: Verify exact custom error variant and code
    assert!(
        err.contains("PoolNotActive") || err.contains("6001"),
        "Expected ErrorCode::PoolNotActive (6001), got: {err}"
    );
}
```

---

## 3. Whitebox Over-Fitting vs Observable State (TypeScript / React)

### ❌ Before (Smelly / Internal Hook State Peeking):

```typescript
it("updates ticket balance on buy", async () => {
  const { result } = renderHook(() => useBondStore());

  // SMELL: Asserting on private internal counter fields
  await act(async () => {
    await result.current._internalSyncTickets(5);
  });

  expect(result.current._scratchpadTicketCount).toBe(5);
});
```

### ✅ After (Intent-Driven User Journey):

```typescript
it('displays updated bond balance after confirmed purchase', async () => {
  render(<BondPurchaseCard poolId={1} />);

  const input = screen.getByLabelText(/bonds to purchase/i);
  const buyBtn = screen.getByRole('button', { name: /buy bonds/i });

  await userEvent.type(input, '5');
  await userEvent.click(buyBtn);

  // INTENT: Asserts the user-observable outcome in the UI
  expect(await screen.findByText(/5 active bonds/i)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
```

---

## 4. Slot & Clock Illusion (Time Travel)

### ❌ Before (Smelly / Struct Mutation Illusion):

```rust
#[test]
fn test_draw_unlock_after_24h() {
    let mut ctx = setup_draw();

    // SMELL: Mutating struct field directly without warping SVM Clock sysvar
    let mut pool = get_pool(&ctx);
    pool.draw_freeze_slot = 100;
    save_pool(&mut ctx, pool);

    let res = send_unlock(&mut ctx);
    assert!(res.is_ok());
}
```

### ✅ After (LiteSVM Clock Warping):

```rust
#[test]
fn test_draw_unlock_succeeds_after_crank_timeout_expires() {
    let mut ctx = setup_draw();
    let freeze_slot = 1000;
    let timeout_slots = 216_000; // 24 hours in Solana slots

    // INTENT: Warp blockchain clock sysvar forward across the boundary
    ctx.svm.warp_to_slot(freeze_slot + timeout_slots + 1);

    let res = send_crank_unlock(&mut ctx);
    assert!(res.is_ok(), "Expected crank unlock to succeed after timeout window: {:?}", res);

    let pool_after = get_pool(&ctx);
    assert!(!pool_after.is_frozen, "Pool must be un-frozen after timeout crank");
}
```
