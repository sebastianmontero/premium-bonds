# Spec-Code Reconciliation & Drift QA Report: YieldBonds Protocol

**Target Protocol:** YieldBonds Protocol (`anchor/programs/anchor`)  
**Specification Reference:** [`docs/specs/invariants-yieldbonds.md`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md)  
**Evaluated At:** 2026-09-16  
**Reconciliation Status:** `100% CONFORMANCE (VERIFIED)`  
**Audit Protocol:** `solana-formal-spec` (Mode 3 Reconciliation & Drift Analysis)

---

## 1. Executive Summary & Conformance Scorecard

A full 2-pass AST code mining sweep was performed across all 26 Anchor instruction handlers, 7 state account structs, constants, error enums, and CPI modules in `anchor/programs/anchor/src/**`. The mined on-chain implementation was reconciled against the protocol's Single Source of Truth (SSOT) formal invariant specification.

All 4 previously undocumented instructions (`nominate_admin`, `cancel_admin_nomination`, `accept_admin`, `crank_close_payout_registry`), 15 previously unmapped Anchor error codes (`6051` through `6065`), dynamic payout registry scaling, and governance/rent-reclaim FSMs have been verified, synchronized, and incorporated directly into the formal specification.

| Verification Dimension    | Ingested / Expected | Code Verified | Discrepancies Flagged | Conformance Rate |
| :------------------------ | :-----------------: | :-----------: | :-------------------: | :--------------: |
| **Instruction Handlers**  |         26          |      26       |           0           |    **100.0%**    |
| **Global Solvency Laws**  |          8          |       8       |           0           |    **100.0%**    |
| **State Account Layouts** |          7          |       7       |           0           |    **100.0%**    |
| **Lifecycle FSM Models**  | 4 (Pool, Draw, Gov, Payout) | 4   |           0           |    **100.0%**    |
| **Metamorphic Relations** |         10          |      10       |           0           |    **100.0%**    |
| **Anchor Error Codes**    | 66 (`6000`–`6065`)  |      66       |           0           |    **100.0%**    |
| **Circuit Breakers**      |          2          |       2       |           0           |    **100.0%**    |

---

## 2. Invariant-to-Code Traceability Matrix

Every on-chain Anchor instruction handler has been mapped 1-to-1 with its formal transition invariant record and source file location:

