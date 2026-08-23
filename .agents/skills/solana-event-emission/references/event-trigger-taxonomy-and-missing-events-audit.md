# Solana Event Trigger Taxonomy & Missing Events Audit Playbook

## 1. The Solana State vs. Event Dichotomy

Unlike Ethereum where account storage history can be derived or state trie proofs can be requested, Solana's SVM maintains only the **current, active state** of an account. 

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                             SVM EXECUTION TIMELINE                               │
└──────────────────────────────────────────────────────────────────────────────────┘
   Slot N: Account State = { balance: 100, owner: Alice }
     │
     ▼ (Transaction: Deposit 50)
   Slot N+1: Account State = { balance: 150, owner: Alice }  <-- Overwrites Slot N!
```

### The Cost of Missing Events ("Dark State Transitions")
When an instruction mutates account state without emitting an event:
1. **Off-Chain Indexer Blindness**: Yellowstone Geyser, Helius Webhooks, and custom indexers cannot distinguish *what* business action occurred without reverse-engineering raw byte diffs.
2. **Account Closure Oblivion**: When an account is closed via Anchor's `close = destination`, its entire data buffer is zeroed out and reclaimed. Without a pre-close event, the final settled balance and closing status are permanently erased from account state.
3. **Frontend UI Stale State**: Web3 applications relying on WebSocket event listeners fail to detect user actions or background crank updates, causing optimistic UI desynchronization.
4. **Security & Risk Monitoring Blindspots**: Automated liquidation bots, circuit breakers, and anomaly detection watchers are blinded to privilege escalations, fee spikes, or flash loan balance fluctuations.

---

## 2. The 5-Pillar Event Trigger Taxonomy

Every state-changing instruction in a Solana program falls into at least one of five architectural pillars. Use this matrix to determine mandatory event emissions:

```
                                    5-PILLAR EVENT TRIGGER MATRIX
                                                  │
         ┌───────────────────┬────────────────────┼───────────────────┬───────────────────┐
         ▼                   ▼                    ▼                   ▼                   ▼
    PILLAR 1:           PILLAR 2:            PILLAR 3:           PILLAR 4:           PILLAR 5:
    FINANCIAL &         GOVERNANCE &         LIFECYCLE &         CRANK, KEEPER &     EMERGENCY &
    ASSET FLOWS         ADMIN MUTATIONS      STATE TRANSITIONS   BOT ACTIONS         CIRCUIT BREAKERS
   (Deposits, Swaps)   (Fees, Authorities)  (Init, Closures)    (Liquidations)      (Pauses, Freezes)
```

---

### Pillar 1: Financial & Asset Flows (Value-Moving Operations)

**Rule**: Any instruction that transfers SPL tokens, SOL/lamports, mints tokens, burns tokens, or alters pool share balances **MUST** emit an event.

#### Required Payload Fields:
- `caller` / `user`: The initiating signer (`Pubkey`).
- `vault` / `pool`: The target pool or vault (`Pubkey`).
- `amount`: Token base units transferred (`u64`).
- `shares_minted` / `shares_burned`: Pool or LP shares affected (`u64`).
- `post_vault_balance`: Vault balance *after* the mutation (enables self-healing indexers).
- `timestamp`: Unix timestamp (`Clock::get()?.unix_timestamp`).

#### Token-2022 Net vs. Gross Invariant:
When transferring Token-2022 mints that may incur **Transfer Fees** or interest hooks, never log only the requested gross transfer amount. Record both gross and net amounts received by the vault:

```rust
// ❌ BAD: Emits gross amount; indexer balance diverges from actual on-chain ATA balance
emit!(TokensDeposited {
    user: ctx.accounts.user.key(),
    amount: requested_amount,
});

// ✅ GOOD: Records gross requested vs actual net tokens credited to vault
let balance_before = ctx.accounts.vault.amount;
// ... perform token transfer CPI ...
ctx.accounts.vault.reload()?;
let net_amount = ctx.accounts.vault.amount.checked_sub(balance_before).unwrap();

