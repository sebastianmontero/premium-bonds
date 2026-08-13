---
name: solana-adversarial-review
description: Comprehensive playbook, vulnerability taxonomy, and empirical testing protocol for conducting adversarial security reviews of Solana smart contracts (Anchor, Pinocchio, SBF Native). Focuses on red-teaming, invariant breaking, exploit PoC generation with LiteSVM, CPI reentrancy, account revival, seed collisions, Token-2022 hooks, and DeFi math exploits.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, LiteSVM / cargo-test
metadata:
  author: Solana Security & Red Team Practice
  version: 1.0.0
---

# Solana Smart Contract Adversarial Review Skill

## Overview & Purpose

This Skill equips an AI agent to perform **expert-level adversarial security reviews (red-teaming and threat auditing)** on Solana smart contracts developed in Rust using the **Anchor framework**, **Pinocchio**, or **Native SBF**.

Unlike passive code auditing or checklist-based code reviews, an **Adversarial Reviewer** thinks like an attacker: searching for state machine desynchronization, composite exploit chains, PDA seed collisions, privilege escalation via CPI signer forwarding, account revival tricks, Token-2022 transfer hook side-effects, share inflation/rounding math bugs, and oracle manipulation vectors.

---

## Part 1: Expert Knowledge Matrix for Solana Adversarial Reviewers

An expert adversarial reviewer must master six specialized security domains unique to Solana's stateless runtime architecture:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SOLANA ADVERSARIAL REVIEW KNOWLEDGE MATRIX                      │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌──────────────────┬────────────────────┼────────────────────┬───────────────────┐
    ▼                  ▼                    ▼                    ▼                   ▼
┌──────────────┐ ┌──────────────┐ ┌────────────────────┐ ┌───────────────┐ ┌─────────────────┐
│ 1. SVM Memory│ │ 2. Anchor &  │ │ 3. CPI Privilege   │ │ 4. DeFi Math  │ │ 5. Token-2022   │
│ & Revival    │ │    Constraint│ │    Escalation &    │ │    & Share    │ │    & Transfer   │
│ Architecture │ │    Bypasses  │ │    Signer Leaks    │ │    Inflation  │ │    Hook Vectors │
└──────────────┘ └──────────────┘ └────────────────────┘ └───────────────┘ └─────────────────┘
```

### 1. SVM Memory Architecture, SBF Bytecode & Account Lifecycle

- **Stateless Account Execution Model**: Programs are immutable bytecodes executing on external state passed via `AccountInfo` slices. The runtime enforces ownership: only program `P` can alter account `A`'s data or deduct lamports if `A.owner == P`.
- **Account Revival & Same-Slot Garbage Collection**:
  - Closing an account in Solana reduces its lamports to 0. However, the runtime does **not** erase the memory buffer until the end of the slot.
  - If a program fails to zero out account data and reset the Anchor discriminator (`CLOSED_ACCOUNT_DISCRIMINATOR = [255, 255, 255, 255, 255, 255, 255, 255]`), an attacker can refund the account within the _same transaction_ to revive stale state and bypass initialization checks.
- **PDA Canonical Bump Enforcement**:
  - `Pubkey::find_program_address` searches downwards from bump 255 to find the first off-curve address (the canonical bump).
  - If a program verifies PDAs using `Pubkey::create_program_address` with a user-supplied bump without checking `bump == canonical_bump`, an attacker can supply valid non-canonical off-curve bumps to alias PDAs or create duplicate state accounts.
- **Compute Budget & Memory Alignment**:
  - SBF stack is hard-limited to 4KB; heap is 32KB. Unchecked stack allocation leads to silent memory corruption or execution panics.
  - Zero-copy structs (`#[account(zero_copy)]` / `Pod`) require strict 8-byte memory alignment. `sol_memcpy` or unaligned byte transmutes trigger SBF panics that adversaries can trigger to cause Denial of Service (DoS).

### 2. Anchor Framework Constraint Bypasses & Account Context Hijacking

