---
name: solana-contract-testing
description: Playbook, edge-case taxonomy, invariant verification matrix, and reference guide for designing and executing deep test suites for Solana smart contracts developed with Anchor. Covers LiteSVM, Bankrun, Mollusk, Trident fuzzing, first-depositor vault attacks, PDA bump enforcement, account closure revival, and financial rounding edge cases.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, LiteSVM / cargo-test
metadata:
  author: Solana Security & Testing Team
  version: 1.0.0
---

# Solana Anchor Smart Contract Testing & Edge Case Mastery Skill

## What this Skill is for

Use this Skill when:

- Designing or writing unit, integration, invariant, or fuzz test suites for Solana smart contracts written in Rust using the **Anchor framework**.
- Systematically identifying **high-value edge cases** (first-depositor vault attacks, non-canonical PDA bump spoofing, account revival attacks, arithmetic rounding drift, integer truncation/overflow, zero-amount exploits, sysvar clock drift).
- Selecting and setting up the optimal testing harness (**LiteSVM** for ultra-fast Rust integration, **Bankrun** for Node.js/TS, **Mollusk** for raw instruction CU checks, or **Trident** for invariant-based fuzzing).
- Evaluating test suite quality, verifying 100% custom error code coverage, and discovering untested execution paths or validation guards.
- Constructing regression tests after fixing smart contract vulnerabilities.

---

## Part 1: Expert Knowledge Matrix & Core Competencies

An expert Solana Anchor test developer must master five distinct technical pillars:

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                     EXPERT ANCHOR SMART CONTRACT TEST ENGINEER MATRIX                    │
└────────────────────────────────────────────┬─────────────────────────────────────────────┘
                                             │
      ┌──────────────────────┬───────────────┴───────────────┬──────────────────────┐
      ▼                      ▼                               ▼                      ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌────────────────────┐
│ 1. SVM Execution │   │ 2. Anchor Constraints  │   │ 3. 7-Vector Edge│   │ 4. Modern Testing  │
│    Engine & RAM  │   │    & Account Machinery │   │    Case Engine  │   │    Harnesses       │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └────────────────────┘
```

### 1. SVM Architecture & Runtime Mechanics

- **Account Ownership & Lamport Rules**: Rent-exemption thresholds, minimum balance requirements, account creation (`system_instruction::create_account`), account closure (lamport transfer, zeroing out 8-byte Anchor discriminator `CLOSED_ACCOUNT_DISCRIMINATOR`, data zeroing, revival attacks within same slot).
- **PDA & Canonical Bump Enforcement**: Deriving PDAs (`find_program_address`), seed domain separation, rejecting off-curve bump bypasses (`create_program_address` with non-canonical bumps), PDA authority signers (`invoke_signed`).
- **Compute Unit (CU) & Memory Limits**: BPF heap (32 KB cap), stack limits (4 KB cap - catching stack overflow errors before deployment), 1.4M CU per tx cap, CU tracking per instruction.
- **Sysvars & Clock Manipulation**: `Clock` (unix_timestamp, slot, epoch drift), `Rent`, `Instructions` (instruction introspection / reentrancy guards).

### 2. Anchor Framework Internals & Macro Mechanics

- **Account Attributes**:
  - `#[account(init, payer = ..., space = ...)]` vs `#[account(init_if_needed)]` (re-initialization vulnerability vectors).
  - `#[account(mut, has_one = authority)]` (owner relationship validation).
  - `#[account(seeds = [...], bump = vault.bump)]` (stored canonical bump enforcement).
  - `#[account(realloc = new_size, realloc::payer = payer, realloc::zero = false)]` (residual byte leaks).
  - `#[account(close = destination)]` (lamport drainage and discriminator clearing).
- **Account Wrappers**: `Account<'info, T>`, `Signer<'info>`, `Program<'info, T>`, `Sysvar<'info, T>`, `Interface<'info, T>`, `UncheckedAccount<'info>`, `AccountInfo<'info>`.

