# LiteSVM Testing & Mocking Patterns

This document details common testing patterns for Anchor integration tests in YieldBonds, utilizing `LiteSVM` for in-process state injection and validation.

---

## 1. Account Injection (Mocking State)

Because LiteSVM executes compiled SBF bytecode on-chain, we can bypass complex setup sequences by directly injecting mocked accounts into the SVM state before executing transactions.

### Injecting a Mint

To mock a SPL Token Mint:

```rust
fn inject_mint(svm: &mut LiteSVM, address: Pubkey, decimals: u8) {
    let mut data = vec![0u8; 82];
    data[36..44].copy_from_slice(&u64::MAX.to_le_bytes()); // max supply
    data[44] = decimals;
    data[45] = 1; // is_initialized = true
    svm.set_account(
        address,
        Account {
            lamports: 1_000_000_000,
            data,
            owner: anchor_spl::token::ID,
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}
```

### Injecting User Winnings

To inject a `UserWinnings` PDA:

```rust
fn inject_user_winnings(
    svm: &mut LiteSVM,
    pool_id: u32,
    user: Pubkey,
    unclaimed: u64,
    total_claimed: u64,
    total_reinvested: u64,
) {
    let (pda, bump) = user_winnings_pda(pool_id, &user);
    let uw = anchor::state::UserWinnings {
        pool_id,
        user,
        unclaimed_non_reinvested_winnings: unclaimed,
        total_claimed,
        total_reinvested,
        bump,
    };
    let mut d = vec![];
    uw.try_serialize(&mut d).unwrap();
    d.resize(8 + anchor::state::UserWinnings::INIT_SPACE, 0);
    svm.set_account(
        pda,
        Account {
            lamports: 10_000_000,
            data: d,
            owner: anchor::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();
}
```

---

## 2. Testing Checked Arithmetic Overflows

To verify error paths for `MathOverflow` checks, initialize PDA states with values set at `u64::MAX` or close to it, then execute the instruction.

### Total Claimed Overflow (Claim Non-Reinvested Winnings)

If an instruction does `total_claimed.checked_add(claimable)`:

```rust
#[test]
fn test_claim_fails_total_claimed_overflow() {
    let mut ctx = setup_claim_guard(100, anchor::PoolStatus::Active);
    // Inject total_claimed = u64::MAX
    inject_user_winnings(
        &mut ctx.svm,
        1,
        ctx.user.pubkey(),
        100,            // unclaimed (to claim)
        u64::MAX,       // total_claimed (overflow trigger)
        0,              // total_reinvested
    );
    let err = send_claim(&mut ctx, 1).unwrap_err();
    assert!(err.contains("MathOverflow"), "expected MathOverflow, got: {err}");
}
```

### Total Reinvested Overflow (Reinvest Winnings)

If an instruction does `total_reinvested.checked_add(cost)`:

```rust
#[test]
fn test_reinvest_fails_total_reinvested_overflow() {
    // 1 bond price = 1_000_000, winnings owed = 1_000_000
    let mut ctx = setup(anchor::PoolStatus::Active, false, 1_000_000, 1_000_000, 0);
    // Inject total_reinvested = u64::MAX
    inject_user_winnings(
        &mut ctx.svm,
        1,
        ctx.winner,
        0,
        0,
        u64::MAX,       // total_reinvested (overflow trigger)
    );
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("MathOverflow"), "expected MathOverflow, got: {err}");
}
```

---

## 3. Testing Pool Status Guards

Validate state transitions by changing the pool's status flag or freeze flag and asserting correct error responses.

### Paused Pool Guard

```rust
#[test]
fn test_reinvest_fails_pool_not_active() {
    let mut ctx = setup(anchor::PoolStatus::Paused, false, 1_000_000, 3_000_000, 0);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("PoolNotActive"), "got: {err}");
}
```

### Frozen Pool (Awaiting Randomness) Guard

```rust
#[test]
fn test_reinvest_fails_pool_frozen() {
    let mut ctx = setup(anchor::PoolStatus::Active, true, 1_000_000, 3_000_000, 0);
    let err = send(&mut ctx, 0, 0, 10).unwrap_err();
    assert!(err.contains("AwaitingRandomnessFreeze"), "got: {err}");
}
```
