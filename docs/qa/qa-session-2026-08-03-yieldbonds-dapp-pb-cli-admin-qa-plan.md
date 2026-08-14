# QA Session Plan: YieldBonds dApp & pb-cli Admin Suite

## 📋 Session Metadata

- **Date:** 2026-08-03
- **Session Lead:** Senior Staff QA & Solana Developer Agent
- **Target Environment:** Localnet (`http://127.0.0.1:8899`) / Devnet
- **Scope & Objective:** Comprehensive functional, visual, accessibility (a11y), and admin command testing of the YieldBonds dApp frontend (Next.js 16 / React 19) and the command-line interface (`scripts/pb-cli.ts`).
- **Test Credentials / Keypairs:**
  - **Admin / Payer Keypair:** `scripts/admin-key.json` (Authority for global config, pool creation, fee withdrawal, emergency force-unlock)
  - **Crank Bot Keypair:** Configured in `GlobalConfig.jobs`
  - **Test User Wallet 1:** `0x1111...` (Standard depositor, ticket holder, prize winner)
  - **Test User Wallet 2:** `0x2222...` (Secondary depositor for multi-user ticket registry indexing)

---

## 🏗️ Architecture & Scope Overview

```
                           ┌─────────────────────────────────────────┐
                           │            YieldBonds System            │
                           └────────────────────┬────────────────────┘
                                                │
                     ┌──────────────────────────┴──────────────────────────┐
                     ▼                                                     ▼
    ┌─────────────────────────────────┐                   ┌─────────────────────────────────┐
    │     Web dApp (Next.js 16)       │                   │    Admin CLI (scripts/pb-cli)    │
    ├─────────────────────────────────┤                   ├─────────────────────────────────┤
    │ - Wallet Connection & Navbar    │                   │ - Admin Config & Pool Setup     │
    │ - Bond Minting & Ticket Display │                   │ - Protocol Fee & Emergency Ops  │
    │ - Yield Claiming & Reinvesting  │                   │ - Draw Crank Pipeline           │
    │ - Redemption & Activity History │                   │ - On-Chain State Inspection     │
    └─────────────────────────────────┘                   └─────────────────────────────────┘
```

---

## 🎯 Test Charters & Scenarios

### Charter #1: Web App Wallet Connection & Account Context