### 3. SPL Token System & Token-2022 (Token Extensions)

- **Token Standards**: Associated Token Accounts (ATA), Mint Authorities, Decimals & Scaling.
- **Token-2022 Extensions**: Transfer fees (fee truncation math), Transfer hooks (CPI reentrancy), Interest-bearing tokens, Non-transferable tokens, Confidential transfers.
- **Math Precision**: Integer division truncation (`(amount / total_shares) * yield`), WAD (1e18) / RAY (1e27) fixed-point math, dust attacks, rounding in favor of protocol vs attacker.

### 4. Modern Testing Harnesses Matrix

| Framework                      | Execution Environment                | Primary Use Case                                                        | Execution Speed           |
| :----------------------------- | :----------------------------------- | :---------------------------------------------------------------------- | :------------------------ |
| **LiteSVM**                    | In-process Rust SVM                  | Fast integration tests, CPI simulation, slot/time warping               | 🚀 Extremely Fast (~ms)   |
| **Mollusk**                    | Lightweight Rust Instruction Engine  | Raw instruction testing, exact CU measurement, low-level SVM checks     | 🚀 Blazing Fast (~sub-ms) |
| **Bankrun (Node.js)**          | In-process Rust SVM exposed to JS/TS | Frontend transaction building verification, Anchor JS client tests      | ⚡ Fast (~10ms)           |
| **Surfpool / Local Validator** | Subprocess `solana-test-validator`   | Multi-program devnet cloning, full RPC API tests, WebSocket streams     | 🐢 Slower (~seconds)      |
| **Trident (Fuzzing)**          | Honggfuzz / Cargo-fuzz + SVM         | Property-based testing, invariant verification, random sequence fuzzing | 🔬 Continuous / Deep      |

---

## Part 2: Systematic 7-Vector Edge Case Discovery Engine

To ensure deep contract coverage, systematically analyze every instruction in the smart contract against these **7 Core Test Vectors**:

```
                                    HIGH-VALUE TEST VECTORS
                                              │
    ┌──────────────┬──────────────┬───────────┴──────────┬──────────────┬──────────────┬──────────────┐
    ▼              ▼              ▼                      ▼              ▼              ▼              ▼
┌──────────────┐ ┌────────────┐ ┌──────────┐      ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
│ Vector 1:    │ │ Vector 2:  │ │ Vector 3:│      │ Vector 4:  │ │ Vector 5:  │ │ Vector 6:  │ │ Vector 7:  │
│ Value &      │ │ State      │ │ Access   │      │ Math &     │ │ Account    │ │ Time &     │ │ CPI &      │
│ Boundary     │ │ Lifecycle  │ │ Control  │      │ Invariants │ │ Realloc    │ │ Sysvars    │ │ Reentrancy │
└──────────────┘ └────────────┘ └──────────┘      └────────────┘ └────────────┘ └────────────┘ └────────────┘
```

### Vector 1: Value & Boundary Extreme Testing

- [ ] **Zero Inputs**: Pass `amount = 0` to deposit, withdraw, mint, burn, transfer, or fee calculation instructions. Verify if 0 amounts trigger state mutations, zero-share mints, or free transactions.
- [ ] **Maximum Integers**: Test `u64::MAX`, `u128::MAX`, `i64::MAX`. Check for integer overflows in checked math, unchecked blocks (`u64::unchecked_add`), or casting truncations (`u128 as u64`).
- [ ] **Dust & Single-Unit Amounts**: Test 1 lamport or 1 atomic token unit. Test if dust amounts bypass fee calculations (e.g. `1 * 10 / 10000 = 0` fee) or lock up vaults.
- [ ] **Rent Exemption Thresholds**: Test account balances at `rent_minimum - 1 lamport` (triggers automatic account deallocation by SVM), `rent_minimum`, and `rent_minimum + 1`.

### Vector 2: State Machine & Lifecycle Edge Cases

