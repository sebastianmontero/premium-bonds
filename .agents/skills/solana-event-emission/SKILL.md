---
name: solana-event-emission
description: Comprehensive playbook and reference guide for designing, auditing, emitting, securing, and indexing events in Solana smart contracts (Anchor & Rust). Details the 5-Pillar Event Trigger Taxonomy, Missing Events Audit Methodology (SM-ECM), payload completeness standards (delta + state snapshots, Token-2022 net amounts, pre-closure finality), technical emission paradigms (`emit!`, `emit_cpi!`, `spl-noop`, `sol_log_data`), CU benchmarks, 10KB log buffer limits, anti-spoofing security via Event Authority PDAs (`#[event_cpi]`), vector batching, and off-chain indexing with Anchor EventParser, Yellowstone Geyser gRPC, Helius Webhooks, and LiteSVM test assertions.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, Solana SVM runtime
metadata:
  author: Solana Architecture & Security Team
  version: 2.0.0
---

# Solana Event Emission & Missing Events Audit Skill

## What this Skill is for

Use this Skill when:

- Determining **when an event MUST, SHOULD, or SHOULD NOT be emitted** across smart contract lifecycles.
- Conducting a **Missing Events Audit** to identify "dark state transitions" where account state is mutated without off-chain telemetry.
- Designing **rich, self-healing event payloads** (capturing `old_value` vs `new_value`, delta + post-state snapshots, and Token-2022 net received amounts).
- Enforcing **Account Closure Finality** events before Anchor clears account memory via `close = destination`.
- Choosing between **Program Log Emission (`emit!`)**, **Cryptographic CPI Emission (`emit_cpi!`)**, **SPL No-Op CPI (`spl-noop`)**, or direct **Syscall Emission (`sol_log_data`)**.
- Resolving **10 KB transaction log buffer limits**, `LogTruncated` runtime panics, or Compute Unit (CU) exhaustion caused by event logging.
- Securing event streams against **Event Spoofing Attacks** using Anchor 0.29+ `#[event_cpi]` and Event Authority PDAs (`__event_authority`).
- Implementing **Vector Batching** for high-frequency loops (DEX order fills, crank drawings, liquidations).
- Setting up off-chain indexers (**Anchor EventParser**, **Yellowstone Geyser gRPC**, **Helius Webhooks**, or `@solana/kit` listeners).
- Writing **LiteSVM Rust unit/integration test assertions** for event log and inner instruction verification.

---

## 1. When to Emit Events: The 5-Pillar Decision Framework

Solana accounts only store their **current, active state**. Past state transitions are permanently overwritten on-chain. Events provide the essential, zero-rent historical time-series for off-chain indexers, UIs, and security bots.

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

### Pillar Summary & Emission Rules:

1. **Pillar 1: Financial & Asset Flows (Value Movement)**
   - *Trigger*: Token transfers, mints, burns, swaps, staking, reward distributions, collateral deposits.
   - *Requirement*: Emit caller, target vault, gross/net amounts, pool share deltas, and **post-state aggregate snapshot** (`new_total_vault_deposits`).
   - *Token-2022 Invariant*: For tokens with transfer fees, always calculate and emit `net_amount_received` alongside gross requested amount.

2. **Pillar 2: Governance, Administration & Privilege Mutations**
   - *Trigger*: Authority transfers, parameter/fee updates, timelock adjustments, whitelist/blacklist changes.
   - *Requirement*: Always emit the acting `authority`, `config` account, **`old_value`**, and **`new_value`**.

3. **Pillar 3: Lifecycle Milestones & Account Closure Finality**
   - *Trigger*: Protocol bootstrapping (`init`), round/phase state shifts, and account closing (`close = destination`).
   - *Requirement*: Emit milestone events. For account closures, emit a finality event **immediately prior to completion** to record final payouts before account memory is zeroed out.

4. **Pillar 4: Crank, Keeper & Autonomous Actions**
   - *Trigger*: Liquidations, batch prize drawings, automated yield compounding, order book fills, stale account sweeps.
   - *Requirement*: Emit keeper identity, affected user keys, and execution results. For loops, use **Vector Batching** (`Vec<Summary>`).

5. **Pillar 5: Emergency & Risk Circuit Breakers**
   - *Trigger*: Emergency pauses, freeze toggles, bad debt socialization, oracle circuit breaker triggers.
   - *Requirement*: Emit trigger authority, reason code, affected accounts count, and timestamp.

