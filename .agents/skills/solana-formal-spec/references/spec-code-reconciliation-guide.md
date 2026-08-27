# Spec-Code Reconciliation & Drift Detection Guide (Mode 3: `reconciliation`)

This reference document defines the complete procedure for auditing, synchronizing, and reconciling an existing formal invariant specification (`docs/specs/invariants-*.md`) against modified or evolving Anchor smart contract code.

---

## 1. When to Use Mode 3

Use Mode 3 when:

- An existing invariant specification (`docs/specs/invariants-*.md`) is already present in the repository.
- Code has been refactored, new instructions were implemented, or bug fixes were applied.
- You need to detect **Spec Drift** (where code changes accidentally violate formal domain rules).
- You need to detect **Undocumented Features** (new instruction logic added without updating the spec).

---

## 2. The 3-Way Reconciliation Matrix

Reconciliation classifies every feature, instruction, and constraint into one of four quadrants:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                          3-WAY SPEC-CODE RECONCILIATION MATRIX                         │
├──────────────────────────┬────────────────────────────┬────────────────────────────────┤
│ Category                 │ Code Status                │ Spec Action & Conformance      │
├──────────────────────────┼────────────────────────────┼────────────────────────────────┤
│ ✅ Verified Invariant    │ Implemented & adheres      │ Mark `codeConformance: VERIFIED`│
├──────────────────────────┼────────────────────────────┼────────────────────────────────┤
│ ⚠️ Conflicting / Drift    │ Implemented but deviates   │ Mark `DISCREPANCY_FLAGGED`     │
│   (Defect / Bug)         │ (violates invariant)       │ Socratic interview with user   │
├──────────────────────────┼────────────────────────────┼────────────────────────────────┤
│ 🚀 Spec-Only Invariant   │ Not yet implemented        │ Mark `UNIMPLEMENTED`           │
│   (Product Backlog)      │ in smart contract code     │ Retain in spec as requirement  │
├──────────────────────────┼────────────────────────────┼────────────────────────────────┤
│ ❓ Code-Only Behavior    │ Implemented in code        │ Socratic interview: Add to spec│
│   (Undocumented Logic)   │ but missing from spec      │ or flag as dead/rogue code     │
└──────────────────────────┴────────────────────────────┴────────────────────────────────┘
```

---

## 3. Step-by-Step Reconciliation Workflow

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        SPEC-CODE RECONCILIATION LIFECYCLE                              │
└───────────────────────────────────────────┬────────────────────────────────────────────┘
                                            │
    ┌───────────────────────┬───────────────┴───────────────┬────────────────────────┐
    ▼                       ▼                               ▼                        ▼
┌──────────────────┐   ┌────────────────────────┐   ┌─────────────────┐   ┌──────────────────┐
│ Step 1:          │   │ Step 2:                │   │ Step 3:         │   │ Step 4:          │
│ Ingest Spec &    │──►│ Bi-Directional Diff    │──►│ Socratic        │──►│ Emit Updated     │
│ Smart Contracts  │   │ & Anomaly Sifting      │   │ Clarification   │   │ Spec & Report    │
└──────────────────┘   └────────────────────────┘   └─────────────────┘   └──────────────────┘
```

### Step 1: Ingest Invariant Catalog & Smart Contracts

1. Load target specification: `docs/specs/invariants-<feature>.md`.
2. Load all corresponding program files: `anchor/programs/anchor/src/**`, IDL files, and type definitions.

### Step 2: Bi-Directional Diff & Anomaly Sifting

1. **Spec $\to$ Code Scan:** For every `INV-*` and `MTR-*` in the spec, check if the corresponding Anchor instruction, constraint, and error variant exist in the codebase:
   - If missing: Tag as `UNIMPLEMENTED`.
   - If present and matches: Tag as `VERIFIED`.
   - If present but logic differs: Tag as `DISCREPANCY_FLAGGED`.
