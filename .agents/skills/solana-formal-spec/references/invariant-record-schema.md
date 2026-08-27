# Canonical Invariant Record Schema & Specification Catalog Template

This reference document defines the formal schema and template for generating and maintaining invariant specifications across all operational modes of `solana-formal-spec`.

---

## 1. Discriminated Union Invariant Schema (TypeScript Definition)

The formal domain specification models invariants as a typesafe **Discriminated Union** across three distinct record kinds:

```typescript
export type VectorCategory =
  | "Boundary"
  | "Lifecycle"
  | "Access"
  | "Math"
  | "Realloc"
  | "Time"
  | "CPI";

export type InvariantProvenance =
  | "docs_canonical" // Derived directly from ADRs, PRDs, or specs
  | "code_mined" // Statically extracted from smart contract source code
  | "user_resolved"; // Resolved via interactive Socratic clarification interview

export type CodeConformanceStatus =
  | "UNCHECKED" // Clean-room mode: code was not audited
  | "VERIFIED" // Code implementation adheres strictly to invariant
  | "DISCREPANCY_FLAGGED" // Code behavior deviates from required invariant (bug/risk)
  | "UNIMPLEMENTED"; // Invariant specified but feature is not yet in code

export interface ExpectedErrorSpec {
  name: string; // Anchor error enum variant (e.g. "AwaitingRandomnessFreeze")
  code?: number; // Numeric error code (e.g. 6007)
  condition?: string; // Explicit trigger condition
}

interface BaseInvariantRecord {
  id: `INV-${string}-${string}` | `MTR-${string}-${string}`;
  domain: string;
  vectorTag: VectorCategory;
  provenance: InvariantProvenance;
  codeConformance: CodeConformanceStatus;
  sourceLocation?: string; // File path & line citation (e.g. "anchor/programs/anchor/src/instructions/sell_bonds.rs#L45")
  description?: string;
}

/**
 * 1. Global System Invariant: Algebraic conservation law or solvency invariant
 * that must hold universally across all protocol state transitions.
 */
export interface GlobalConservationInvariant extends BaseInvariantRecord {
  recordKind: "global_conservation";
  conservationLaw: string; // Algebraic equation (e.g. VaultBalance >= TotalPrincipal + Liabilities)
}

/**
 * 2. Instruction State Transition Invariant: Precondition, action, and postcondition
 * defining a specific instruction or CPI transition.
 */
export interface InstructionTransitionInvariant extends BaseInvariantRecord {
  recordKind: "instruction_transition";
  precondition: string;
  action: string;
  postcondition: string;
  conservationLaw?: string;
  expectedErrors: (string | ExpectedErrorSpec)[];
}

/**
 * 3. Metamorphic Relation: Algebraic relation invariant across multiple transformed runs or inputs.
 */
export interface MetamorphicRelationInvariant extends BaseInvariantRecord {
  recordKind: "metamorphic_relation";
  metamorphicRelation: string; // Relational formula (e.g. BuyBonds(2N) <=> BuyBonds(N) + BuyBonds(N))
}

export type InvariantRecord =
  | GlobalConservationInvariant
  | InstructionTransitionInvariant
  | MetamorphicRelationInvariant;
```

---

## 2. Invariant Record Schema Fields & Descriptions

| Field                     | Type           | Description                                                                                            | Example                                       |
| :------------------------ | :------------- | :----------------------------------------------------------------------------------------------------- | :-------------------------------------------- |
| **`id`**                  | `string`       | Unique identifier prefixed by subsystem (`INV-<DOMAIN>-<NUM>` or `MTR-<DOMAIN>-<NUM>`).                | `INV-DRAW-001`                                |
| **`domain`**              | `string`       | High-level subsystem or protocol module.                                                               | `Prize Draw / Randomness Reveal`              |
| **`vectorTag`**           | `enum`         | One of the 7 Solana test vectors: `Boundary`, `Lifecycle`, `Access`, `Math`, `Realloc`, `Time`, `CPI`. | `Time`                                        |
| **`provenance`**          | `enum`         | Source origin: `docs_canonical`, `code_mined`, or `user_resolved`.                                     | `user_resolved`                               |
| **`codeConformance`**     | `enum`         | Implementation status: `UNCHECKED`, `VERIFIED`, `DISCREPANCY_FLAGGED`, `UNIMPLEMENTED`.                | `VERIFIED`                                    |
| **`sourceLocation`**      | `string` (opt) | Source code citation file path and line number.                                                        | `anchor/src/instructions/draw.rs#L45`         |
| **`precondition`**        | `string`       | System state required prior to invocation.                                                             | `Draw in AwaitingRandomness state`            |
| **`action`**              | `string`       | The instruction, CPI, or crank invoked with parameters.                                                | `reveal_and_pick_winners(pool_id, cycle_id)`  |
| **`postcondition`**       | `string`       | Observable state mutation upon success.                                                                | `PayoutRegistry created with winning entries` |
| **`conservationLaw`**     | `string` (opt) | Algebraic equation that must balance before and after.                                                 | `sum(payouts) + fee == gross_yield`           |
| **`metamorphicRelation`** | `string` (opt) | Relational property across transformed inputs.                                                         | `WarpTime(2x) => HarvestYield(2x)`            |
| **`expectedErrors`**      | `array`        | Specific Anchor error variants required when boundaries fail.                                          | `["RandomnessNotReady", "PoolFrozen"]`        |