- [ ] **Uninitialized Access**: Call state modification instructions on accounts before running `initialize`.
- [ ] **Double Initialization**: Attempt to re-initialize an active account or exploit `init_if_needed` when account data already contains valid state.
- [ ] **Action Post-Closure**: Attempt to invoke instructions using a closed account's public key within the same slot or in subsequent slots.
- [ ] **State Invalidation**: Pass invalid state parameters (e.g., status enum out-of-bounds, zero pubkey as admin, fee basis points > 10,000).

### Vector 3: Access Control & Impersonation Attacks

- [ ] **Signer Substitution**: Replace a required authority `Signer<'info>` with an unauthenticated `AccountInfo<'info>` or a non-signing pubkey.
- [ ] **Authority Mismatch**: Pass User A's signature to mutate User B's vault or settings (verifying `has_one = authority` or `constraint = ...`).
- [ ] **Fake External Accounts**: Pass a fake SPL Token mint, fake Pyth oracle pricefeed, or malicious custom program in place of official system addresses.
- [ ] **PDA Seed Spoofing**: Supply non-canonical bump seeds, off-curve keys, or mismatched seed parameters (e.g. User A's vault seed for User B's transaction).

### Vector 4: Financial Math & Invariants

- [ ] **Rounding Direction**: Ensure rounding always favors the protocol (e.g., withdraw rounds down user payout; fee calculation rounds up protocol fee).
- [ ] **First Depositor / Vault Inflation Attack**:
  1. Vault initialized with 0 shares and 0 tokens.
  2. Attacker deposits 1 atomic unit of token, receiving 1 share.
  3. Attacker directly transfers 1,000,000 tokens to vault token account (without calling deposit).
  4. Next user deposits 500,000 tokens.
  5. Math check: `user_shares = (500_000 * total_shares) / total_tokens = (500_000 * 1) / 1_000_001 = 0 shares`. User receives 0 shares and loses tokens!
  - **Required Test**: Explicitly test vault behavior with initial deposit = 1 unit followed by direct token transfer before user 2 deposits!
- [ ] **Invariant Equivalence**: Verify `sum(user_balances) == total_vault_tokens` across all state transitions.

### Vector 5: Account Closure & Reallocation (`realloc`)

- [ ] **Residual Bytes**: Expand an account via `realloc` without setting `realloc::zero = true`. Verify that old trailing bytes do not corrupt newly allocated fields.
- [ ] **Realloc Shrinking**: Decrease account size and verify that excess rent lamports are correctly refunded to the designated refund address.
- [ ] **Discriminator Zeroing**: Confirm that closing an account via Anchor (`close = destination`) writes `CLOSED_ACCOUNT_DISCRIMINATOR` (`[255, 255, 255, 255, 255, 255, 255, 255]`) and zeroes out all data bytes.

### Vector 6: Time, Slot & Sysvar Manipulation

- [ ] **Clock Drift & Retroactive Time**: Simulate `clock.unix_timestamp` jumping backward or forward by months, or setting timestamp to `0`.
- [ ] **Lockup Boundary**: Test actions at `lockup_end - 1`, `lockup_end` (exact match), and `lockup_end + 1`.
- [ ] **Epoch Rollover**: Test reward distribution across epoch boundaries (`clock.epoch + 1`).

### Vector 7: Cross-Program Invocation (CPI) & Reentrancy

- [ ] **CPI Account Injection**: Pass malformed accounts in CPI calls to third-party protocols (e.g., Kamino, Raydium, Solend).
- [ ] **Instruction Introspection**: Verify instructions sysvar check when using CPI callbacks to prevent cross-instruction state manipulation.

---

## Part 3: Step-by-Step Test Suite Development Lifecycle

When writing tests for an Anchor contract, follow this 5-step workflow:

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────────┐
│ 1. Struct & API │ ──► │ 2. Map 7-Vector     │ ──► │ 3. Implement    │
│    Deconstruction│    │    Edge Cases       │     │    LiteSVM Suite│
└─────────────────┘     └─────────────────────┘     └────────┬────────┘
                                                             │