emit!(TokensDeposited {
    user: ctx.accounts.user.key(),
    vault: ctx.accounts.vault.key(),
    gross_amount: requested_amount,
    net_amount,
    new_vault_balance: ctx.accounts.vault.amount,
    timestamp: Clock::get()?.unix_timestamp,
});
```

---

### Pillar 2: Governance, Administration & Privilege Mutations

**Rule**: Any instruction that alters protocol configuration, fees, authorities, whitelists, or risk parameters **MUST** emit an event recording both **prior (`old_value`)** and **updated (`new_value`)** parameters.

#### Required Payload Fields:
- `admin` / `authority`: The admin signer who executed the change (`Pubkey`).
- `parameter_name`: Identifier or field modified.
- `old_value`: Previous setting.
- `new_value`: New active setting.
- `timestamp`: Unix timestamp.

```rust
// ❌ BAD: Missing previous value and authority; impossible to audit historical fee changes
pub fn update_fee(ctx: Context<UpdateFee>, new_fee_bps: u16) -> Result<()> {
    ctx.accounts.config.fee_bps = new_fee_bps;
    // No event or incomplete event
    Ok(())
}

// ✅ GOOD: Complete audit trail with before/after state
pub fn update_fee(ctx: Context<UpdateFee>, new_fee_bps: u16) -> Result<()> {
    let old_fee_bps = ctx.accounts.config.fee_bps;
    ctx.accounts.config.fee_bps = new_fee_bps;

    emit!(FeeBpsUpdated {
        authority: ctx.accounts.authority.key(),
        config: ctx.accounts.config.key(),
        old_fee_bps,
        new_fee_bps,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
```

---

### Pillar 3: Protocol Lifecycle Milestones & Account Closures

**Rule**: Every entity creation (`init`), phase shift (e.g. Round Started -> Drawing -> Settled), and account destruction (`close = destination`) **MUST** emit an event.

#### The Account Closure Finality Standard:
Anchor's `close = destination` zeroes out the account's data buffer and transfers its lamports to the destination in the same transaction. An event emitted **immediately prior** to completion is the **final immutable proof** of the account's closed state and final payout values.

```rust
// ✅ GOOD: Pre-closure finality event
pub fn close_stake_position(ctx: Context<CloseStakePosition>) -> Result<()> {
    let position = &ctx.accounts.position;
    let final_reward = calculate_rewards(position)?;

    // Emit finality event BEFORE Anchor clears memory
    emit!(StakePositionClosed {
        user: ctx.accounts.user.key(),
        position: position.key(),
        principal_returned: position.amount,
        final_reward_paid: final_reward,
        timestamp: Clock::get()?.unix_timestamp,
    });

    // ... perform token transfers ...
    // Anchor will zero account data and reclaim rent via #[account(close = user)]
    Ok(())
}
```

---

### Pillar 4: Autonomous, Crank & Keeper Operations

**Rule**: Any instruction designed to be triggered by off-chain bots, keepers, or cranks (e.g. liquidations, automated compounding, prize drawings, stale order sweeps) **MUST** emit an event.

#### Rationale:
Users do not sign keeper transactions. Without explicit events, users cannot be notified when their positions were liquidated, orders were filled, or yield was harvested.

```rust
#[event]
pub struct PositionLiquidated {
    pub keeper: Pubkey,
    pub borrower: Pubkey,
    pub collateral_seized: u64,
    pub debt_repaid: u64,
    pub liquidation_penalty_fee: u64,
    pub timestamp: i64,
}
```

---

### Pillar 5: Emergency, Circuit Breakers & Risk Events

**Rule**: Any instruction that triggers a freeze, circuit breaker pause, bad debt socialization, or emergency withdrawal **MUST** emit an event.

#### Required Payload Fields:
- `trigger_authority`: Signer or oracle that triggered the breaker (`Pubkey`).
- `reason_code`: Code or enum indicating trigger condition.
- `affected_accounts_count` / `bad_debt_absorbed`: Quantified financial impact.
- `timestamp`: Unix timestamp.

---

## 3. Negative Triggers: When NOT to Emit Events

Emitting unnecessary events consumes Compute Units (~1,200 – 4,500 CUs per emission) and risks exceeding the **10,240 byte (10 KB) transaction log limit**.

| Scenario | Recommendation | Rationale |
| :--- | :--- | :--- |
| **Pure Read/View Instructions** | ❌ **DO NOT EMIT** | State is unmutated; RPC `simulateTransaction` returns return data directly. |
| **Internal Transient Computations** | ❌ **DO NOT EMIT** | Intermediate scratchpad state during mathematical calculations adds noise and waste. |
| **Unbatched High-Frequency Loops** | ❌ **DO NOT EMIT IN LOOPS** | Emitting per iteration blows the 10KB log buffer. Use **Vector Batching** (`Vec<Summary>`). |
| **Cryptographic Secrets & VRF Seeds** | ❌ **NEVER EMIT** | On-chain logs are public and permanent. Emit only commitment hashes (`sha256(secret)`). |
| **Redundant "Touch" Timestamps** | ❌ **DO NOT EMIT** | If an instruction only refreshes a timestamp without altering business state, skip event. |

---

## 4. Information Deficiency Anti-Patterns

Avoid these 6 common event design anti-patterns:

### 1. "Silent Mutation"
- **Anti-Pattern**: Mutating an account without emitting an event.
- **Fix**: Add an event corresponding to the modified state.

### 2. "Blind Event" (Contextless)
- **Anti-Pattern**: `emit!(Deposited { amount });` (Missing `user` and `vault`).
- **Fix**: Always include acting authority and affected entity keys.

### 3. "Delta-Less Admin Setter"
- **Anti-Pattern**: `emit!(FeeChanged { new_fee });` (Missing `old_fee` and `admin`).
- **Fix**: Include `old_value`, `new_value`, and `authority`.

### 4. "Post-Closure Oblivion"
- **Anti-Pattern**: Closing an account via `close = ...` without an event recording final payouts.
- **Fix**: Emit a `*Closed` event with final balances immediately prior to closure.

### 5. "Gross vs. Net Confusion"
- **Anti-Pattern**: Emitting user-input transfer amount when Token-2022 transfer fees deduct tokens in transit.
- **Fix**: Query and log `net_amount = balance_after - balance_before`.

### 6. "Loop Log Bomb"
- **Anti-Pattern**: `for item in items { emit!(ItemProcessed { ... }); }`
- **Fix**: Aggregate into a single event: `emit!(BatchProcessed { items: vec![...] });`.

---

## 5. The 5-Step Missing Events Audit Framework

Follow this deterministic 5-step methodology during code reviews and security audits:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   5-STEP MISSING EVENTS AUDIT PLAYBOOK                           │
└──────────────────────────────────────────────────────────────────────────────────┘
  Step 1: Inventory all mutable accounts (#[account(mut)]) across every instruction.
    │
    ▼
  Step 2: Map each instruction to the 5-Pillar Trigger Taxonomy.
    │
    ▼
  Step 3: Construct the State Mutation vs. Event Matrix (SM-ECM).
    │
    ▼
  Step 4: Audit Event Payload Completeness (Context, Deltas, Old/New, Identifiers).
    │
    ▼
  Step 5: Verify via LiteSVM Integration Tests (Assert log messages and inner ix).
```

### State Mutation vs. Event Matrix (SM-ECM) Template:

| Instruction | Mutated Accounts | 5-Pillar Category | Emitted Event | Payload Complete? | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `initialize_pool` | `pool`, `payer` | Pillar 3 (Lifecycle) | `PoolInitialized` | Yes (keys, initial config) | ✅ PASS |
| `deposit` | `vault`, `user_stake` | Pillar 1 (Financial) | `TokensDeposited` | Missing `post_vault_balance` | ⚠️ DEFICIENT |
| `set_fee` | `config` | Pillar 2 (Governance) | *None* | *None* | ❌ MISSING EVENT |
| `liquidate` | `user_collateral`, `loan`| Pillar 4 (Crank/Keeper) | `PositionLiquidated` | Yes (keeper, user, seized) | ✅ PASS |
| `close_account` | `user_account` (`close`) | Pillar 3 (Lifecycle) | *None* | *None* | ❌ MISSING EVENT |

---

## 6. Self-Healing Event Telemetry: "Delta + Post-State Snapshot"

For cumulative global variables (total deposits, pool debt, reward accumulators), network hiccups or indexer disconnections can cause off-chain state to drift if only delta values are logged.

### The Self-Healing Pattern:
```rust
#[event]
pub struct PoolDepositRecorded {
    pub user: Pubkey,
    pub pool: Pubkey,
    pub delta_amount: u64,           // Incremental change
    pub new_total_pool_deposits: u64, // Aggregate snapshot for reconciliation
    pub user_total_deposited: u64,    // User cumulative snapshot
    pub timestamp: i64,
}
```

**Why this works**: If an off-chain indexer misses event $N$, receiving event $N+1$ allows the indexer to detect that its internal total does not match `new_total_pool_deposits` and trigger an automated reconciliation resync.
