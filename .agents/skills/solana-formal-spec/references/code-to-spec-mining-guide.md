# Brownfield Code-to-Spec Mining Guide (Mode 2: `brownfield-mining`)

This reference document defines the complete Two-Pass Socratic Sifting protocol for reverse-engineering and bootstrapping formal domain specifications from existing Solana Anchor smart contracts and partial documentation.

---

## 1. Overview & The Two-Pass Doctrine

In mature (brownfield) codebases, up to 80% of critical domain rules (exact PDA seeds, bitwise packing, swap-and-pop remaining accounts, fine-grained error codes, exact transition guards) exist strictly in code.

However, naive reverse-engineering causes **Implementation Confirmation Bias**: if an agent assumes the code is always right, it will transcribe bugs (e.g. integer truncation to 0 on fees, missing signer checks) directly into the specification.

To prevent this, Mode 2 runs a **Two-Pass Hybrid Architecture**:

- **Pass 1 (Intent & Conservation Extraction):** Establishes high-level mathematical ground truth, state FSMs, and solvency conservation laws from documentation, ADRs, and top-level account structs _before_ reading procedural handlers.
- **Pass 2 (Adversarial Code Conformance & Anomaly Audit):** Ingests concrete instruction handlers, CPI wrappers, and error codes, evaluating them against the 7-Vector Anomaly Taxonomy to flag discrepancies.

---

## 2. Step-by-Step Two-Pass Mining Lifecycle

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        TWO-PASS CODE-TO-SPEC MINING LIFECYCLE                          │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Pass 1:          │   │ Pass 2:                │   │ Step 3:         │   │ Step 4:          │
│ Intent & State   │──►│ Adversarial Conformance│──►│ Socratic        │──►│ Emit Canonical   │
│ Invariants       │   │ & AST Code Mining      │   │ User Interview  │   │ Spec & Ledger    │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

---

### Pass 1: Intent & Global Conservation Extraction

1. **Ingest Available Docs & ADRs:** Read `CONTEXT.md`, `README.md`, `docs/adr/*.md`, and `docs/agents/domain.md`.
2. **Scan State Struct Declarations (`anchor/programs/anchor/src/state/**`):\*\*
   - Identify primary state accounts (e.g. `GlobalConfig`, `PrizePool`, `TicketRegistry`, `DrawCycle`, `UserWinnings`).
   - Extract PDA seed constants and bump storage fields.
   - Extract state enums (e.g. `PoolStatus`, `DrawCycleStatus`, `RedemptionType`).
3. **Formulate High-Level Invariants & Conservation Laws:**
   - Define global solvency equations (e.g., `INV-SOLV-001`: Total vault assets $\ge$ Total depositor liabilities).
   - Formulate mass conservation laws (e.g., Total registry tickets == sum of individual user tickets).
   - Construct the high-level Pool Lifecycle and Draw Pipeline FSMs.
4. **Mark Invariant Records:**
   - `recordKind: 'global_conservation'`
   - `provenance: 'docs_canonical'`
   - `codeConformance: 'UNCHECKED'`

---

### Pass 2: Adversarial Conformance & AST Code Mining

1. **Scan Instruction Account Contexts (`#[derive(Accounts)]`):**
   - Extract signer requirements (`Signer<'info>`), mutability (`mut`), PDA derivations (`seeds = [...]`), and `has_one` constraints.
   - Identify `UncheckedAccount` usage, remaining accounts, and system/token program accounts.
2. **Scan Instruction Handlers (`anchor/programs/anchor/src/instructions/**`):\*\*
   - Extract preconditions from `require!`, `require_gt!`, `require_keys_eq!`, and guard checks.
   - Extract postconditions from field mutations, balance debits/credits, and state enum updates.
   - Extract error code mappings from Anchor error variants (`ErrorCode::*`).
3. **Run the 7-Vector Anomaly Sifter:**
   - Audit handler logic against the [adversarial-anomaly-heuristics.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/adversarial-anomaly-heuristics.md) ruleset:
     - **Math/Solvency:** Floor vs ceil division, fee evasion on dust, unchecked arithmetic.
     - **Lifecycle/FSM:** Terminal states without timeout escape cranks, missing status checks.
     - **Access Control:** Asymmetric pause/unpause roles, missing authority checks.
     - **Boundaries:** Zero-amount deposits/sells accepted silently.
     - **Time/Oracles:** Monotonic slot vs driftable `unix_timestamp`, missing stale checks.
     - **Storage/Realloc:** Dirty byte resurrection, missing account closure discriminators.
     - **CPI/Signers:** Arbitrary program ID substitution, unvalidated remaining accounts.
4. **Classify Findings by Severity:**
   - `CRITICAL`: Direct fund loss, solvency deficit, permanent lockup, auth bypass.
   - `WARN`: Silent zero-amount accept, missing stale oracle window, unzeroed realloc slots.
   - `CODE_QUIRK`: Harmless redundancy, non-standard naming.

---

### Step 3: Socratic User Interview & Decision Resolution

#### Interactive Chat Mode:

- **`CRITICAL` Anomalies:** Immediately halt and present an interactive multiple-choice prompt comparing:
  - `Option 1 (Recommended):` The secure, invariant-preserving design.
  - `Option 2:` The current implementation behavior (with explicit risk explanation).
  - `Option 3:` Alternative domain resolution.
- **`WARN` Anomalies:** Batch in a single summary questionnaire at the end of Pass 2.
- **`CODE_QUIRK`:** Silently annotate in the reconciliation ledger without prompting.

#### Headless / CI Mode:

- For `CRITICAL` and `WARN` anomalies:
  - Automatically apply the `(Recommended)` safe invariant to the formal spec.
  - Set `provenance: 'user_resolved'` and `codeConformance: 'DISCREPANCY_FLAGGED'`.
  - Log the item in `docs/qa/spec-reconciliation-<feature>.md` with `Status: PENDING_USER_REVIEW`.

---

### Step 4: Emit Canonical Spec & Discrepancy Ledger

1. **Assemble Invariant Specification:**
   - Format all verified and resolved invariants into `docs/specs/invariants-<feature>.md`.
   - Ensure every invariant record includes `provenance`, `codeConformance`, and exact `sourceLocation` citations (`[file.rs#L123](file:///path/to/file#L123)`).
2. **Assemble Discrepancy & Bug Remediation Ledger:**
   - Emit `docs/qa/spec-reconciliation-<feature>.md` listing:
     - **Verified Invariants:** Code strictly matches specification.
     - **Flagged Discrepancies:** Bugs or suspicious patterns in the code requiring remediation.
     - **Code Observations:** Stylistic quirks and non-critical notes.