- **Objective / Focus:** Validate wallet onboarding, connection state synchronization, error alerts, theme toggling, and internationalization (i18n).
- **Target Components:** [`ConnectWalletButton.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/ConnectWalletButton.tsx), [`Navbar.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/Navbar.tsx), [`LanguageSwitcher.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/LanguageSwitcher.tsx), [`SolanaErrorAlert.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/SolanaErrorAlert.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Wallet Connection Standard:** Connect via Wallet-Standard compliant wallets (Phantom, Solflare, Backpack). Verify public key truncated display (`"7xKQ...3b9A"`).
  - [ ] **Disconnection Mid-Flow:** Connect wallet, open `DepositModal`, disconnect wallet via browser extension. Verify modal closes or transitions safely without crashing.
  - [ ] **Network Switch Interruption:** Switch RPC network (e.g. Localnet -> Devnet) while connected; verify state resets cleanly and displays network switch alert.
  - [ ] **Language & i18n:** Switch between English (`en`) and Spanish (`es`). Verify all text string translations dynamically update without unmounted DOM layout shifts.
  - [ ] **Number Formatting Audit:** Verify all numbers strictly follow `"en-US"` format (period `.` as decimal separator, comma `,` as thousands separator, e.g., `$1,234.50`).

### Charter #2: Web App Deposit & Ticket Issuance

- **Objective / Focus:** Validate bond purchasing, principal token deposits, zero-copy ticket registry indexing, and ticket calculation logic.
- **Target Components:** [`PoolCard.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/PoolCard.tsx), [`DepositModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/DepositModal.tsx), [`LiveYieldTicker.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/LiveYieldTicker.tsx), [`StatsSection.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/StatsSection.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Happy Path Deposit:** Deposit 100 USDC into Pool 1. Confirm ticket issuance calculation (`100 USDC = 100 Tickets`), check transaction signature toast, and verify ticket total updates on `PoolCard`.
  - [ ] **Boundary & Invalid Inputs:**
    - Input `0`, negative numbers (`-50`), or non-numeric strings (`"abc"`, `e+10`). Ensure deposit button remains disabled with validation helper text.
    - Input fractional amount smaller than bond price (e.g., `0.5 USDC` when bond price is `1.0 USDC`). Verify minimum bond threshold warning.
    - Input amount exceeding user's token balance. Verify "Insufficient Balance" warning.
  - [ ] **Transaction User Rejection:** Trigger deposit transaction and reject/cancel in wallet popup (Error code `4001`). Verify `SolanaErrorAlert` displays clean error feedback without hanging loading state.

### Charter #3: Web App Draw Timeline, Yield Claiming & Redemption

- **Objective / Focus:** Validate cycle drawdown notifications, yield accumulation, winning claim/reinvestment, and principal redemption cool-down periods.
- **Target Components:** [`WithdrawModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/WithdrawModal.tsx), [`UnclaimedBanner.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/UnclaimedBanner.tsx), [`PrizeDetailsModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PrizeDetailsModal.tsx), [`PrizeHistoryLedger.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PrizeHistoryLedger.tsx), [`PendingRedemptionsList.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PendingRedemptionsList.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Unclaimed Prize Banner:** Trigger draw cycle completion on-chain; verify `UnclaimedBanner` appears immediately with exact winning amount.
  - [ ] **Claim Winnings vs Reinvest:**
    - Option A: Claim winnings directly to wallet. Verify user token balance increases by exact prize payout.
    - Option B: Reinvest winnings. Verify winnings are auto-converted to new tickets and added to ticket count.
  - [ ] **Principal Redemption Request:** Request principal withdrawal of 50 bonds. Verify `PendingRedemptionsList` records pending request with correct cool-down countdown timer.
  - [ ] **Frozen Pool Redemption Lock:** Attempt principal redemption request while pool is frozen for draw (`isFrozenForDraw = true`). Verify modal disables request with message: "Pool frozen during active draw".
  - [ ] **Claim Settled Redemption:** Complete cool-down period and claim pending redemption. Verify principal tokens return to user wallet and pending redemption state clears.

### Charter #4: pb-cli Global & Pool Setup Admin Commands

- **Objective / Focus:** Verify administrative setup, pool creation, tier configuration, and registry capacity resizing via `pb-cli.ts`.
- **Target Commands:** `init-global`, `update-global-config`, `create-pool`, `initialize-huma-lender`, `resize-registry`, `set-prize-tiers`, `update-pool-config`.
- **Test Scenarios & Guardrails:**
  - [ ] **Pre-Flight Bootstrap:** Run `npm run localnet start -- --bootstrap-only --db test-cli-admin` (or `npm run localnet bootstrap`). Verify programs, mock mints, and `.env.local` are ready while `GlobalConfig` remains uninitialized.
  - [ ] **Initialization (`init-global`):** Run `npm run pb-cli init-global -- --jobs <pubkey>`. Verify `GlobalConfig` PDA is initialized with authority and jobs address.
  - [ ] **Config Update Guard (`update-global-config`):** Run `update-global-config --new-admin <pubkey>` without `--confirm`. Verify execution fails with explicit error requiring `--confirm`.
  - [ ] **Pool Creation (`create-pool`):** Create Pool 1 with `--bond-price 1000000 --fee-bps 100`. Verify `PrizePool` PDA, vault PDAs, and zero-copy `TicketRegistry` PDA are initialized.
  - [ ] **Lender Setup (`initialize-huma-lender`):** Execute Huma lender init. Verify PST token vault PDA is initialized and bound to the pool.
  - [ ] **Registry Resizing (`resize-registry`):** Call `resize-registry --pool 1`. Verify zero-copy account account size expands to support additional user ticket slots without data corruption.
  - [ ] **Prize Tiers Config (`set-prize-tiers`):** Test both string notation (`"1:5000,5:1000"`) and JSON format (`'[{"tier":1,"shares":5000}]'`). Verify invalid tier percentages (totaling > 10000 bps) are rejected.
  - [ ] **Pool Update (`update-pool-config`):** Update `--fee-bps 200` on Pool 1. Query pool state to verify fee rate changed from 100 to 200 bps.

### Charter #5: pb-cli Protocol Maintenance & Emergency Admin Commands

- **Objective / Focus:** Validate high-security protocol maintenance, fee extraction, emergency draw unlocking, and VRF randomness account rebinding.
- **Target Commands:** `withdraw-fees`, `force-unlock-draw`, `rebind-randomness`.
- **Test Scenarios & Security Rules:**
  - [ ] **Fee Withdrawal Safeguard (`withdraw-fees`):** Run `withdraw-fees --amount 500` without `--confirm`. Verify command aborts.
  - [ ] **Execute Fee Withdrawal:** Accrue fees, then run `withdraw-fees --amount all --confirm --pool 1`. Verify accrued fees transfer from pool vault to designated `feeWallet` account.
  - [ ] **Emergency Force Unlock (`force-unlock-draw`):** Manually freeze a draw cycle, then issue `force-unlock-draw --pool 1 --confirm`. Verify `isFrozenForDraw` resets to `false` and pool resumes normal deposit/withdraw operations.
  - [ ] **VRF Randomness Rebinding (`rebind-randomness`):** Simulate an expired Switchboard VRF account, run `rebind-randomness --pool 1 --new-randomness <pubkey>`. Verify `DrawCycle` randomness account pointer updates seamlessly.

### Charter #6: pb-cli Crank & Draw Pipeline Commands

- **Objective / Focus:** Test execution of the automated draw cycle pipeline via command line.
- **Target Commands:** `harvest`, `prepare-draw`, `reveal`, `reinvest`.
- **Test Scenarios & Workflow:**
  - [ ] **Harvest Yield (`harvest`):** Trigger `harvest --pool 1`. Verify yield is harvested from Huma, committed to `DrawCycle`, and `PrizePool.isFrozenForDraw` is set to `true`.
  - [ ] **Batched Draw Preparation (`prepare-draw`):** Execute `prepare-draw --pool 1 --batch-size 500`. Verify pending tickets transition into active tickets and prefix sums are computed across registry entries.
  - [ ] **Random Seed Reveal & Winner Selection (`reveal`):** Execute `reveal --pool 1`. Verify seed is revealed, winning tickets are selected via binary search on prefix sums, and `PayoutRegistry` PDA is populated.
  - [ ] **Winnings Reinvestment (`reinvest`):** Run `reinvest --pool 1 --max-bonds 1000`. Verify winnings are reinvested into tickets for unprocessed draw winners.

### Charter #7: pb-cli On-Chain State Inspection & Queries

- **Objective / Focus:** Verify read-only query commands produce accurate, formatted JSON and human-readable terminal output.
- **Target Commands:** `query-config`, `query-pool`, `query-draw`, `query-payout`, `query-winnings`, `query-redemption`, `query-registry`.
- **Test Scenarios & Formatting:**
  - [ ] **Global & Pool State (`query-config`, `query-pool`):** Query pool 1 details. Verify output lists pool status, deposit totals, fee wallet, and vault balances formatted with `"en-US"` number rules.
  - [ ] **Draw & Payout State (`query-draw`, `query-payout`):** Query draw cycle 1. Verify prize pot size, randomness pubkey, harvest slot, and winner payout list match on-chain data.
  - [ ] **User State Filtering (`query-winnings`, `query-redemption`, `query-registry`):** Query with and without `--user <pubkey>`. Verify filtering correctly isolates specific user PDAs vs returning list summaries.

---

## 🧪 Admin & CLI Test Command Execution Matrix

| Test ID    | Command                  | Required Flags                 | Optional / Test Arguments                     | Expected Result / Output                                                        |
| :--------- | :----------------------- | :----------------------------- | :-------------------------------------------- | :------------------------------------------------------------------------------ |
| **CLI-01** | `init-global`            | `--jobs <pubkey>`              | `--keypair scripts/admin-key.json`            | `GlobalConfig` initialized on-chain.                                            |
| **CLI-02** | `update-global-config`   | `--jobs <pubkey>`              | `--new-admin <pubkey> --confirm`              | Admin or jobs pubkey updated. Fails if `--confirm` omitted when changing admin. |
| **CLI-03** | `create-pool`            | None (uses defaults)           | `--pool 1 --bond-price 1000000 --fee-bps 100` | `PrizePool` & `TicketRegistry` created.                                         |
| **CLI-04** | `initialize-huma-lender` | None                           | `--pool 1`                                    | Huma lender state & PST vault initialized.                                      |
| **CLI-05** | `resize-registry`        | None                           | `--pool 1`                                    | Ticket registry account reallocated.                                            |
| **CLI-06** | `set-prize-tiers`        | `--tiers <str>`                | `--tiers "1:5000,5:1000" --pool 1`            | Prize tiers configured on pool state.                                           |
| **CLI-07** | `update-pool-config`     | At least 1 config option       | `--fee-bps 200 --pool 1`                      | Fee bps updated from 100 to 200.                                                |
| **CLI-08** | `withdraw-fees`          | `--amount <num>` & `--confirm` | `--amount all --confirm --pool 1`             | Protocol fees transferred to fee wallet. Fails without `--confirm`.             |
| **CLI-09** | `force-unlock-draw`      | `--confirm`                    | `--pool 1 --confirm`                          | Frozen draw state cleared; `isFrozenForDraw` set to `false`.                    |
| **CLI-10** | `rebind-randomness`      | `--new-randomness <pubkey>`    | `--pool 1 --new-randomness <PUBKEY>`          | Draw cycle randomness account rebound.                                          |
| **CLI-11** | `harvest`                | None                           | `--pool 1`                                    | Yield committed, pool frozen for draw.                                          |
| **CLI-12** | `prepare-draw`           | None                           | `--pool 1 --batch-size 500`                   | Batched ticket registry calculation finished.                                   |
| **CLI-13** | `reveal`                 | None                           | `--pool 1`                                    | Winners selected and recorded in `PayoutRegistry`.                              |
| **CLI-14** | `reinvest`               | None                           | `--pool 1 --winner 0`                         | Winner payouts converted back into tickets.                                     |
| **CLI-15** | `query-config`           | None                           | None                                          | Prints `GlobalConfig` state.                                                    |
| **CLI-16** | `query-pool`             | None                           | `--pool 1`                                    | Prints `PrizePool` state & vault balances.                                      |
| **CLI-17** | `query-draw`             | None                           | `--pool 1 --cycle 0`                          | Prints target `DrawCycle` state.                                                |
| **CLI-18** | `query-payout`           | None                           | `--pool 1 --cycle 0`                          | Prints winner payout distribution.                                              |
| **CLI-19** | `query-winnings`         | None                           | `--user <pubkey>`                             | Prints user winnings PDA.                                                       |
| **CLI-20** | `query-redemption`       | None                           | `--id 1 --user <pubkey>`                      | Prints pending redemption record.                                               |
| **CLI-21** | `query-registry`         | None                           | `--user <pubkey>`                             | Prints user ticket registry entries.                                            |

---

## 🐛 Logged Bugs & Issues

| ID     | Title / Summary                                            | Charter / Tool             | Severity | Environment | Steps to Reproduce                 | Expected vs. Actual                                  | Evidence / Notes | Status |
| :----- | :--------------------------------------------------------- | :------------------------- | :------- | :---------- | :--------------------------------- | :--------------------------------------------------- | :--------------- | :----- |
| Bug-01 | [Sample] Missing validation for negative bond price in CLI | Charter #4 (`create-pool`) | Major    | Localnet    | Run `create-pool --bond-price -50` | Exp: Error prompt<br>Act: CLI accepts negative value | Issue #000       | Draft  |

> **Severity Scale:**
>
> - **Critical:** Blocks core flows, crashes application, security vulnerability, funds at risk.
> - **Major:** Broken feature or admin command with no reasonable workaround.
> - **Minor:** UI layout issues, visual alignment, terminal formatting flaws, cosmetic bugs.

---

## 🔍 Sign-off & Verification Checklist

- [ ] **Web Functional Verification:** Deposit, ticket issuance, yield claiming, and redemption flows operate clean.
- [ ] **Web Visual & Responsive:** Checked mobile (375px), tablet (768px), and desktop (1440px) breakpoints without text overflow or layout shift.
- [ ] **Web Accessibility (a11y):** Keyboard navigation (`Tab`/`Shift+Tab`), visible focus states, no tab traps, text scaling to 200%.
- [ ] **Web Console Health:** No unhandled runtime errors, uncaught exceptions, or missing React `key` warnings in DevTools console.
- [ ] **CLI Admin Command Safety:** Verified that high-risk actions (`update-global-config` admin change, `withdraw-fees`, `force-unlock-draw`) strictly require explicit `--confirm` flags.
- [ ] **CLI Query Accuracy:** All `query-*` commands deserialize accounts and format numbers cleanly using `"en-US"` formatting.
- [ ] **Sign-off Status:** [ ] Approved | [ ] Blocked

---

## 📝 Follow-up Notes & Maintenance

- Ensure LiteSVM integration tests (`cargo test` inside `/anchor`) pass prior to running live localnet QA sweeps.
- When executing CLI commands, ensure local validator is active or specified `--rpc` target is reachable.