- **Duplicate Account Injection**:
  - Attacker passes the _same_ account address for two distinct parameters in `#[derive(Accounts)]` (e.g., setting both `user_vault` and `protocol_fee_vault` to the attacker's ATA). Unless explicit `constraint = acc1.key() != acc2.key()` or distinct PDA seeds are derived, double-crediting occurs.
- **`UncheckedAccount` & Missing `/// CHECK:` Semantics**:
  - Using raw `AccountInfo` without explicit manual validation of `owner`, `key`, or state discriminator allows arbitrary account substitution (e.g., substituting system account or attacker-owned state for a vault).
- **`realloc` Zero-Initialization Traps**:
  - Expanding an account via `#[account(realloc = new_size, realloc::payer = ..., realloc::zero = false)]` leaves newly allocated memory dirty. If read prior to writing, attackers can exploit stale heap data or uninitialized bytes.
- **Account Type Confusion & Discriminator Collisions**:
  - Native Rust contracts or custom structs lacking 8-byte Anchor SHA-256 discriminators permit type confusion where account type `A` is parsed as account type `B`, exposing privileged fields.

### 3. Cross-Program Invocation (CPI) Privilege Escalation & Signer Leaks

- **Signer Forwarding Leakage**:
  - When program `A` executes `invoke_signed` to call program `B` with PDA seeds, all PDA signers from `A` are visible to `B`. If `B` is an arbitrary user-controlled program, `B` can issue a CPI to program `C` (e.g. SPL Token) using `A`'s PDA signers to drain `A`'s vaults!
- **Arbitrary CPI Target Substitution**:
  - If a instruction accepts `token_program` or `system_program` as an `UncheckedAccount` without checking `token_program.key() == spl_token::ID` or `spl_token_2022::ID`, an attacker can pass a malicious program ID that logs dummy success while skipping token transfers.
- **Context Hijacking in External Integrations**:
  - CPIs into complex protocols (e.g., Kamino, Solend, Raydium) require explicit verification of all secondary accounts (reserve liquidity mint, collateral mint, instruction sysvar, pool authority).

### 4. DeFi Financial Invariants, Rounding & Share Inflation

- **First-Depositor Share Inflation (ERC4626 / Vault Attack)**:
  - In vault protocols calculating `shares = (amount * total_shares) / total_assets`:
  - Attacker deposits 1 lamport to mint 1 share.
  - Attacker directly transfers a huge token balance (e.g. 10,000 SOL) straight into the vault ATA without calling `deposit()`.
  - Now `total_assets = 10,000 SOL` and `total_shares = 1`.
  - Next victim deposits 9,999 SOL. Their shares evaluation: `(9,999 * 1) / 10,000 = 0` shares minted due to integer division truncation! Victim loses funds, attacker burns 1 share to withdraw all 19,999 SOL.
- **Rounding Direction Exploitation**:
  - Fee calculations MUST round UP in favor of the protocol (`ceil_div`). If fee calculation uses standard integer truncation (`(amount * fee_bps) / 10000`), small transfers pay 0 fee.
  - Payout calculations MUST round DOWN (`floor_div`). Rounding payouts up allows iterative dust extraction attacks.
- **Internal Accounting vs Real Balance Drift**:
  - Relying on `token_account.amount` vs `vault_state.total_deposited`. Direct transfers, burns, or fee distributions cause state drift if not explicitly synchronized.

### 5. Token-2022 Extension & Transfer Hook Vectors

- **Transfer Hook CPI Side-Channel Exploits**:
  - Mints using Token-2022 `Transfer Hook` execute an external CPI to a designated program on every transfer (`ExecuteInstruction`).
  - Adversaries craft malicious Transfer Hook handlers to trigger cross-program reentrancy, modify external state before vault balances update, or fail conditionally to cause selective DoS on liquidity pools.
- **Fee-on-Transfer & Interest-Bearing Token Desynchronization**:
  - Passing Token-2022 fee-on-transfer tokens into naive vaults expecting `transferred_amount == received_amount` breaks accounting invariants unless `amount_received` is queried post-transfer.

### 6. Oracle Manipulation & Timestamp Desynchronization

- **Pyth / Switchboard Confidence Interval & Staleness Exploits**:
  - Missing `price_account.get_price_no_older_than(clock.unix_timestamp, MAX_AGE)` check allows stale prices during network congestion.
  - Failing to check `price.confidence` relative to `price.price` (`confidence / price > MAX_CONFIDENCE_RATIO`). In volatile markets, wide confidence intervals allow trading at unrealistic spot prices.
  - Relying on `Clock::get()?.unix_timestamp` instead of `Clock::get()?.slot` for time-sensitive logic (validators can drift unix timestamp by minutes, whereas slot growth is monotonic).

---

## Part 2: Adversarial Review Workflow & Playbook

When performing an adversarial review, execute this 5-stage protocol:

```
┌─────────────────┐     ┌─────────────────────┐     ┌────────────────────────┐
│ Stage 1:        │ ──► │ Stage 2:            │ ──► │ Stage 3:               │
│ Threat Surface  │     │ Invariant & Attack  │     │ Deterministic LiteSVM  │
│ & Invariant Map │     │ Vector Formulation  │     │ Exploit PoC Creation   │
└─────────────────┘     └─────────────────────┘     └───────────┬────────────┘
                                                                │
┌─────────────────┐     ┌─────────────────────┐                 │
│ Stage 5:        │ ◄── │ Stage 4:            │ ◄───────────────┘
│ Non-Regression  │     │ Defensive Patching  │
│ & Verification  │     │ & RCA Report        │
└─────────────────┘     └─────────────────────┘
```

### Stage 1: Threat Surface & Invariant Mapping

1. Map every external instruction entry point.
2. Define the **Protocol Invariants** (statements that must hold true across all slots):
   - _Invariant A_: $\sum \text{user\_balances} \le \text{vault\_token\_balance}$
   - _Invariant B_: Only `authority` key can execute admin config updates.
   - _Invariant C_: PDA vault address must strictly equal `find_program_address([b"vault", mint.key()], program_id)`.
3. Locate every `UncheckedAccount`, CPI call, raw byte slice conversion, and arithmetic operation.

### Stage 2: Attack Vector & Composite Hypothesis Formulation

Formulate concrete exploit scenarios by combining potential weaknesses:

- _Hypothesis Example_: "In `withdraw_fees`, if an attacker passes their own ATA as `fee_vault` alongside a spoofed `token_program`, the contract will skip authority check and transfer protocol fees to the attacker."

### Stage 3: Construct Deterministic LiteSVM Exploit PoC

_Never declare a vulnerability without an empirical PoC test!_

1. Create a Rust integration test using `LiteSVM`.
2. Load the compiled SBF binary (`program.so`).
3. Set up accounts, mints, and state.
4. Execute the crafted adversarial transaction sequence.
5. **Assert the exploit success**: Confirm that unpatched code allows fund theft, state corruption, or unauthorized privilege execution.

Refer to [litesvm-exploit-poc.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-adversarial-review/references/litesvm-exploit-poc.md) for the complete PoC template.

### Stage 4: Defensive Patching & Root Cause Analysis (RCA)

1. Formulate Anchor-idiomatic declarative constraints (e.g., `has_one`, `seeds/bump`, `constraint = ...`).
2. Replace unchecked math with safe checked/ceil arithmetic.
3. Apply fixes directly to smart contract code.

### Stage 5: Non-Regression & Verification

1. Re-run the LiteSVM Exploit PoC: confirm transaction **fails** with expected error code.
2. Re-run complete test suite to ensure zero disruption to legitimate protocol operations:
   ```bash
   NO_DNA=1 cargo test
   ```

---

## Part 3: Quick Reference Checklist & Taxonomy Matrix

For detailed vulnerability code patterns (Vulnerable vs Exploited vs Fixed), inspect the reference files:

- [exploit-taxonomy-matrix.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-adversarial-review/references/exploit-taxonomy-matrix.md)
- [litesvm-exploit-poc.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-adversarial-review/references/litesvm-exploit-poc.md)
- [invariant-threat-modeling.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-adversarial-review/references/invariant-threat-modeling.md)

### Rules of Engagement for AI Agent

1. **Always Test-First**: Reproduce vulnerabilities with a LiteSVM Rust PoC before writing smart contract fixes.
2. **Declarative Constraints**: Prefer Anchor attributes (`#[account(...)]`) over manual Rust `if` checks in instruction handlers.
3. **No Unchecked Silos**: Every `UncheckedAccount` MUST have an explicit `/// CHECK:` safety rationale and manual key/owner check.
4. **Clean Execution**: Always prefix test and build commands with `NO_DNA=1` (e.g., `NO_DNA=1 cargo test`).