### Negative Triggers (When NOT to Emit):
- ❌ **Pure Read/View Calls**: RPC `simulateTransaction` handles data return without consuming CUs on logs.
- ❌ **Internal Transient State**: Scratchpad calculations within instruction logic.
- ❌ **Unbatched Loop Iterations**: Emitting per loop iteration blows through the 10KB log buffer.
- ❌ **Cryptographic Secrets & VRF Seeds**: Never emit unhashed secrets or private keys in public logs.

---

## 2. Systematic Missing Events Audit Methodology

Use the **State Mutation vs. Event Cross-Matrix (SM-ECM)** during code reviews and security audits:

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
  Step 3: Construct the State Mutation vs. Event Cross-Matrix (SM-ECM).
    │
    ▼
  Step 4: Audit Event Payload Completeness (Context, Deltas, Old/New, Identifiers).
    │
    ▼
  Step 5: Verify via LiteSVM Integration Tests (Assert log messages and inner ix).
```

### SM-ECM Audit Checklist Matrix:

| Instruction | Mutated Accounts | 5-Pillar Category | Emitted Event | Payload Complete? | Verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `initialize_pool` | `pool`, `payer` | Pillar 3 (Lifecycle) | `PoolInitialized` | Yes (keys, initial config) | ✅ PASS |
| `deposit` | `vault`, `user_stake` | Pillar 1 (Financial) | `TokensDeposited` | Missing `post_vault_balance` | ⚠️ DEFICIENT |
| `set_fee` | `config` | Pillar 2 (Governance) | *None* | *None* | ❌ MISSING EVENT |
| `liquidate` | `user_collateral`, `loan`| Pillar 4 (Crank/Keeper) | `PositionLiquidated` | Yes (keeper, user, seized) | ✅ PASS |
| `close_account` | `user_account` (`close`) | Pillar 3 (Lifecycle) | *None* | *None* | ❌ MISSING EVENT |

---

## 3. Technical Paradigm Selection & Anti-Spoofing Matrix

```
                                  EVENT EMISSION DESIGN DECISION TREE
                                                   │
                 ┌─────────────────────────────────┴─────────────────────────────────┐
                 ▼                                                                   ▼
       FINANCIAL / SECURITY CRITICAL                                      STANDARD APP EVENT / AUDIT TRAIL
  (e.g., Vault Deposits, Liquidations)                                 (e.g., User Profile Updates, Settings)
                 │                                                                   │
                 ▼                                                                   ▼
    NEEDS SPOOFING IMMUNITY?                                               INSTRUCTION ACCOUNT CAPACITY?
                 │                                                                   │
        ┌────────┴────────┐                                                 ┌────────┴────────┐
        ▼                 ▼                                                 ▼                 ▼
   YES (Anchor)       YES (Native)                                      CONSTRAINED       UNCONSTRAINED
        │                 │                                                 │                 │
        ▼                 ▼                                                 ▼                 ▼
 ┌─────────────┐   ┌─────────────┐                                   ┌─────────────┐   ┌─────────────┐
 │ `emit_cpi!` │   │ `spl-noop`  │                                   │   `emit!`   │   │ `emit_cpi!` │
 │ (Event PDA) │   │ (No-Op CPI) │                                   │ (Log-based) │   │ (Event PDA) │
 └─────────────┘   └─────────────┘                                   └─────────────┘   └─────────────┘
```

### Paradigm Comparison Summary

| Metric / Requirement         | `emit!` (Anchor Log) | `emit_cpi!` (Anchor CPI)                        | `spl-noop` (No-Op CPI)           | `sol_log_data` (Syscall) |
| :--------------------------- | :------------------- | :---------------------------------------------- | :------------------------------- | :----------------------- |
| **Compute Units (CU)**       | ~1,200 – 2,200 CUs   | ~2,500 – 4,500 CUs                              | ~1,800 – 2,800 CUs               | ~600 – 1,200 CUs         |
| **Log Buffer (10 KB Limit)** | Consumes log buffer  | **Bypasses log buffer**                         | **Bypasses log buffer**          | Consumes log buffer      |
| **Extra Accounts Needed**    | 0 extra accounts     | 2 extra accounts (`event_authority`, `program`) | 1 extra account (`noop_program`) | 0 extra accounts         |
| **Anti-Spoofing Immunity**   | Low (Text parsing)   | **Cryptographic (Event PDA)**                   | **High (CPI Target Check)**      | Low (Text parsing)       |
| **Program Attribute**        | None                 | Requires `#[event_cpi]` on `#[program]`         | None                             | None                     |
| **Off-Chain Indexability**   | Log Filter / IDL     | Inner Instructions / gRPC                       | Inner Instructions / gRPC        | Log Filter               |

