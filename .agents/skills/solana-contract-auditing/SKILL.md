---
name: solana-contract-auditing
description: Playbook, research guide, and reference protocol for auditing Solana smart contracts built with the Anchor framework. Details required expert skills, vulnerability vector analysis, deterministic LiteSVM PoC issue reproduction, Root Cause Analysis (RCA), and defensive remediation verification loops.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, LiteSVM / cargo-test
metadata:
  author: Solana Security Team & Community
  version: 1.0.0
---

# Solana Anchor Contract Security Auditing & Issue Verification Skill

## What this Skill is for

Use this Skill when:

- Conducting security code reviews or audits of Solana smart contracts written in Rust using the **Anchor framework**.
- Identifying edge cases, access control oversights, type confusion, CPI exploits, account validation flaws, or arithmetic precision errors.
- Designing and running deterministic **Proof of Concept (PoC)** test cases using **LiteSVM** (`cargo test`) to reproduce suspected or reported vulnerabilities.
- Performing **Root Cause Analysis (RCA)** on contract panics, transaction simulation failures, or unexpected state changes.
- Applying Anchor-idiomatic security fixes and empirically verifying non-regression.

---

## Part 1: Expert Knowledge Matrix & Required Skillset

An expert auditor of Solana Anchor smart contracts must master four distinct technical pillars:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   EXPERT ANCHOR SMART CONTRACT AUDITOR SKILLSET                   │
└─────────────────────────────────────────┬────────────────────────────────────────┘
                                          │
    ┌───────────────────────────┬─────────┴───────────┬───────────────────────────┐
    ▼                           ▼                     ▼                           ▼
┌───────────────────────┐ ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────────┐
│ 1. SVM Architecture   │ │ 2. Anchor Trait   │ │ 3. Vulnerability  │ │ 4. LiteSVM & PoC      │
│    & Execution Engine │ │    Constraint System│ │    Attack Vectors │ │    Verification Tools │
└───────────────────────┘ └───────────────────┘ └───────────────────┘ └───────────────────────┘
```

### 1. SVM Core Execution Architecture & Memory Model

- **Account Ownership & Lamport Model**: Enforcing that only the program owning an account can modify its data or subtract lamports. Understanding System Program vs Custom Program capabilities.
- **PDA & Canonical Bump Enforcement**: Deriving Program Derived Addresses (`find_program_address`) and ensuring non-canonical off-curve bump seeds cannot bypass uniqueness checks.
- **Account Closing & Discriminator Clearing**: Understanding rent exemption, zero-lamport accounts, garbage collection, and preventing account revival by zeroing out data and setting `CLOSED_ACCOUNT_DISCRIMINATOR`.
- **Compute Unit (CU) & Stack Limits**: BPF heap/stack constraints (4KB stack limit), call depth, dynamic account reallocation (`realloc`), and memory alignment in zero-copy deserialization.
- **Cross-Program Invocations (CPI)**: Privilege propagation via `invoke` vs `invoke_signed`, CPI instruction account validation, sysvar clock/instructions validation.

### 2. Anchor Framework Constraint Machinery

- **Declarative Account Constraints**: Deep knowledge of `#[derive(Accounts)]` attributes:
  - `#[account(init, payer = ..., space = ...)]`
  - `#[account(mut, has_one = authority)]`
  - `#[account(seeds = [...], bump = vault.bump)]`
  - `#[account(close = destination)]`
  - `#[account(realloc = new_size, realloc::payer = payer, realloc::zero = false)]`
  - `#[account(constraint = ...)]`
- **Account Wrapper Mechanics**:
  - `Account<'info, T>`: Enforces 8-byte SHA256 discriminator check and owner check.
  - `Signer<'info>`: Verifies `account.is_signer == true`.
  - `Program<'info, T>`: Verifies program identity.
  - `UncheckedAccount<'info>`: Raw AccountInfo bypass requiring manual validation and explicit `/// CHECK:` doc comments.

### 3. Vulnerability Categories & Edge Case Vectors

- **Access Control & Account Validation**: Missing signer checks, missing owner checks, missing `has_one` checks, arbitrary account substitution.
- **Type Confusion & Revival**: Passing one account type where another is expected, reading data from closed accounts in the same slot.
- **CPI & Flash Loan Exploits**: Failing to validate third-party reserve, mint, or sysvar accounts during CPIs (e.g. Kamino, Solend, Raydium).
- **Arithmetic Precision & Financial Rounding**: Unchecked math operators (`+`, `-`, `*`), truncation in integer division (`(a / b) * c`), rounding in favor of attacker, dust draining.
- **Oracle Staleness & Manipulation**: Reading Pyth/Switchboard prices without checking price status, timestamp staleness, or confidence interval thresholds.

