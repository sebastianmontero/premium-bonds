# Formal Invariant Specification: YieldBonds Protocol

**Domain Context:** [README.md](file:///home/sebastian/vsc-workspace/premium-bonds/README.md), [ticket-registry-redesign.md](file:///home/sebastian/vsc-workspace/premium-bonds/ticket-registry-redesign.md), [docs/agents/domain.md](file:///home/sebastian/vsc-workspace/premium-bonds/docs/agents/domain.md)  
**Extracted At:** 2026-08-26  
**Audit Mode:** Clean-Room Zero-Code Extraction (Phase 1)

---

## 1. Global System Invariants & Conservation Laws

These algebraic invariants and conservation laws must ALWAYS hold across all instruction executions in the YieldBonds protocol.

### `INV-SOLV-001`: Protocol Solvency & Vault Backing
- **Domain:** Solvency & Vault Accounting
- **Vector Tag:** `Math`
- **Conservation Law:**
  $$\text{VaultBalance} \ge \sum_{i} \text{UserPrincipal}_i + \sum_{j} \text{UnclaimedPrizes}_j + \sum_{k} \text{UnclaimedDust}_k + \text{AccruedFees}$$
- **Description:** The underlying token vault PDA (e.g. USDC / Huma PST) must always hold sufficient assets to cover 100% of outstanding depositor principal, pending/unclaimed prize payouts, accumulated user dust balances, and accrued protocol fees.

### `INV-SOLV-002`: Ticket Registry Mass Conservation
- **Domain:** Ticket Registry Accounting
- **Vector Tag:** `Math`
- **Conservation Law:**
  $$\text{TicketRegistry.total\_active\_tickets} + \text{TicketRegistry.total\_pending\_tickets} = \sum_{i=0}^{\text{user\_count}-1} (\text{UserEntry}[i].\text{active} + \text{UserEntry}[i].\text{pending})$$
- **Description:** The global ticket counters on the `TicketRegistry` account header must exactly match the aggregate sum of all individual user entry active and pending ticket weights at all times.

### `INV-SOLV-003`: User Index Bijective PDA Mapping
- **Domain:** User Registry State
- **Vector Tag:** `Access`
- **Conservation Law:**
  $$\forall i \in [0, \text{user\_count}-1], \quad \text{UserWinnings}(\text{UserEntry}[i].\text{owner}).\text{registry\_entry\_index} = i$$
  $$\forall \text{user} \notin \text{TicketRegistry}, \quad \text{UserWinnings}(\text{user}).\text{registry\_entry\_index} = \text{u32::MAX}$$
- **Description:** Every registered user entry at index $i$ in the `TicketRegistry` must have a corresponding `UserWinnings` PDA where `registry_entry_index == i`. Non-registered users must strictly hold `registry_entry_index == u32::MAX`.

---

## 2. Instruction State Transition & Boundary Invariants

### 2.1 Bond Purchasing & Ticket Issuance (`buy_bonds`)

#### `INV-BOND-001`: New User Bond Purchase
- **Domain:** Bond Purchasing
- **Vector Tag:** `Lifecycle`
- **Precondition:** `user_winnings.registry_entry_index == u32::MAX && registry.user_count < registry.capacity && !pool.is_frozen_for_draw && bonds_to_buy > 0`
- **Action:** `buy_bonds(bonds_to_buy)`
- **Postcondition:**
  - `user_winnings.registry_entry_index = old(registry.user_count)`
  - `new_entry.owner = user.key()`
  - `new_entry.pending = bonds_to_buy`, `new_entry.active = 0`, `new_entry.merged_through_cycle = registry.draw_cycle_id`
  - `registry.user_count = old(registry.user_count) + 1`
  - `registry.total_pending_tickets = old(registry.total_pending_tickets) + bonds_to_buy`
- **Conservation Law:**
  $$\Delta \text{VaultBalance} = \text{bonds\_to\_buy} \times \text{pool.bond\_price}$$
- **Expected Errors:**
  - If `bonds_to_buy == 0`: `ErrorCode::ZeroAmount` or `ErrorCode::InvalidBondQuantity`
  - If `registry.user_count >= registry.capacity`: `ErrorCode::RegistryFull`
  - If `pool.is_frozen_for_draw == true`: `ErrorCode::PoolFrozen`

#### `INV-BOND-002`: Existing User Bond Purchase with Lazy Merge
- **Domain:** Bond Purchasing
- **Vector Tag:** `Lifecycle`
- **Precondition:** `user_winnings.registry_entry_index < registry.user_count && !pool.is_frozen_for_draw && bonds_to_buy > 0`
- **Action:** `buy_bonds(bonds_to_buy)`
- **Postcondition:**
  - If `entry.merged_through_cycle < registry.draw_cycle_id`: `entry.active += entry.pending`, `entry.pending = 0`, `entry.merged_through_cycle = registry.draw_cycle_id`
  - `entry.pending = old(entry.pending) + bonds_to_buy`
  - `registry.total_pending_tickets = old(registry.total_pending_tickets) + bonds_to_buy`
- **Conservation Law:**
  $$\Delta \text{VaultBalance} = \text{bonds\_to\_buy} \times \text{pool.bond\_price}$$
- **Expected Errors:**
  - If `entry.owner != user.key()`: `ErrorCode::InvalidUserEntryHint`
  - If `pool.is_frozen_for_draw == true`: `ErrorCode::PoolFrozen`

---

### 2.2 Bond Redemptions & Exit (`sell_bonds`)

#### `INV-SELL-001`: Partial Bond Sale
- **Domain:** Bond Redemptions
- **Vector Tag:** `Boundary`
- **Precondition:** `user_winnings.registry_entry_index < registry.user_count && !pool.is_frozen_for_draw && (active_to_sell <= entry.active) && (pending_to_sell <= entry.pending) && (entry.active - active_to_sell + entry.pending - pending_to_sell > 0)`
- **Action:** `sell_bonds(active_to_sell, pending_to_sell)`
- **Postcondition:**
  - `entry.active = old(entry.active) - active_to_sell`
  - `entry.pending = old(entry.pending) - pending_to_sell`
  - `registry.total_active_tickets -= active_to_sell`
  - `registry.total_pending_tickets -= pending_to_sell`
  - `user_winnings.registry_entry_index` remains unchanged.
- **Conservation Law:**
  $$\Delta \text{PendingRedemptions} = (\text{active\_to\_sell} + \text{pending\_to\_sell}) \times \text{pool.bond\_price}$$
- **Expected Errors:**
  - If `active_to_sell > entry.active`: `ErrorCode::InsufficientActiveTickets`
  - If `pending_to_sell > entry.pending`: `ErrorCode::InsufficientPendingTickets`
  - If `pool.is_frozen_for_draw == true`: `ErrorCode::PoolFrozen`

#### `INV-SELL-002`: Full Pool Exit & Swap-and-Pop Index Relocation
- **Domain:** Bond Redemptions / Swap-and-Pop
- **Vector Tag:** `Realloc`
- **Precondition:** `user_winnings.registry_entry_index < registry.user_count && (active_to_sell == entry.active) && (pending_to_sell == entry.pending)`
- **Action:** `sell_bonds(active_to_sell, pending_to_sell)`
- **Postcondition:**
  - Caller `user_winnings.registry_entry_index = u32::MAX`
  - If `caller_idx != registry.user_count - 1`:
    - `last_entry = registry.entries[registry.user_count - 1]` copied to `caller_idx`
    - `swapped_user_winnings.registry_entry_index = caller_idx`
  - Popped slot at `registry.user_count - 1` zeroed out.
  - `registry.user_count = old(registry.user_count) - 1`
- **Conservation Law:**
  $$\text{registry.user\_count}_{\text{after}} = \text{registry.user\_count}_{\text{before}} - 1$$
- **Expected Errors:**
  - If `caller_idx != last_idx` and `swapped_user_winnings` remaining account is missing: `ErrorCode::MissingSwappedUserWinnings`
  - If `swapped_user_winnings` PDA seeds or ownership invalid: `ErrorCode::InvalidUserEntryHint`

---

### 2.3 Yield Harvesting & Draw Commitment (`harvest_yield_and_commit`)

#### `INV-HARV-001`: Yield Harvest & Draw Lockup Transition
- **Domain:** Yield Draw / Commitment
- **Vector Tag:** `Lifecycle`
- **Precondition:** `!pool.is_frozen_for_draw && clock.unix_timestamp >= pool.next_draw_time && draw_cycle.status == Draft`
- **Action:** `harvest_yield_and_commit(pool_id)`
- **Postcondition:**
  - Gross yield harvested from external venue (Huma / Kamino).
  - Protocol fee: $\lfloor \text{gross\_yield} \times \text{fee\_bps} / 10000 \rfloor$
  - Net prize pot: $\lfloor \text{gross\_yield} - \text{fee} \rfloor$ (Standard integer truncation; remainder dust retained in vault).
  - `pool.is_frozen_for_draw = true`
  - `draw_cycle.status = AwaitingRandomness`
  - `draw_cycle.prize_pot = net_prize_pot`
  - `registry.total_active_tickets += registry.total_pending_tickets`
  - `registry.total_pending_tickets = 0`
  - `registry.draw_cycle_id += 1`
  - `registry.draw_prepared_up_to = 0`
- **Conservation Law:**
  $$\text{net\_prize\_pot} + \text{protocol\_fee} + \text{vault\_dust\_remainder} = \text{gross\_harvested\_yield}$$
- **Expected Errors:**
  - If `pool.is_frozen_for_draw == true`: `ErrorCode::PoolFrozen`
  - If `clock.unix_timestamp < pool.next_draw_time`: `ErrorCode::DrawWindowNotElapsed`

---

### 2.4 Batched Draw Preparation (`prepare_draw`)

#### `INV-PREP-001`: Batched Lazy Merge & Prefix Sum Computation
- **Domain:** Draw Preparation
- **Vector Tag:** `Time`
- **Precondition:** `pool.is_frozen_for_draw == true && draw_cycle.status == AwaitingRandomness && registry.draw_prepared_up_to < registry.user_count`
- **Action:** `prepare_draw(batch_size)`
- **Postcondition:**
  - Let $\text{start} = \text{registry.draw\_prepared\_up\_to}$, $\text{end} = \min(\text{start} + \text{batch\_size}, \text{registry.user\_count})$.
  - For each $i \in [\text{start}, \text{end}-1]$:
    - If `entry[i].merged_through_cycle < registry.draw_cycle_id`: `entry[i].active += entry[i].pending`, `entry[i].pending = 0`, `entry[i].merged_through_cycle = registry.draw_cycle_id`.
    - `entry[i].cumulative_active = entry[i-1].cumulative_active + entry[i].active` (or `entry[0].active` if $i=0$).
  - `registry.draw_prepared_up_to = end`
- **Conservation Law:**
  $$\text{registry.entries}[\text{end}-1].\text{cumulative\_active} = \sum_{i=0}^{\text{end}-1} \text{registry.entries}[i].\text{active}$$
- **Expected Errors:**
  - If `!pool.is_frozen_for_draw`: `ErrorCode::PoolNotFrozen`
  - If `draw_cycle.status != AwaitingRandomness`: `ErrorCode::InvalidDrawStatus`
  - If `batch_size == 0`: `ErrorCode::InvalidBatchSize`

---

### 2.5 Randomness Reveal & Winner Selection (`reveal_and_pick_winners`)

#### `INV-DRAW-001`: VRF Winner Derivation via Binary Search
- **Domain:** Prize Draw / Winner Selection
- **Vector Tag:** `Math`
- **Precondition:** `pool.is_frozen_for_draw == true && draw_cycle.status == AwaitingRandomness && registry.draw_prepared_up_to == registry.user_count && vrf_randomness.is_resolved()`
- **Action:** `reveal_and_pick_winners(pool_id, cycle_id)`
- **Postcondition:**
  - For each tier $t$ and winning index $k$:
    - Derive uniform pseudo-random ticket: $R = \text{derive\_random\_index}(\text{seed}, t, k, \text{cycle\_id}) \pmod{\text{total\_active\_tickets}}$
    - Binary search on `cumulative_active` finds unique winner entry $w$ where:
      $$\text{entries}[w-1].\text{cumulative\_active} \le R < \text{entries}[w].\text{cumulative\_active}$$
    - Winner recorded in `PayoutRegistry`.
  - `pool.is_frozen_for_draw = false`
  - `draw_cycle.status = Completed`
- **Conservation Law:**
  $$\sum \text{PayoutRegistry.winner\_amounts} \le \text{draw\_cycle.prize\_pot}$$
- **Expected Errors:**
  - If `registry.draw_prepared_up_to < registry.user_count`: `ErrorCode::DrawNotPrepared`
  - If VRF randomness not fulfilled: `ErrorCode::RandomnessNotReady`
  - If `draw_cycle.status != AwaitingRandomness`: `ErrorCode::InvalidDrawStatus`

---

### 2.6 Winner Payout Reinvestment & Dust Aggregation (`reinvest_winnings`)

#### `INV-REINV-001`: Prize Auto-Reinvestment with Multi-Cycle Dust Aggregation
- **Domain:** Prize Payouts & Dust Accounting
- **Vector Tag:** `Math`
- **Precondition:** `winner_winnings.registry_entry_index < registry.user_count && payout.is_winning && !payout.is_processed`
- **Action:** `reinvest_winnings(pool_id, cycle_id, winner_idx)`
- **Postcondition:**
  - $\text{TotalAvailable} = \text{winner\_prize\_amount} + \text{winner\_winnings.unclaimed\_non\_reinvested\_winnings}$
  - $\text{BondsToMint} = \min(\lfloor \text{TotalAvailable} / \text{bond\_price} \rfloor, \text{max\_bonds\_per\_batch})$
  - $\text{ReinvestedValue} = \text{BondsToMint} \times \text{bond\_price}$
  - $\text{LeftoverDust} = \text{TotalAvailable} - \text{ReinvestedValue}$
  - `winner_entry.active += BondsToMint`
  - `registry.total_active_tickets += BondsToMint`
  - `winner_winnings.unclaimed_non_reinvested_winnings = LeftoverDust`
  - `winner_winnings.total_reinvested += ReinvestedValue`
- **Conservation Law:**
  $$\text{ReinvestedValue} + \text{winner\_winnings.unclaimed\_non\_reinvested\_winnings} = \text{winner\_prize\_amount} + \text{old(winner\_winnings.unclaimed\_non\_reinvested\_winnings)}$$
- **Expected Errors:**
  - If winner not registered: `ErrorCode::InvalidUserEntryHint`
  - If payout already fully settled: `ErrorCode::PayoutAlreadyProcessed`

---

### 2.7 Administrative Controls & Emergency Unlocking (`admin_force_unlock_draw`)

#### `INV-ADMIN-001`: Multisig Emergency Draw Force Unlock
- **Domain:** Admin & Emergency Controls
- **Vector Tag:** `Access`
- **Precondition:** `admin.is_signer && admin.key() == global_config.admin_authority && pool.is_frozen_for_draw == true && current_draw_cycle.status == AwaitingRandomness`
- **Action:** `admin_force_unlock_draw(pool_id)`
- **Postcondition:**
  - `pool.is_frozen_for_draw = false`
  - `current_draw_cycle.status = Draft` (or aborted state)
  - Depositors and redemptions unblocked.
- **Conservation Law:**
  $$\text{TotalVaultBalance}_{\text{after}} = \text{TotalVaultBalance}_{\text{before}}$$
- **Expected Errors:**
  - If signer is not `global_config.admin_authority`: `ErrorCode::UnauthorizedAdmin`
  - If `pool.is_frozen_for_draw == false`: `ErrorCode::PoolNotFrozen`

---

## 3. Metamorphic Relations (Relational Properties)

- **`MTR-BOND-001` (Scale Invariance):**
  $$\text{BuyBonds}(2 \times N) \iff \text{BuyBonds}(N) \text{ followed by } \text{BuyBonds}(N) \quad (\text{yields identical contiguous cumulative active span})$$

- **`MTR-PREP-001` (Batch Size Equivalence):**
  $$\text{PrepareDraw}(\text{batch\_size}=100) \times 10 \iff \text{PrepareDraw}(\text{batch\_size}=1000) \times 1 \quad (\forall i, \text{entries}[i].\text{cumulative\_active} \text{ are identical})$$

- **`MTR-DRAW-001` (Monotonic Ticket Prefix Ordering):**
  $$\forall i < j, \quad \text{UserEntry}[i].\text{cumulative\_active} < \text{UserEntry}[j].\text{cumulative\_active} \quad (\text{strictly increasing prefix sums if } \text{active} > 0)$$

- **`MTR-REINV-001` (Dust Aggregation Invariance):**
  $$\text{Reinvest}(\text{Prize}_A) \text{ then } \text{Reinvest}(\text{Prize}_B) \implies \text{TotalMintedBonds} = \lfloor (\text{Prize}_A + \text{Prize}_B) / \text{bond\_price} \rfloor$$

---

## 4. Resolved Architectural Decisions & Domain Rules

| ID | Topic | Ambiguity / Edge Case | Decision Status | Selected Formal Specification |
| :--- | :--- | :--- | :---: | :--- |
| `GAP-01` | Yield Fee Split Rounding | Integer division dust remainder on fee/pot split. | **Resolved** | Standard integer truncation: both protocol fee and prize pot round down; remainder atomic dust is retained in the vault reserve. |
| `GAP-02` | Oracle Hang Recovery | Switchboard VRF randomness stall or timeout. | **Resolved** | Privileged admin multisig force-unlock only (`admin_force_unlock_draw`). Only protocol authority can reset freeze status. |
| `GAP-03` | Prize Reinvestment Dust | Leftover fractional winnings ($< \text{bond\_price}$). | **Resolved** | Credit dust to `UserWinnings.unclaimed_non_reinvested_winnings` for withdrawal, and automatically consume existing dust to complement future reinvestments. |
| `GAP-04` | Full Exit Concurrency | Zeroing out user entry on complete bond sale. | **Resolved** | Swap-and-pop with mandatory remaining account for the swapped user's `UserWinnings` PDA. Fails with `MissingSwappedUserWinnings` if omitted. |
| `GAP-05` | Zero Amount Guard | Attempting zero-amount bond deposits or sells. | **Resolved** | Strictly reject zero-amount inputs (`ErrorCode::ZeroAmount` / `ErrorCode::InvalidBondQuantity`) to prevent no-op spam and state bloat. |
