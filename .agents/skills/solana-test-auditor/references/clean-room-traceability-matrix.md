# Clean-Room Traceability Matrix Schema & Invariant Scorecard

This reference document defines the report format, scoring metrics, and gap prioritization heuristics for `solana-test-auditor`.

---

## 1. Traceability Report Markdown Template

When auditing a subsystem, emit the report to `docs/qa/traceability-<feature>.md` using this template:

```markdown
# Clean-Room Test Intent & Invariant Traceability Report: [Feature Name]

**Specification Source:** [Link to docs/specs/invariants-<feature>.md]  
**Test Suite Target:** `anchor/programs/anchor/tests/`  
**Audit Date:** [Date]  
**Audit Boundary:** Clean-Room Black-Box (Zero implementation code ingested)

---

## 1. Executive Summary & Verification Scorecard

| Metric                                  |  Score  | Target |       Status       |
| :-------------------------------------- | :-----: | :----: | :----------------: |
| **Total Domain Invariants**             |   14    |   14   |         -          |
| **Verified Intent-Driven Tests**        | 11 / 14 |  100%  |     ⚠️ (78.5%)     |
| **Implementation-Coupled Tests**        | 2 / 14  |   0    | ⚠️ Needs Refactor  |
| **Untested Invariant Gaps**             | 1 / 14  |   0    |  🔴 Critical Gap   |
| **Adversarial Negative Space Coverage** |  85.7%  |  100%  | ⚠️ Action Required |

---

## 2. Invariant Traceability Matrix

| Invariant ID   | Domain Description          | Vector Tag | Mapped Test Function                                               |  Audit Status   | Audit Notes / Gap Analysis                                          |
| :------------- | :-------------------------- | :--------: | :----------------------------------------------------------------- | :-------------: | :------------------------------------------------------------------ |
| `INV-POOL-001` | Solvency Conservation Law   |   `Math`   | `test_harvest_yield_and_commit.rs::test_solvency_conservation`     |   ✅ Verified   | Asserts vault balance == sum(user liabilities) + yield.             |
| `INV-POOL-002` | Lockup Window Enforcement   |   `Time`   | `test_reveal_and_pick_winners.rs::test_reveal_fails_before_lockup` |   ✅ Verified   | Uses `warp_to_slot` to verify boundary slot - 1 vs slot.            |
| `INV-REG-003`  | Contiguous Index Allocation | `Boundary` | _None_                                                             | ❌ **Untested** | Multi-user sequential bond purchases not tested for index drift.    |
| `INV-FEE-004`  | Fee Ceiling Protection      |   `Math`   | `test_withdraw_fees.rs::test_withdraw_fee_calculation`             | ⚠️ **Coupled**  | Test repeats `(gross * 500) / 10000` rather than asserting ceiling. |

---

## 3. High-Priority Invariant Gaps & Remediation Stubs

### Gap 1: `INV-REG-003` (Contiguous Index Allocation across Multi-User Buys)

- **Risk:** Attacker could cause ticket overlaps or gaps during reallocations, biasing winner selection odds.
- **Remediation:** Implement LiteSVM invariant test verifying monotonic cumulative index progression across 10 sequential users.

_(Generated LiteSVM test stubs appended below)_
```

---

## 2. Gap Prioritization Heuristics

When multiple invariant gaps or coupled tests are identified, prioritize remediation by risk severity:

1. **P0 (Critical Security & Solvency Invariants):**
   - Conservation of funds / Solvency floors.
   - Access control & signer authentication guards.
   - Randomness commitment & reveal freeze bypasses.
2. **P1 (Financial & Arithmetic Precision Invariants):**
   - Fee ceiling bounds & rounding direction.
   - User ticket allocation fairness & binary search monotonicity.
   - Realloc byte corruption / memory leaks.
3. **P2 (Time & Lifecycle State Boundaries):**
   - Exact slot / epoch rollover conditions.
   - Crank timeout fallbacks and circuit breaker triggers.