---

## 4. Master Event Emission & Audit Checklist

Before deploying any Solana program to production, audit all event implementations against this checklist:

- [ ] **Missing Events Audit**: Has every instruction modifying state (`#[account(mut)]`) been cross-checked against the 5-Pillar Trigger Taxonomy?
- [ ] **Governance Audit Trails**: Do all administrative setter instructions emit both `old_value` and `new_value` alongside the acting `authority`?
- [ ] **Account Closure Finality**: Are closing accounts (`close = destination`) emitting a pre-closure finality event capturing final balances before account data is cleared?
- [ ] **Self-Healing Telemetry**: Do financial events emit both the incremental delta and the resulting cumulative aggregate (`new_total_deposits`)?
- [ ] **Token-2022 Net Amounts**: Are token transfers with possible transfer fees logging actual net credited vault balance changes?
- [ ] **Spoofing Resistance**: Are critical financial and governance events emitted via `emit_cpi!` with `#[event_cpi]` or verified with strict log stack depth tracking?
- [ ] **Log Buffer & Vector Batching**: Is loop logging aggregated into a single vector event (`Vec<T>`) sized under the 10,240 byte buffer ceiling?
- [ ] **Data Privacy & VRF**: Are private keys, PII, and unmasked commitment seeds strictly excluded from event structs?
- [ ] **LiteSVM Testing Coverage**: Does the Rust test suite assert log outputs for `emit!` and `inner_instructions` for `emit_cpi!`?

---

## Detailed Research References & Playbooks

For complete architectural deep-dives, mathematical cost breakdowns, and integration guides, refer to:

1. 📖 **[Event Trigger Taxonomy & Missing Events Audit Playbook](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/event-trigger-taxonomy-and-missing-events-audit.md)**
   - The Solana state vs event dichotomy and the cost of dark state transitions.
   - Comprehensive breakdown of all 5 event pillars with code examples.
   - Information deficiency anti-patterns and self-healing telemetry.
   - The 5-Step SM-ECM missing event audit process.

2. 📖 **[Event Emission Paradigms & Benchmark Specifications](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/event-paradigms-and-benchmarks.md)**
   - Detailed analysis of `emit!`, `emit_cpi!`, `spl-noop`, and `sol_log_data`.
   - CU usage benchmarks, Base64 payload bloat calculations, and 10 KB log buffer constraints.
   - Vector batching sizing formula and zero-copy memory slicing.

3. 📖 **[Security, Anti-Spoofing & Privacy in Event Emission](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/security-and-anti-spoofing.md)**
   - Log spoofing attack vectors and cross-program invocation risks.
   - Anchor 0.29+ `#[event_cpi]` and Event Authority PDA (`__event_authority`) setup.
   - Protecting governance parameter updates against log spoofing.
   - Data privacy standards and commit-reveal randomness rules.

4. 📖 **[Off-Chain Event Indexing, Client SDKs & Testing Integration](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/references/offchain-indexing-and-clients.md)**
   - Indexing governance deltas and pre-closure finality tombstones.
   - Off-chain integration patterns with Anchor `EventParser` and `@coral-xyz/anchor`.
   - Modern `@solana/client` / `@solana/kit` manual discriminator decoding.
   - Yellowstone Geyser gRPC inner instruction filtering for CPI events.
   - LiteSVM Rust integration test patterns for log and inner instruction assertions.

---

## Code Examples

- 🛠️ **[Anchor Events Showcase](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-event-emission/examples/anchor-events-showcase.rs)**: Complete Anchor program demonstrating `#[event_cpi]`, self-healing deposits (Pillar 1), admin fee changes with `old_value` -> `new_value` (Pillar 2), pre-closure position finality (Pillar 3), batched crank liquidations (Pillar 4), and secure CPI emissions.