---

## 3. Invariant Specification Catalog Markdown Template

When emitting `docs/specs/invariants-<feature>.md`, use this standardized template:

```markdown
# Formal Invariant Specification: [Feature Name]

**Domain Context:** [Link to CONTEXT.md or relevant ADR]  
**Extracted At:** [Date / Timestamp]  
**Audit Mode:** `clean-room` | `brownfield-mining` | `reconciliation`  
**Overall Conformance:** [X/Y Verified, Z Flagged]

---

## 1. Global System Invariants & Conservation Laws

These algebraic invariants and conservation laws must ALWAYS hold across all instruction executions in this domain.

### `INV-[DOMAIN]-001`: [Invariant Title]

- **Domain:** [e.g. Solvency & Vault Accounting]
- **Vector Tag:** `Math`
- **Provenance:** `docs_canonical` | `code_mined` | `user_resolved`
- **Code Conformance:** `VERIFIED` | `DISCREPANCY_FLAGGED` | `UNCHECKED`
- **Source Location:** `[sell_bonds.rs#L45](file:///path/to/file#L45)`
- **Conservation Law:**
  $$\text{VaultBalance} \ge \sum_{i} \text{UserPrincipal}_i + \sum_{j} \text{UnclaimedPrizes}_j + \text{AccruedFees}$$
- **Description:** Total tokens held in the pool vault PDA must always equal or exceed all outstanding liabilities to depositors and prize winners.

---

## 2. Instruction State Transition & Boundary Invariants

### `INV-[DOMAIN]-002`: [Instruction Happy-Path Transition]

- **Domain:** [e.g. Draw Cycle]
- **Vector Tag:** `Lifecycle`
- **Provenance:** `code_mined`
- **Code Conformance:** `VERIFIED`
- **Source Location:** `[harvest.rs#L12](file:///path/to/file#L12)`
- **Precondition:** `PoolStatus == Active && pool.is_frozen == false && block_timestamp >= next_draw_time`
- **Action:** `harvest_yield_and_commit(pool_id)`
- **Postcondition:** `pool.is_frozen == true && draw_cycle.status == AwaitingRandomness`
- **Conservation Law:** `pool_pst_vault_after == pool_pst_vault_before`
- **Expected Errors:**
  - If `pool.is_frozen == true`: `ErrorCode::AwaitingRandomnessFreeze` (6007)
  - If `pool.status != Active`: `ErrorCode::PoolNotActive` (6000)

### `INV-[DOMAIN]-003`: [Boundary / Lockup Enforcement]

- **Domain:** [e.g. Randomness Reveal Window]
- **Vector Tag:** `Time`
- **Provenance:** `user_resolved`
- **Code Conformance:** `DISCREPANCY_FLAGGED`
- **Source Location:** `[reveal.rs#L88](file:///path/to/file#L88)`
- **Precondition:** `current_slot < freeze_slot + commit_window_slots`
- **Action:** `reveal_and_pick_winners(pool_id, cycle_id)`
- **Postcondition:** Instruction is rejected; state remains unmodified.
- **Expected Errors:** `["RandomnessNotReady", "CommitWindowActive"]`

---

## 3. Metamorphic Relations (Relational Properties)

- **`MTR-[DOMAIN]-001` (Scale Invariance):**
  - **Vector Tag:** `Math`
  - **Formula:**
    $$\text{BuyBonds}(2 \times N) \iff \text{BuyBonds}(N) \text{ followed by } \text{BuyBonds}(N) \quad (\text{yields identical contiguous cumulative index span})$$
- **`MTR-[DOMAIN]-002` (Monotonic Ticket Allocation):**
  - **Vector Tag:** `Boundary`
  - **Formula:**
    $$\forall i < j, \quad \text{UserEntry}[i].\text{cumulative\_active} < \text{UserEntry}[j].\text{cumulative\_active}$$

---

## 4. Unresolved Ambiguities & Open Decisions

| ID       | Topic          | Ambiguity / Anomaly                    |   Provenance    | Decision Status | Selected Formal Specification                                 |
| :------- | :------------- | :------------------------------------- | :-------------: | :-------------: | :------------------------------------------------------------ |
| `GAP-01` | Crank Timeout  | Switchboard randomness hangs for 48h.  | `user_resolved` |  **Resolved**   | 24h permissionless crank timeout (`admin_force_unlock_draw`). |
| `GAP-02` | Fee Truncation | Integer division dust on 5% fee split. | `user_resolved` |  **Resolved**   | Round down prize payout, round up protocol fee.               |
```
