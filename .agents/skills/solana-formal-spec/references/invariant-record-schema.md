# Canonical Invariant Record Schema & Specification Catalog Template

This reference document defines the formal schema and template for generating invariant specifications in the `solana-formal-spec` skill.

---

## 1. The 8-Tuple Invariant Record Schema

Every invariant in the specification catalog must follow this structured schema:

| Field                     | Type           | Description                                                                                            | Example                                                                        |
| :------------------------ | :------------- | :----------------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------- |
| **`id`**                  | `string`       | Unique identifier prefixed by subsystem. Format: `INV-<SUBSYSTEM>-<3-DIGIT-NUM>`.                      | `INV-DRAW-001`                                                                 |
| **`domain`**              | `string`       | High-level subsystem or protocol capability.                                                           | `Prize Draw / Randomness Reveal`                                               |
| **`vectorTag`**           | `enum`         | One of the 7 Solana test vectors: `Boundary`, `Lifecycle`, `Access`, `Math`, `Realloc`, `Time`, `CPI`. | `Time`                                                                         |
| **`precondition`**        | `string`       | System state that must be true before the action can succeed.                                          | `Draw in AwaitingRandomness state, current_slot >= freeze_slot + lockup_slots` |
| **`action`**              | `string`       | The instruction, CPI, or external crank invoked with parameters.                                       | `reveal_and_pick_winners(pool_id, cycle_id)`                                   |
| **`postcondition`**       | `string`       | The observable state change after successful execution.                                                | `PayoutRegistry created with winning entries, pool.is_frozen set to false`     |
| **`conservationLaw`**     | `string`       | Algebraic equation that must balance before and after execution.                                       | `sum(winner.amount_owed) + protocol_fee == gross_harvested_yield`              |
| **`metamorphicRelation`** | `string` (opt) | Relational property under transformed inputs.                                                          | `WarpTime(2x) => HarvestYield(2x) +/- fee delta`                               |
| **`expectedErrors`**      | `string[]`     | Specific Anchor error variants required when preconditions or boundaries fail.                         | `["RandomnessNotReady", "AwaitingRandomnessFreeze"]`                           |

---

## 2. Invariant Specification Catalog Markdown Template

When emitting `docs/specs/invariants-<feature>.md`, use this standardized template:

```markdown
# Formal Invariant Specification: [Feature Name]

**Domain Context:** [Link to CONTEXT.md or relevant ADR]  
**Extracted At:** [Date / Timestamp]  
**Audit Mode:** Clean-Room Zero-Code Extraction

---

## 1. Global System Invariants

These algebraic invariants and conservation laws must ALWAYS hold across all instruction executions in this domain.

### `INV-[DOMAIN]-001`: [Invariant Title]

- **Domain:** [e.g. YieldBonds / Prize Pool Solvency]
- **Vector Tag:** `Math`
- **Conservation Law:**
  $$\text{VaultBalance} \ge \sum_{i} \text{UserPrincipal}_i + \sum_{j} \text{UnclaimedPrizes}_j + \text{AccruedFees}$$
- **Description:** Total tokens held in the pool vault PDA must always equal or exceed all outstanding liabilities to depositors and prize winners.

---

## 2. Instruction State Transition & Boundary Invariants

### `INV-[DOMAIN]-002`: [Instruction Happy-Path Transition]

- **Domain:** [e.g. Draw Cycle]
- **Vector Tag:** `Lifecycle`
- **Precondition:** `PoolStatus == Active && pool.is_frozen == false && block_timestamp >= next_draw_time`
- **Action:** `harvest_yield_and_commit(pool_id)`
- **Postcondition:** `pool.is_frozen == true && draw_cycle.status == AwaitingRandomness`
- **Conservation Law:** `pool_pst_vault_after == pool_pst_vault_before`
- **Expected Errors:**
  - If `pool.is_frozen == true`: `ErrorCode::AwaitingRandomnessFreeze`
  - If `pool.status != Active`: `ErrorCode::PoolNotActive`

### `INV-[DOMAIN]-003`: [Boundary / Lockup Enforcement]

- **Domain:** [e.g. Randomness Reveal Window]
- **Vector Tag:** `Time`
- **Precondition:** `current_slot < freeze_slot + commit_window_slots`
- **Action:** `reveal_and_pick_winners(pool_id, cycle_id)`
- **Postcondition:** Instruction is rejected; state remains unmodified.
- **Expected Errors:** `["RandomnessNotReady", "CommitWindowActive"]`

---

## 3. Metamorphic Relations (Relational Properties)

- **`MTR-[DOMAIN]-001` (Scale Invariance):**
  $$\text{BuyBonds}(2 \times N) \iff \text{BuyBonds}(N) \text{ followed by } \text{BuyBonds}(N) \quad (\text{yields identical contiguous cumulative index span})$$
- **`MTR-[DOMAIN]-002` (Monotonic Ticket Allocation):**
  $$\forall i < j, \quad \text{UserEntry}[i].\text{cumulative\_active} < \text{UserEntry}[j].\text{cumulative\_active}$$

---

## 4. Unresolved Ambiguities & Open Decisions

| ID       | Topic         | Ambiguity / Gap                                                      | Decision Status | Selected Resolution                                                        |
| :------- | :------------ | :------------------------------------------------------------------- | :-------------: | :------------------------------------------------------------------------- |
| `GAP-01` | Crank Timeout | What happens if Switchboard randomness fails to reveal for 48 hours? |  **Resolved**   | Crank fallback unlocks pool after 24h timeout (`admin_force_unlock_draw`). |
| `GAP-02` | Dust Rounding | Odd atomic division remainder on 5% fee split.                       |  **Resolved**   | Round down prize payout, round up protocol fee.                            |
```