### 4. Verification & Testing Tooling

- **LiteSVM**: High-performance, in-process Rust SVM harness for deterministic, fast unit/integration testing without running `solana-test-validator`.
- **Trident / Fuzzing**: Fuzz testing instruction sequences and account state transitions.
- **Cargo Test**: Integration testing with native Anchor IDL instruction encoders.

---

## Part 2: Step-by-Step Verification & Remediation Process

When an issue or vulnerability is suspected or reported, follow this 6-step lifecycle:

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│ 1. Audit Pass / │ ──► │ 2. Formulate        │ ──► │ 3. Build LiteSVM│
│    Threat Model │     │    Hypothesis       │     │    PoC Test     │
└─────────────────┘     └─────────────────────┘     └────────┬────────┘
                                                             │
┌─────────────────┐     ┌─────────────────────┐              │
│ 6. Verify Fix   │ ◄── │ 5. Apply Anchor     │ ◄────────────┘
│    & Regressions│     │    Idiomatic Fix    │
└─────────────────┘     └─────────────────────┘
```

### Step 1: Threat Modeling & Static Account Audit

1. Audit every struct deriving `Accounts`:
   - Are all mutability requirements (`mut`) minimal and accurate?
   - Is every authority a `Signer<'info>`?
   - Is every vault or user state protected by `has_one` or explicit PDA `seeds` & `bump` constraints?
2. Audit all `UncheckedAccount` references for missing owner, key, or data validation.
3. Audit all financial math for `checked_*` methods and correct order of operations.

### Step 2: Formulate Vulnerability Hypothesis

Draft a precise statement of the vulnerability:

- **Condition**: "In instruction `withdraw_fees`, `fee_vault` is an `UncheckedAccount` without `seeds` or `has_one` check."
- **Impact**: "An attacker can pass their personal ATA as `fee_vault` and drain protocol fees."

### Step 3: Construct Deterministic LiteSVM PoC Test

_Never attempt to patch code without first writing a reproducing test case!_

1. Refer to [litesvm-poc-template.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-contract-auditing/references/litesvm-poc-template.md) for setup boilerplate.
2. Initialize LiteSVM environment and load compiled program binary (`.so`).
3. Setup initial state with a victim account and an attacker keypair.
4. Execute the adversarial instruction with malicious accounts or inputs.
5. **Assert the vulnerability**: Confirm that the transaction succeeds on unpatched code (e.g. attacker succeeds in stealing funds or bypassing checks).

### Step 4: Conduct Root Cause Analysis (RCA)

Determine the exact root cause:

- Missing declarative constraint in Anchor account context (`#[derive(Accounts)]`).
- Flawed math / precision loss in handler logic.
- Misconfigured CPI account context or missing mint validation.

### Step 5: Implement Defensive Anchor-Idiomatic Fix

1. Prefer declarative Anchor constraints over imperative Rust `if` checks in handler code:
   ```rust
   // Preferred: Declarative Anchor constraint
   #[account(
       mut,
       has_one = authority,
       seeds = [b"vault", authority.key().as_ref()],
       bump = vault.bump,
   )]
   pub vault: Account<'info, Vault>,
   pub authority: Signer<'info>,
   ```
2. Convert `UncheckedAccount` to typed `Account<'info, T>` or `Signer<'info>` where possible.
3. Replace raw math operators with `.checked_add()`, `.checked_sub()`, `.checked_mul()`, `.checked_div()`.

### Step 6: Verify Remediation & Non-Regression

1. Run the LiteSVM PoC test:
   ```bash
   NO_DNA=1 cargo test test_poc_reproduce_... -- --nocapture
   ```
   Verify that the adversarial transaction now **fails** with the expected Anchor custom error code.
2. Run the complete program test suite to ensure zero regressions in legitimate functionality:
   ```bash
   NO_DNA=1 cargo test
   ```

---

## Core Audit & Engineering Rules

1. **Always Test-First**: Write the LiteSVM PoC test that reproduces the bug _before_ touching smart contract code.
2. **Declarative Over Imperative**: Enforce checks in `#[derive(Accounts)]` constraints rather than writing manual `if` statements inside instruction handler bodies.
3. **No Unchecked Silos**: Every `UncheckedAccount` MUST have a `/// CHECK:` comment and explicit validation.
4. **Wipe on Close**: Always use Anchor's `close = destination` constraint to ensure account data is zeroed and discriminator cleared.
5. **CLI Invocations**: Always prefix Solana and Anchor CLI commands with `NO_DNA=1` (e.g., `NO_DNA=1 cargo test`) to guarantee clean execution.
