---
name: solana-test-auditor
description: Clean-room test audit and semantic invariant traceability skill for Solana Anchor & Web3 test suites. Evaluates test suites strictly against formal domain specifications without reading program implementation code, generates requirements-to-test traceability matrices, uncovers untested negative space, and synthesizes LiteSVM invariant test stubs.
user-invocable: true
license: MIT
compatibility: Requires Rust toolchain, Anchor CLI, LiteSVM / cargo-test, TypeScript / Node.js
metadata:
  author: Solana Security & Testing Team
  version: 1.0.0
---

# Solana Clean-Room Test Auditor & Traceability Skill (`solana-test-auditor`)

## What this Skill is for

Use this Skill when:

- **Auditing existing test suites for true behavioral coverage** against a formal specification (`docs/specs/invariants-*.md`).
- **Enforcing Clean-Room Black-Box Isolation**: Reviewing tests strictly without inspecting `anchor/programs/` implementation code to prevent confirmation bias.
- **Generating the Requirements-to-Test Traceability Matrix**: Mapping every domain invariant, conservation law, and boundary condition to specific test functions.
- **Uncovering Untested Negative Space**: Pinpointing critical adversarial vectors (e.g. first-depositor inflation attacks, non-canonical bump spoofing, clock jumps, zero-value transactions) that the code author never implemented or tested.
- **Synthesizing Invariant Test Stubs**: Automatically generating executable in-process LiteSVM test stubs with invariant assertions for uncovered specifications.

---

## The Clean-Room Context Boundary Rule

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        CLEAN-ROOM AUDIT CONTEXT BOUNDARY                               │
├────────────────────────────────────────┬───────────────────────────────────────────────┤
│ INGESTED IN AUDIT CONTEXT (PERMITTED)  │ STRICTLY EXCLUDED FROM CONTEXT (FORBIDDEN)    │
├────────────────────────────────────────┼───────────────────────────────────────────────┤
│ • Formal Specification Catalog         │ • Smart contract source files                 │
│   (`docs/specs/invariants-*.md`)       │   (`anchor/programs/anchor/src/**`)           │
│ • Existing Integration Test Files      │ • Frontend component / hook implementation    │
│   (`anchor/programs/anchor/tests/**`)  │   (`app/**` excluding `__tests__`)            │
│ • Frontend Test Suites                 │ • Internal private utility modules            │
│   (`app/**/__tests__/**/*.ts`)         │                                               │
└────────────────────────────────────────┴───────────────────────────────────────────────┘
```

> [!IMPORTANT]
> **Why strict exclusion matters:** If the auditor reads the program implementation code, it will unconsciously accept the programmer's assumptions as valid. By restricting context strictly to the Specification + Test Files, the auditor can spot when a test is merely asserting a programmer's mistaken logic rather than the domain requirement.

---

## Step-by-Step Audit Workflow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          CLEAN-ROOM AUDIT LIFECYCLE                                    │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Step 1:          │   │ Step 2:                │   │ Step 3:         │   │ Step 4:          │
│ Ingest Spec &    │──►│ Traceability & Gap     │──►│ Classify Test   │──►│ Synthesize       │
│ Test Files       │   │ Matrix Generation      │   │ Adequacy        │   │ LiteSVM Stubs    │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

### Step 1: Ingest Invariant Catalog & Test Files

- Load `docs/specs/invariants-<feature>.md` (produced by `solana-formal-spec`).
- Load relevant test files from `anchor/programs/anchor/tests/` or `app/**/__tests__/`.

### Step 2: Build the Traceability Matrix

For each Invariant (`INV-*`) in the specification:

1. Search the test suite for test functions that set up the invariant's precondition, execute its action, and assert its postcondition / conservation law.
2. Determine if the test asserts on **observable state and exact error variants**, or if it merely asserts transaction success (`is_ok()`).

### Step 3: Classify Each Invariant & Test

Assign one of four statuses:

- **✅ Verified (Intent-Driven):** Test verifies the invariant under real transactions and asserts conservation laws or exact error codes.
- **⚠️ Implementation-Coupled:** Test asserts internal struct counters or repeats production arithmetic rather than asserting the invariant property.
- **❌ Untested (Negative Space Gap):** Specification requirement has 0 mapped tests in the test suite.
- **🗑️ Orphan / Tautological:** Test exists in the codebase but has no backing business requirement in the specification (likely testing an internal implementation quirk).

### Step 4: Emit Traceability Report & LiteSVM Test Stubs

1. Output the structured markdown report to `docs/qa/traceability-<feature>.md`.
2. For each **Untested** or **Coupled** invariant, generate an executable LiteSVM test stub ready to paste into `anchor/tests/` (see [litesvm-test-stub-patterns.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-test-auditor/references/litesvm-test-stub-patterns.md)).

---

## Invariant Traceability Matrix Schema

```markdown
| Invariant ID   | Domain Description                                        | Vector Tag | Mapped Test Function                                               |    Audit Status     | Remediation Required                          |
| :------------- | :-------------------------------------------------------- | :--------: | :----------------------------------------------------------------- | :-----------------: | :-------------------------------------------- |
| `INV-DRAW-001` | Solvency: Payouts <= Harvested Yield                      |   `Math`   | `test_harvest_yield_and_commit.rs::test_solvency`                  |     ✅ Verified     | None                                          |
| `INV-DRAW-002` | Lockup Window: Reveal rejected before freeze slot         |   `Time`   | `test_reveal_and_pick_winners.rs::test_reveal_fails_before_lockup` |     ✅ Verified     | None                                          |
| `INV-REG-003`  | Contiguous ticket index allocation across multi-user buys | `Boundary` | _None_                                                             | ❌ **Untested Gap** | **Generate LiteSVM Test Stub**                |
| `INV-FEE-004`  | Protocol fee ceiling <= MAX_FEE_BPS                       |   `Math`   | `test_withdraw_fees.rs::test_withdraw`                             |     ⚠️ Coupled      | Refactor copy-paste math to ceiling assertion |
```

---

## Downstream Skill Integration

- **`solana-test-smells`**: When `solana-test-auditor` flags a test as ⚠️ **Implementation-Coupled**, invoke `solana-test-smells` to apply specific code refactoring diffs.
- **`solana-mutation-testing`**: Once tests are mapped to invariants, invoke `solana-mutation-testing` to empirically verify that tests fail when code bugs are injected.

---

## Progressive Disclosure References

- [Clean-Room Traceability Matrix Schema & Scorecard](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-test-auditor/references/clean-room-traceability-matrix.md): Complete matrix templates, invariant verification scorecards, and gap prioritization heuristics.
- [LiteSVM Test Stub Patterns & Invariant Verification Recipes](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-test-auditor/references/litesvm-test-stub-patterns.md): Reusable LiteSVM test harness patterns and automated stub templates for newly generated invariant tests.
