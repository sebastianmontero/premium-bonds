---
name: solana-test-smells
description: Static test code craftsmanship, xUnit & Web3 test smells diagnostic taxonomy, and paired refactoring recipes for Solana Anchor (Rust) and Next.js / Framework-Kit (TypeScript). Detects tautological assertions, white-box state forging, assertion roulette, mock overreach, and provides before/after refactoring diffs.
user-invocable: true
license: MIT
compatibility: Rust toolchain, Anchor / LiteSVM, TypeScript, React 19 / Next.js
metadata:
  author: Solana Security & Testing Team
  version: 1.0.0
---

# Solana Test Code Smells & Refactoring Playbook (`solana-test-smells`)

## What this Skill is for

Use this Skill when:

- **Auditing test code quality, maintainability, and coupling** across Rust Anchor integration tests (`anchor/tests/*.rs`) and TypeScript dApp tests (`app/**/__tests__/*.ts`).
- **Detecting the 10 Classic & Web3 Test Smells** that cause tests to break on harmless refactorings or pass tautologically on broken code.
- **Refactoring smelly tests into clean, decoupled, intent-driven assertions** using paired before/after code recipes.
- **Eliminating fragile mocks, assertion roulette, and setup blobs** in favor of in-process LiteSVM harnesses and parameterized test fixtures.

---

## The 10 Test Smells Taxonomy Overview

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          THE 10 TEST SMELLS TAXONOMY                                   │
├────┬───────────────────────────────┬───────────────────────────────────────────────────┤
│ #  │ Test Smell                    │ Core Anti-Pattern / Symptom                       │
├────┼───────────────────────────────┼───────────────────────────────────────────────────┤
│ 1  │ **Assertion Roulette**        │ Unlabeled multi-assertion blocks hiding failures. │
│ 2  │ **Whitebox Over-Fitting**     │ Asserts private struct fields or internal steps.  │
│ 3  │ **Primitive Error Matching**  │ Checks `res.is_err()` or raw string regex.        │
│ 4  │ **Mystery Guest**             │ Test relies on implicit external state fixtures.  │
│ 5  │ **Data Clump Fixture**        │ Repetitive 40-line Anchor account boilerplate.    │
│ 6  │ **The Mockingbird**           │ Over-mocking SVM internals vs LiteSVM sandbox.    │
│ 7  │ **Eager / Divergent Test**    │ Single test tests multiple unrelated transitions. │
│ 8  │ **Slot & Clock Illusion**     │ Hardcoding slot sequences without time travel.    │
│ 9  │ **Tautological Assertion**    │ Copy-pasting production math into test asserts.   │
│ 10 │ **Ignored / Conditional Test**│ Branching `if/try-catch` inside test hiding bugs. │
└────┴───────────────────────────────┴───────────────────────────────────────────────────┘
```

---

## Paired Refactoring Summary Table

|   #    | Test Smell                     | Diagnostic Heuristic / AST Pattern                                            | Refactoring Prescription                                                               |
| :----: | :----------------------------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------- |
| **1**  | **Assertion Roulette**         | 5+ consecutive `assert_eq!` calls without failure message strings.            | Add descriptive assertion messages or split into focused, single-concept test cases.   |
| **2**  | **Whitebox Over-Fitting**      | Asserting `pool._internal_scratchpad_counter == 1`.                           | Replace with observable postcondition (e.g. `vault_balance`, emitted event).           |
| **3**  | **Primitive Error Matching**   | `assert!(res.is_err())` or `err.contains("custom error")`.                    | Match typed `AnchorError` variant: `assert_custom_error!(res, ErrorCode::PoolPaused)`. |
| **4**  | **Mystery Guest**              | Reading global state or accounts prepared outside the test function.          | Inline explicit test fixture builder passing domain parameters explicitly.             |
| **5**  | **Data Clump Fixture**         | Copy-pasted 50-line Anchor instruction account metas setup across test files. | Extract Test Data Builder pattern (e.g. `BuyBondsBuilder::new().with_pool(1)`).        |
| **6**  | **The Mockingbird**            | Mocking AccountLoaders or token CPIs with fake memory structs.                | Execute in in-process `LiteSVM` sandbox with real token program bytecode.              |
| **7**  | **Eager Test**                 | 150-line test that initializes pool, buys bonds, draws, claims, and pauses.   | Split into distinct lifecycle stage tests with well-defined preconditions.             |
| **8**  | **Slot & Clock Illusion**      | Manually mutating struct timestamps without warping SVM clock sysvar.         | Use LiteSVM `warp_to_slot` and `warp_to_timestamp` time travel cheatcodes.             |
| **9**  | **Tautological Assertion**     | `let expected = (gross * fee_bps) / 10000; assert_eq!(fee, expected);`        | Assert against independent reference oracle or mathematical ceiling property.          |
| **10** | **Ignored / Conditional Test** | `if let Ok(res) = tx { assert!(res.foo); }`                                   | Remove conditionals; flatten test into deterministic arrange-act-assert flow.          |

---

## Step-by-Step Test Refactoring Workflow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                         TEST SMELL REFACTORING WORKFLOW                                │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Step 1:          │   │ Step 2:                │   │ Step 3:         │   │ Step 4:          │
│ AST Smell Scan   │──►│ Classify Coupling &    │──►│ Apply Paired    │──►│ Verify Tests     │
│ (Regex & Heuristic)  │ Brittle Assertions     │   │ Refactoring Diff│   │ Pass in LiteSVM  │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

1. **Scan Test File:** Inspect target test file (`anchor/tests/*.rs` or `app/**/__tests__/*.ts`) against the 10 diagnostic smell signals.
2. **Flag Smells & Triage:** Identify lines containing tautological math, uninformative assertions, or white-box peeking.
3. **Apply Refactoring Recipe:** Replace smelly patterns with clean, decoupled intent assertions from [test-refactoring-recipes.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-test-smells/references/test-refactoring-recipes.md).
4. **Verify Execution:** Run `cargo test` (smart contracts) or `npm test` (frontend) to verify the refactored test suite executes cleanly and provides high diagnostic clarity.

---

## Progressive Disclosure References

- [10 Test Smells In-Depth Taxonomy](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-test-smells/references/test-smell-taxonomy.md): Exhaustive definitions, AST detection signals, and architectural harm for each smell.
- [Before & After Refactoring Recipes](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-test-smells/references/test-refactoring-recipes.md): Side-by-side Rust/LiteSVM and TypeScript/Framework-Kit code diffs demonstrating how to fix every smell.