┌─────────────────┐     ┌─────────────────────┐              │
│ 5. Audit & Fuzz │ ◄── │ 4. Verify Error &   │ ◄────────────┘
│    Verification │     │    Line Coverage    │
└─────────────────┘     └─────────────────────┘
```

### Step 1: Instruction & Struct Deconstruction

1. Read the Rust target file (`src/lib.rs` or `src/instructions/`).
2. List all instructions, their parameters, and their derived `Accounts` structs.
3. List all custom `#[error_code]` enums defined in the program.

### Step 2: Edge Case Mapping

For each instruction, draft test cases covering:

- Happy path (valid parameters, expected signers).
- All custom error code triggers (access control, validation guards, math bounds).
- Critical vector edge cases (0 amounts, max amounts, wrong signers, non-canonical bump, clock boundary).

### Step 3: Implement LiteSVM Fast Integration Tests

In `tests/` directory or `anchor/tests/`, build deterministic Rust tests using LiteSVM:

- Use `LiteSVM::new()` for in-process execution.
- Load program SBF bytecode (`svm.add_program_from_file(...)`).
- Fund keypairs (`svm.airdrop(...)`).
- Execute instructions via `svm.send_transaction(...)`.
- Assert expected account data mutations and return status codes.

### Step 4: Verify Test & Error Coverage

Run error coverage and line coverage scripts to ensure 100% of defined `#[error_code]` variants are covered by at least one failing test case:

- Refer to `solana-test-coverage` skill for running coverage analyzers.

### Step 5: Invariant & Fuzz Verification

For financial protocols (vaults, DEXes, lending pools), configure Trident property-based fuzzing to verify structural invariants across random multi-instruction sequences.

---

## Part 4: Benchmark Checklist for Deep Contract Verification

Before declaring a Solana Anchor smart contract fully tested, verify that the test suite fulfills the following 10-point benchmark:

1. [ ] **100% Error Code Coverage**: Every custom `#[error_code]` in the program is triggered by at least one failing test case.
2. [ ] **Access Control Failure Suite**: Every instruction has explicit test cases attempting invocation with missing signers, wrong signers, and wrong admin authorities.
3. [ ] **PDA Bump Rigor**: All PDA derivation endpoints are tested with both canonical and non-canonical bumps.
4. [ ] **Zero & Overflow Boundaries**: All numeric inputs are tested at `0`, `1`, `u64::MAX`, and boundary thresholds.
5. [ ] **First Depositor Vault Test**: Vault initialization math is tested against 1-unit deposit + direct token inflation attacks.
6. [ ] **Financial Rounding Validation**: Math routines are verified to round in favor of protocol and never leave unaccounted dust.
7. [ ] **Account Closure & Revival Test**: Account closure instructions are verified to zero out data, write `CLOSED_ACCOUNT_DISCRIMINATOR`, and refund rent.
8. [ ] **Time Warping Boundaries**: Timestamp and slot-dependent features are tested at `t - 1`, `t`, and `t + 1`.
9. [ ] **LiteSVM Fast Integration Suite**: Comprehensive Rust integration tests run via LiteSVM in under 5 seconds.
10. [ ] **Invariant Fuzzing**: Key financial invariants are verified under multi-instruction sequence fuzzing.

---

## Part 5: Progressive Disclosure & Reference Guides

- [Detailed Edge Cases Matrix]: Read [edge_cases_matrix.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-contract-testing/references/edge_cases_matrix.md) for an exhaustive catalog of edge case inputs, expected failures, and Anchor error mappings.
- [LiteSVM & Bankrun Testing Patterns]: Read [litesvm_patterns.rs](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-contract-testing/references/litesvm_patterns.rs) for ready-to-use boilerplate snippets for LiteSVM time warping, PDA bump testing, and vault inflation prevention tests.