2. **Code $\to$ Spec Scan:** For every instruction handler in `anchor/programs/anchor/src/instructions/**`:
   - Check if the instruction and its guard constraints are mapped to an Invariant ID.
   - If missing from spec: Tag as `UNDOCUMENTED_CODE`.
3. **Run 7-Vector Anomaly Sifter:** Check if any newly added code introduces vulnerabilities or logical contradictions (see [adversarial-anomaly-heuristics.md](file:///home/sebastian/vsc-workspace/premium-bonds/.agents/skills/solana-formal-spec/references/adversarial-anomaly-heuristics.md)).

### Step 3: Socratic Clarification & Conflict Resolution

- For **Conflicting Invariants (`DISCREPANCY_FLAGGED`)**:
  - Present an interactive multiple-choice question:
    - `1. (Recommended) Fix Code to match Spec` — Upholds domain invariant; logs bug ticket.
    - `2. Update Spec to adopt Code Behavior` — Acknowledges intentional design change.
    - `3. Alternative Resolution` — Custom trade-off.
- For **Undocumented Code (`UNDOCUMENTED_CODE`)**:
  - Ask user if the code represents an intentional new feature to be formalized into an `INV-*` record or dead/deprecated code.

### Step 4: Emit Updated Catalog & Reconciliation Report

1. Update `docs/specs/invariants-<feature>.md` with refreshed `codeConformance`, `provenance`, and `sourceLocation` metadata.
2. Emit the structured QA reconciliation report to `docs/qa/spec-reconciliation-<feature>.md`.

---

## 4. Canonical Reconciliation Report Markdown Template

When emitting `docs/qa/spec-reconciliation-<feature>.md`, use this standardized structure:

```markdown
# Spec-Code Reconciliation & Drift Report: [Feature Name]

**Target Specification:** [docs/specs/invariants-feature.md](file:///path/to/spec)  
**Reconciliation Date:** [Date / Timestamp]  
**Audit Summary:** [X Total Invariants | Y Verified | Z Flagged | W Unimplemented]

---

## 1. Executive Summary & Drift Scorecard

| Status Category                    | Count | Percentage | Primary Action Required       |
| :--------------------------------- | :---: | :--------: | :---------------------------- |
| ✅ **Verified Invariants**         |  18   |   81.8%    | None (Clean alignment)        |
| ⚠️ **Flagged Discrepancies**       |   2   |    9.1%    | Code bug remediation required |
| 🚀 **Unimplemented Requirements**  |   2   |    9.1%    | Implementation in progress    |
| ❓ **Undocumented Code Behaviors** |   1   |     -      | Formalize into specification  |

---

## 2. Flagged Discrepancies & Code Defects (Remediation Required)

### `DISC-01`: [Discrepancy Title]

- **Invariant ID:** [`INV-SELL-002`](file:///path/to/spec#L295)
- **Source Location:** `[sell_bonds.rs#L142](file:///path/to/code#L142)`
- **Vector Tag:** `Realloc`
- **Severity:** `CRITICAL` | `WARN`
- **Description:** The specification mandates that upon full pool exit via swap-and-pop, the vacated tail slot at index $N-1$ must be zeroed out. The code decrements `user_count` but leaves tail bytes dirty.
- **Resolution:** Spec invariant preserved as canonical. Code bug remediation issue opened.

---

## 3. Unimplemented Product Requirements (Spec-Only)

| Invariant ID  | Domain                | Vector | Required Implementation                                           |
| :------------ | :-------------------- | :----: | :---------------------------------------------------------------- |
| `INV-VRF-001` | Oracle Fault Recovery | `Time` | Implement `crank_rebind_expired_randomness` fallback instruction. |

---

## 4. Undocumented Code Behaviors Added to Specification

| Discovered Handler   | Source Location                              | Synthesized Invariant ID |     Status     |
| :------------------- | :------------------------------------------- | :----------------------- | :------------: |
| `update_pool_config` | `anchor/src/instructions/pool/config.rs#L12` | `INV-POOL-002`           | **Formalized** |
```