| Invariant ID                                                                                                                                                                         | Instruction Name                  | Subsystem    |        Vector Tag         | On-Chain Source File & Line Range                                                                                                                                                                | Conformance Status |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------- | :----------- | :-----------------------: | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :----------------: |
| [`INV-CONF-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-001-protocol-global-initialization-initialize_global)               | `initialize_global`               | Governance   |         `Access`          | [`initialize_global.rs#L8-L82`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/initialize_global.rs#L8-L82)                                    |     `VERIFIED`     |
| [`INV-CONF-002`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-002-global-config-authority-update-update_global_config)            | `update_global_config`            | Governance   |         `Access`          | [`update_global_config.rs#L8-L70`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/update_global_config.rs#L8-L70)                              |     `VERIFIED`     |
| [`INV-CONF-003`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-003-two-step-admin-transfer-nomination-nominate_admin)            | `nominate_admin`                  | Governance   |  `Access` / `Lifecycle`   | [`nominate_admin.rs#L8-L57`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/nominate_admin.rs#L8-L57)                                          |     `VERIFIED`     |
| [`INV-CONF-004`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-004-pending-admin-nomination-cancellation-cancel_admin_nomination) | `cancel_admin_nomination`         | Governance   |  `Access` / `Lifecycle`   | [`cancel_admin_nomination.rs#L8-L48`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/cancel_admin_nomination.rs#L8-L48)                        |     `VERIFIED`     |
| [`INV-CONF-005`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-005-pending-admin-role-acceptance-accept_admin)                     | `accept_admin`                    | Governance   |  `Access` / `Lifecycle`   | [`accept_admin.rs#L8-L52`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/accept_admin.rs#L8-L52)                                              |     `VERIFIED`     |
| [`INV-POOL-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-001-prize-pool-creation-create_pool)                                | `create_pool`                     | Pool Admin   | `Boundary` / `Lifecycle`  | [`create_pool.rs#L12-L220`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/create_pool.rs#L12-L220)                                            |     `VERIFIED`     |
| [`INV-POOL-002`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-002-prize-pool-config-update-update_pool_config)                    | `update_pool_config`              | Pool Admin   |   `Boundary` / `Access`   | [`update_pool_config.rs#L8-L157`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/update_pool_config.rs#L8-L157)                                |     `VERIFIED`     |
| [`INV-POOL-003`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-003-prize-tier-configuration-set_prize_tiers)                       | `set_prize_tiers`                 | Pool Admin   |          `Math`           | [`set_prize_tiers.rs#L7-L81`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/set_prize_tiers.rs#L7-L81)                                        |     `VERIFIED`     |
| [`INV-POOL-004a`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-004a-emergency-pool-pause-pause_pool)                              | `pause_pool`                      | Emergency    |  `Access` / `Lifecycle`   | [`emergency_pause.rs#L7-L58`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/emergency_pause.rs#L7-L58)                                        |     `VERIFIED`     |
| [`INV-POOL-004b`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-004b-pool-unpause-unpause_pool)                                    | `unpause_pool`                    | Emergency    |  `Access` / `Lifecycle`   | [`emergency_pause.rs#L60-L111`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/emergency_pause.rs#L60-L111)                                    |     `VERIFIED`     |
| [`INV-POOL-005`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-005-permanent-pool-closure-close_pool)                              | `close_pool`                      | Pool Admin   |        `Lifecycle`        | [`emergency_pause.rs#L113-L168`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/emergency_pause.rs#L113-L168)                                  |     `VERIFIED`     |
| [`INV-POOL-006`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-006-ticket-registry-capacity-resizing-resize_registry)              | `resize_registry`                 | Registry     |         `Realloc`         | [`resize_registry.rs#L8-L75`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/resize_registry.rs#L8-L75)                                        |     `VERIFIED`     |
| [`INV-LEND-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-lend-001-huma-lender-binding-initialize_huma_lender)                     | `initialize_huma_lender`          | Lending CPI  |     `CPI` / `Access`      | [`initialize_huma_lender.rs#L10-L151`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/initialize_huma_lender.rs#L10-L151)                      |     `VERIFIED`     |
| [`INV-FEE-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-fee-001-protocol-fee-extraction-withdraw_fees)                            | `withdraw_fees`                   | Treasury     | `Access` / `Math` / `CPI` | [`withdraw_fees.rs#L12-L282`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/withdraw_fees.rs#L12-L282)                                        |     `VERIFIED`     |
| [`INV-BOND-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-bond-001-new-user-bond-purchase-buy_bonds)                               | `buy_bonds` (New)                 | Bond Flow    |    `Lifecycle` / `CPI`    | [`buy_bonds.rs#L11-L271`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/buy_bonds.rs#L11-L271)                                                 |     `VERIFIED`     |
| [`INV-BOND-002`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-bond-002-existing-user-bond-purchase-with-lazy-merge-buy_bonds)          | `buy_bonds` (Existing)            | Bond Flow    |    `Lifecycle` / `CPI`    | [`buy_bonds.rs#L249-L258`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/buy_bonds.rs#L249-L258)                                               |     `VERIFIED`     |
| [`INV-SELL-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-sell-001-partial-bond-sale-sell_bonds)                                   | `sell_bonds` (Partial)            | Bond Flow    |    `Boundary` / `CPI`     | [`sell_bonds.rs#L10-L345`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/sell_bonds.rs#L10-L345)                                               |     `VERIFIED`     |
| [`INV-SELL-002`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-sell-002-full-pool-exit--swap-and-pop-index-relocation-sell_bonds)       | `sell_bonds` (Exit)               | Swap-and-Pop |   `Realloc` / `Access`    | [`sell_bonds.rs#L220-L241`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/sell_bonds.rs#L220-L241)                                             |     `VERIFIED`     |
| [`INV-REDM-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-redm-001-asynchronous-redemption-settlement-claim_redemption)            | `claim_redemption`                | Settlement   |      `Time` / `CPI`       | [`claim_redemption.rs#L11-L262`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/claim_redemption.rs#L11-L262)                                   |     `VERIFIED`     |
| [`INV-HARV-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-harv-001-yield-harvest--draw-commitment-harvest_yield_and_commit)        | `harvest_yield_and_commit`        | Draw Engine  |   `Lifecycle` / `Time`    | [`harvest_yield_and_commit.rs#L43-L342`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/harvest_yield_and_commit.rs#L43-L342)             |     `VERIFIED`     |
| [`INV-PREP-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-prep-001-batched-lazy-merge--prefix-sum-computation-prepare_draw)        | `prepare_draw`                    | Draw Engine  |   `Time` / `Lifecycle`    | [`prepare_draw.rs#L8-L91`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/prepare_draw.rs#L8-L91)                                         |     `VERIFIED`     |
| [`INV-DRAW-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-draw-001-vrf-winner-selection-via-binary-search-reveal_and_pick_winners) | `reveal_and_pick_winners`         | Draw Engine  |      `Math` / `Time`      | [`reveal_and_pick_winners.rs#L12-L244`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reveal_and_pick_winners.rs#L12-L244)               |     `VERIFIED`     |
| [`INV-VRF-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-vrf-001-stale-randomness-rebinding-crank_rebind_expired_randomness)       | `crank_rebind_expired_randomness` | Oracle Recov |   `Time` / `Lifecycle`    | [`crank_rebind_expired_randomness.rs#L7-L142`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/crank_rebind_expired_randomness.rs#L7-L142) |     `VERIFIED`     |
| [`INV-REINV-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-reinv-001-multi-cycle-dust-aggregated-reinvestment-reinvest_winnings)   | `reinvest_winnings`               | Prize Engine |   `Math` / `Lifecycle`    | [`reinvest_winnings.rs#L9-L254`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs#L9-L254)                             |     `VERIFIED`     |
| [`INV-CLAIM-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-claim-001-user-dust-winnings-withdrawal-claim_non_reinvested_winnings)  | `claim_non_reinvested_winnings`   | User Claims  |    `Boundary` / `CPI`     | [`claim_non_reinvested_winnings.rs#L9-L267`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/claim_non_reinvested_winnings.rs#L9-L267)     |     `VERIFIED`     |
| [`INV-ADMIN-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-admin-001-multisig-emergency-draw-force-unlock-admin_force_unlock_draw) | `admin_force_unlock_draw`         | Emergency    |  `Access` / `Lifecycle`   | [`admin_force_unlock_draw.rs#L8-L96`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/admin_force_unlock_draw.rs#L8-L96)                 |     `VERIFIED`     |
| [`INV-VOID-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-void-001-admin-void-payout-registry-rollback-admin_void_payout_registry) | `admin_void_payout_registry`      | Emergency    |  `Lifecycle` / `Access`   | [`admin_void_payout_registry.rs#L9-L106`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/admin_void_payout_registry.rs#L9-L106)           |     `VERIFIED`     |
| [`INV-PAY-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pay-001-payout-registry-rent-reclaim-crank_close_payout_registry)          | `crank_close_payout_registry`     | Rent Reclaim |  `Lifecycle` / `Access`   | [`crank_close_payout_registry.rs#L8-L65`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/crank_close_payout_registry.rs#L8-L65)           |     `VERIFIED`     |

---

## 3. Clean-Room vs. Brownfield Drift & Architectural Alignments Log

During Phase 2 and Phase 3 code mining, 14 key structural, lifecycle, and mathematical alignments were extracted from the codebase to synchronize the formal specification with on-chain reality:

### 1. `UserEntry` Memory Layout (64 Bytes vs. 48 Bytes)

- **Clean-Room Assumption:** Theorized 48-byte `UserEntry` records and capacity calculated as `REGISTRY_INITIAL_SIZE / 48`.
- **On-Chain Reality:** [`UserEntry`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/registry.rs#L107-L124) is 64 bytes (`owner: Pubkey` [32], `active: u32` [4], `pending: u32` [4], `merged_through_cycle: u32` [4], `cumulative_active: u32` [4], `version: u8` [1], `_padding: [u8; 3]` [3], `_reserved: [u8; 12]` [12]).
- **Alignment:** Ticket registry header is 104 bytes (`DISCRIMINATOR` 8 + struct fields 96). Capacity is $\lfloor (\text{data\_len} - 104) / 64 \rfloor$, with initial allocation of 262,248 bytes (4,096 entries) and realloc step of 10,240 bytes (160 entries).

### 2. Pool Creation Lifecycle (`Active` vs. `Draft`)

- **Clean-Room Assumption:** Hypothesized pools initialize in a `Draft` status and transition to `Active` on separate prize tier configuration.
- **On-Chain Reality:** [`create_pool`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/admin/create_pool.rs#L125-L220) accepts `prize_tiers` as a required parameter, validates them on initialization, and sets `pool.status = PoolStatus::Active as u8` directly.
- **Alignment:** Pool lifecycle FSM strictly models 3 states: `Active (0)`, `Paused (1)`, `Closed (2)`.

### 3. Draw Cycle FSM & Circuit Breakers (8 States vs. 4 Generic Phases)

- **Clean-Room Assumption:** 4 generic lifecycle steps without on-chain circuit breaker terminal states.
- **On-Chain Reality:** [`DrawStatus`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/draw.rs#L7-L24) defines 8 distinct states: `AwaitingYield`, `AwaitingRandomness`, `Complete`, `ForceUnlocked`, `Skipped`, `Voided`, `HaltedInsolvent`, `HaltedYieldSpike`.
- **Alignment:** Added formal transition invariants for [`INV-HARV-002`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-harv-002-solvency-circuit-breaker-harvest_yield_and_commit) (deficit $> 1,000$ base units) and [`INV-HARV-003`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-harv-003-yield-velocity-spike-circuit-breaker-harvest_yield_and_commit) (single-cycle yield velocity breach).

### 4. Prize Tier Share Conservation & Dynamic Sizing Boundary (`MAX_TOTAL_WINNERS = 180`)

- **Clean-Room Assumption:** Fixed 50-winner cap (2,904 bytes).
- **On-Chain Reality:** In [`PrizeTier`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/pool.rs#L31-L38), `basis_points` represents the basis points _per winner_. The total winner allocation cap was updated to 180 to safely maximize Solana's 10 KiB account allocation limit ($104 + 180 \times 56 = 10,184$ B).
- **Alignment:** Calibrated conservation law [`INV-SOLV-005`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-solv-005-prize-tier-share-conservation--winner-allocation) to $\sum (\text{basis\_points} \times \text{num\_winners}) = 10,000$ and $\sum \text{num\_winners} \le 180$.

### 5. Two-Step Protocol Governance FSM

- **Clean-Room Assumption:** Direct single-step admin modification in `update_global_config`.
- **On-Chain Reality:** Admin authority transfer uses a two-step nomination and acceptance flow (`nominate_admin`, `cancel_admin_nomination`, `accept_admin`) to protect against irreparable transfer to mistyped/dead keys.
- **Alignment:** Standardized in [`INV-CONF-003`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-003-two-step-admin-transfer-nomination-nominate_admin), [`INV-CONF-004`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-004-pending-admin-nomination-cancellation-cancel_admin_nomination), and [`INV-CONF-005`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-conf-005-pending-admin-role-acceptance-accept_admin).

### 6. Payout Registry Dynamic Allocation & Rent Reclaim

- **Clean-Room Assumption:** Static pre-allocated 50-winner payout table with unrecoverable rent.
- **On-Chain Reality:** [`reveal_and_pick_winners`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reveal_and_pick_winners.rs#L66-L73) calculates exact space requirements on initialization, while [`crank_close_payout_registry`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/crank_close_payout_registry.rs#L8-L66) allows permissionless 100% rent reclaim once all payouts are processed or voided.
- **Alignment:** Documented in [`INV-PAY-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pay-001-payout-registry-rent-reclaim-crank_close_payout_registry) and FSM Model 3.4.

### 7. Token-2022 Mint Extension Whitelist

- **Clean-Room Assumption:** Generic SPL token interface acceptance.
- **On-Chain Reality:** [`assert_supported_mint_extensions`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/utils.rs#L224-L255) strictly rejects mints configured with `TransferFeeConfig`, `TransferHook`, `PermanentDelegate`, or `MintCloseAuthority` to preserve mathematical solvency invariants.
- **Alignment:** Enforced in [`INV-POOL-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-pool-001-prize-pool-creation-create_pool).

### 8. Permissionless Winner Selection Crank

- **Clean-Room Assumption:** `reveal_and_pick_winners` restricted to `jobs_account`.
- **On-Chain Reality:** [`reveal_and_pick_winners.rs#L33-L35`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reveal_and_pick_winners.rs#L33-L35) is permissionless to prevent crank bot censorship.
- **Alignment:** Documented in [`INV-DRAW-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-draw-001-vrf-winner-selection-via-binary-search-reveal_and_pick_winners).

### 9. Tail Memory Sanitation in Swap-and-Pop

- **Clean-Room Assumption:** Swap-and-Pop only documented entry relocation and counter decrement.
- **On-Chain Reality:** [`registry.rs#L461`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/registry.rs#L461) in `TicketRegistryMut::debit_tickets` (called by [`sell_bonds.rs#L224`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/user/sell_bonds.rs#L224)) explicitly overwrites the vacated tail entry at index $N-1$ with [`UserEntry::default()`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/registry.rs#L99) (64 zero bytes).
- **Alignment:** Documented in [`INV-SELL-002`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-sell-002-full-pool-exit--swap-and-pop-index-relocation-sell_bonds) to guarantee dirty memory isolation.

### 10. Exited User Reinvestment Graceful Fallback

- **Clean-Room Assumption:** Reinvestment assumed winners always have or allocate active slots.
- **On-Chain Reality:** In [`reinvest_winnings.rs#L164-L175`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs#L164-L175), if an exited user wins a prize while the registry is at 100% capacity (`user_count >= capacity`), `bonds_to_buy` is clamped to 0, routing 100% of the prize to `unclaimed_non_reinvested_winnings` (dust) so the crank transaction does not revert with `RegistryFull`.
- **Alignment:** Recorded in [`INV-REINV-001`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs#L164-L175).

### 11. Closed Pool Payout Handling

- **Clean-Room Assumption:** Closed pools did not specify prize payout behavior.
- **On-Chain Reality:** When `pool.status == PoolStatus::Closed`, [`reinvest_winnings`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs#L153-L156) disables bond purchasing (`bonds_to_buy = 0`) to prevent minting new bonds in sunset pools, converting 100% of winnings into withdrawable dust.
- **Alignment:** Recorded in [`INV-REINV-001`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs#L153-L156).

### 12. Huma Share-Price Conversion Rounding

- **Clean-Room Assumption:** Linear conversion without specifying ceiling/floor rounding direction.
- **On-Chain Reality:** [`huma::usdc_to_pst_shares`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/huma.rs#L201-L228) uses **strict ceiling division**, while [`huma::pst_shares_to_usdc`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/huma.rs#L242-L258) uses **strict floor division**.
- **Alignment:** Verified across all CPI deposit and redemption flows to protect protocol vault solvency.

### 13. Universal Schema Versioning & Upgrade Guards

- **Clean-Room Assumption:** State structs without version tracking.
- **On-Chain Reality:** All state accounts implement `check_version()` and `ensure_current_version()` with `CURRENT_VERSION = 1` and 64-to-128 bytes reserved buffers.
- **Alignment:** Documented in [`INV-UPGR-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-upgr-001-account-schema-versioning--upgrade-safety-guard).

### 14. Winner Identification Immunity (Pubkey vs. Registry Index)

- **Clean-Room Assumption:** Assumed winner entries reference registry indices (`user_index: u32`).
- **On-Chain Reality:** [`Winner`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/state/draw.rs#L237-L266) stores `winner: Pubkey` directly. In [`reinvest_winnings.rs#L140`](file:///home/sebastian/vsc-workspace/premium-bonds/anchor/programs/anchor/src/instructions/yield_draw/reinvest_winnings.rs#L140), `payout_view.validate_winner(winner_index, user_winnings.user)` asserts `ctx.accounts.winner.key() == winner.winner`. This guarantees that user registry swap-and-pop relocations occurring between draw reveal and winner reinvestment cannot displace winning identities or misdirect funds.
- **Alignment:** Formalized in `DEC-14` and verified in [`INV-DRAW-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-draw-001-vrf-winner-selection-via-binary-search-reveal_and_pick_winners) and [`INV-REINV-001`](file:///home/sebastian/vsc-workspace/premium-bonds/docs/specs/invariants-yieldbonds.md#inv-reinv-001-multi-cycle-dust-aggregated-reinvestment-reinvest_winnings).

---

## 4. Downstream LiteSVM Test Suite Status & Recommendations

### Execution Verification Status
All 36 LiteSVM in-process integration and unit test suites in `anchor/tests/` compile and pass cleanly with zero failures (`NO_DNA=1 cargo test` exit code 0).

### Continuous CI/CD Recommendations
Based on the verified invariants, the following high-priority invariant test vectors are maintained for continuous CI/CD verification:

1. **Dual Circuit Breaker Invariant Tests:**
   - Inject simulated Huma asset drawdown to verify `harvest_yield_and_commit` trips `EmergencyInsolvencyDetected` and marks `HaltedInsolvent` when deficit $> 1,000$ base units.
   - Inject anomalous high yield to verify `YieldVelocityBreached` and `HaltedYieldSpike` transitions.
2. **Two-Step Admin Transfer FSM:**
   - Verify that nominated pending admin cannot perform admin actions prior to `accept_admin`.
   - Verify that nomination cancellation immediately clears `pending_admin` and rejects subsequent `accept_admin` calls.
3. **Dynamic Payout Allocation & Rent Reclaim Lifecycle:**
   - Verify dynamic allocation across 1 to 180 winners, assert dynamic rent exemption, and test complete rent reclamation via `crank_close_payout_registry` for both completed and voided draws.
4. **Swap-and-Pop Concurrency & Memory Hygiene:**
   - Execute interleaved multi-user full bond sales with $k < N-1$ index swaps and assert that vacated tail slots at $N-1$ are strictly zeroed and `UserWinnings.registry_entry_index` is updated atomically.
5. **Exited User 100% Capacity Win:**
   - Fill `TicketRegistry` to 100% capacity, exit a user from an earlier cycle who wins in the current cycle, execute `reinvest_winnings`, and assert that the crank succeeds with `bonds_bought = 0` and 100% routed to dust.
6. **Metamorphic Relation Assertions (`MTR-001` through `MTR-010`):**
   - Assert batch equivalence, deposit linearity, multi-user commutativity, and rent recovery conservation.
