# QA Session: Premium Bonds Web App and pb-cli Operations Sweep (2026-09-17)

## 📋 Session Metadata

- **Date:** 2026-09-17
- **Session Lead:** Senior Staff QA & Solana Developer Agent
- **Target Environment:** Localnet (`http://127.0.0.1:8899`) / Devnet Staging
- **Scope & Objective:** Exhaustive functional, edge case, responsive visual, WCAG 2.1 AA accessibility, and multisig governance sweep across the Premium Bonds protocol web application (Next.js 16 App Router, React 19, Tailwind CSS v4, `@solana/client`, `@solana/react-hooks`, Pusher realtime sync) and the operations CLI ([`scripts/pb-cli.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/pb-cli.ts)).
- **Test Credentials & Keypairs:**
  - **Protocol Admin / Deployer Keypair:** `scripts/admin-key.json` (Deployer, GlobalConfig admin, fee withdrawal authority, pool close/unpause authority, Squads member)
  - **Nominated Admin Candidate:** Generated temporary keypair `candidate-admin.json` (Used for two-step admin transfer validation)
  - **Emergency Guardian Keypair:** Configured in `GlobalConfig.guardian` (Fast-response panic button for `pause-pool`)
  - **Crank Bot Keypair:** Configured in `GlobalConfig.jobsAccount` (Automated yield harvesting, batched draw preparation, seed reveal, winner reinvestment)
  - **Squads V4 Multisig Members:**
    - Member 1 (Admin signer): Weight 1
    - Member 2 (Co-signer): Weight 1
    - Member 3 (Auditor): Weight 1
    - Multisig Threshold: 2 of 3 quorum
  - **Test User Wallet A (Primary):** Standard depositor, multi-ticket holder, draw winner beneficiary
  - **Test User Wallet B (Secondary):** Secondary depositor for zero-copy ticket registry lazy-merging and multi-user prefix sum validation
  - **Test User Wallet C (Adversarial / Empty):** Unfunded account for boundary values, insufficient balance, zero-ticket edge cases, and simulation error decoding

---

## 🏗️ Protocol & Architecture Scope Overview

```
                                ┌──────────────────────────────────────────────┐
                                │           Premium Bonds Protocol             │
                                └──────────────────────┬───────────────────────┘
                                                       │
                        ┌──────────────────────────────┴──────────────────────────────┐
                        ▼                                                             ▼
     ┌─────────────────────────────────────────┐                   ┌─────────────────────────────────────────┐
     │    Web dApp (Next.js 16 / React 19)     │                   │   Operations CLI (scripts/pb-cli.ts)    │
     ├─────────────────────────────────────────┤                   ├─────────────────────────────────────────┤
     │ 1. Wallet Standard & Connection Context │                   │ 1. Global Setup & Two-Step Admin Nom.   │
     │ 2. Yield Pools, Deposits & Ticket Mint  │                   │ 2. Pool Provisioning & Huma Lending     │
     │ 3. Live APY, Harvest Timers & Yield     │                   │ 3. Prize Tier & Fee Rate Configuration  │
     │ 4. Draw History & VRF Cycle Inspector   │                   │ 4. Emergency Controls (Pause/Void/Close)│
     │ 5. Winnings Claim & Auto-Reinvestment   │                   │ 5. Crank Pipeline (Harvest/Prep/Reveal) │
     │ 6. 2-Step Huma Principal Redemptions    │                   │ 6. Protocol Fee Extraction & Guards     │
     │ 7. Provable Fairness & Proof Explorer   │                   │ 7. Squads V4 Multisig CLI Middleware    │
     │ 8. Realtime Pusher Webhooks Sync        │                   │ 8. Squads Proposal Management Commands  │
     │ 9. In-App Docs Hub & Hex Error Decoder  │                   │ 9. On-Chain Account State Query Suite   │
     └─────────────────────────────────────────┘                   └─────────────────────────────────────────┘
```

---

## 🎯 Detailed Test Charters

### Charter #1: Web Wallet Onboarding, Multi-Tab Sync & Realtime Infrastructure

- **Objective / Focus:** Validate wallet connection lifecycle, multi-wallet provider detection, session synchronization across browser tabs, Pusher realtime event broadcasting, theme/localization switching, and global navigation responsiveness.
- **Target Components:** [`ConnectWalletButton.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/ConnectWalletButton.tsx), [`Navbar.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/Navbar.tsx), [`LanguageSwitcher.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/LanguageSwitcher.tsx), [`GlobalRealtimePushSync.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/realtime/GlobalRealtimePushSync.tsx), [`SolanaErrorAlert.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/SolanaErrorAlert.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Standard Wallet Onboarding:** Connect via Wallet-Standard compliant wallets (Phantom, Solflare, Backpack). Confirm address is cleanly truncated (e.g., `7xKQ...3b9A`) with a copy-to-clipboard button and explorer link.
  - [ ] **Disconnection Mid-Flow:** Open [`DepositModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/DepositModal.tsx) or [`WithdrawModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/WithdrawModal.tsx), then disconnect the wallet via the browser extension. Verify the modal automatically dismisses or safely enters an unauthenticated prompt state without unhandled JavaScript exceptions.
  - [ ] **Multi-Tab Session Sync:** Open the dApp in Tab A and Tab B. Connect in Tab A; verify Tab B synchronizes wallet state immediately via broadcast channel. Execute a deposit in Tab A; verify Tab B updates its balances and ticket count without requiring a manual page refresh.
  - [ ] **Pusher Realtime Event Ingestion:** With dApp open on Dashboard, trigger a draw completion or deposit via [`scripts/pb-cli.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/pb-cli.ts). Verify [`GlobalRealtimePushSync.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/realtime/GlobalRealtimePushSync.tsx) receives the webhook broadcast, invalidates React Query caches, and shows an in-app toast notification.
  - [ ] **Network Switching Interruption:** Switch RPC cluster (Localnet -> Devnet -> Mainnet-Beta). Verify the dApp detects the change, warns the user of mismatched contract addresses if necessary, and re-queries PDAs cleanly.
  - [ ] **Localization (i18n) & Formatting Integrity:** Switch locales (`en`, `es`, `zh`). Verify all UI strings update dynamically. **Strict Rule:** Verify that all decimal numbers and token balances strictly maintain `"en-US"` formatting (e.g. `$1,250.50`, period `.` for decimals, comma `,` for thousands) regardless of selected language.
  - [ ] **Responsive Viewports:** Inspect navbar and sidebar across 375px (mobile), 768px (tablet), 1024px (laptop), and 1440px (desktop). Ensure mobile drawer navigation opens/closes smoothly with no horizontal scrolling or clipped buttons.
- **Status:** `[ ] Unstarted`

---

### Charter #2: Web Yield Pools, Deposits, Dust Calculation & Ticket Minting

- **Objective / Focus:** Validate principal token depositing, minimum bond size calculations, unbonded residual dust alerts, zero-copy ticket registry indexing, wallet signature flows, and simulation dry-runs.
- **Target Components:** [`PoolCard.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/PoolCard.tsx), [`DepositModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/DepositModal.tsx), [`TransactionFeeSummary.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/TransactionFeeSummary.tsx), [`TransactionProgressModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/TransactionProgressModal.tsx), [`BonusBondDustBadge.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/common/BonusBondDustBadge.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Happy Path Deposit:** Deposit 500 USDC into Pool 1 (Bond price = 1 USDC). Confirm ticket preview displays `500 Tickets`, transaction progress modal shows signing -> confirming -> finalized stages, and the `PoolCard` reflects updated active/pending tickets.
  - [ ] **Boundary & Invalid Inputs:**
    - Input `0`, negative numbers (`-100`), or non-numeric characters (`"abc"`, `1e5`, emoji). Ensure the deposit button remains disabled with actionable helper text.
    - Input fractional amount smaller than bond unit (e.g., `0.75 USDC` when bond price is `1.00 USDC`). Confirm warning displays "Amount below minimum bond unit".
    - Input amount with remainder dust (e.g., `10.50 USDC` when bond price is `1.00 USDC`). Verify [`BonusBondDustBadge.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/common/BonusBondDustBadge.tsx) alerts user to unbonded residual token amount (`0.50 USDC`).
    - Input amount exceeding wallet balance. Verify "Insufficient USDC Balance" error and disable submit button.
  - [ ] **Wallet User Rejection (Error 4001):** Initiate deposit transaction, then click "Reject" / "Cancel" in the wallet popup. Verify the modal catches the rejection, resets loading state, and renders a non-intrusive warning rather than an unhandled red error box.
  - [ ] **Pool Frozen for Draw:** Simulate a draw in progress (`isFrozenForDraw = true`). Attempt to open the deposit modal. Verify that deposits are disabled with banner: "Pool is currently frozen for draw calculation. Deposits will resume after winner selection."
  - [ ] **Registry Capacity Warning:** In a pool nearing zero-copy registry max capacity, verify that the deposit modal displays capacity warnings and initiates registry resize CPI if needed.
- **Status:** `[ ] Unstarted`

---

### Charter #3: Web Draw Lifecycle, Provable Fairness & Cycle Inspector

- **Objective / Focus:** Validate real-time yield accrual, harvest countdown timers, draw history pagination, Switchboard VRF randomness seed verification, provable fairness verification dialogs, and CSV/JSON export actions.
- **Target Components:** [`LiveYieldTicker.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/LiveYieldTicker.tsx), [`TierPrizeTicker.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/TierPrizeTicker.tsx), [`CountdownTimer.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/CountdownTimer.tsx), [`DrawHistoryList.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/DrawHistoryList.tsx), [`DrawCycleInspectorModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/DrawCycleInspectorModal.tsx), [`ProvableFairnessVerifier.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/ProvableFairnessVerifier.tsx), [`PrizeVerificationProofs.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/PrizeVerificationProofs.tsx), [`DrawTelemetryGrid.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/DrawTelemetryGrid.tsx), [`VrfSeedBadge.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/common/VrfSeedBadge.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Harvest Countdown & APY Ticker:** Check that [`CountdownTimer.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/CountdownTimer.tsx) counts down accurately to `currentCycleEndAt`. Verify that when timer reaches `00:00:00`, the UI state transitions to "Eligible for Draw Harvest".
  - [ ] **Draw History Navigation & Pagination:** Navigate to `/dashboard/draws`. Test table sorting by cycle ID, date, and prize pot. Navigate through multi-page draw history using pagination controls and verify data does not jump or duplicate.
  - [ ] **Draw Cycle Inspector Deep-Dive:** Click on a past draw cycle to open [`DrawCycleInspectorModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/DrawCycleInspectorModal.tsx). Verify display of:
    - Draw Cycle ID, Status badge (`Committed`, `Prepared`, `Revealed`, `Voided`)
    - Total locked tickets and cumulative prize pot size
    - Hexadecimal VRF Randomness Seed with copy action and explorer link
    - List of winning ticket indexes and winning wallet addresses
    - Tier distribution breakdown and individual payout amounts
  - [ ] **Provable Fairness Verifier:** In the inspector modal, open [`ProvableFairnessVerifier.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/ProvableFairnessVerifier.tsx). Verify that the client re-runs the on-chain PRNG algorithm locally using the Switchboard seed, total tickets, and tier specifications, confirming that derived winning ticket numbers match on-chain records 100%.
  - [ ] **Prize Verification Proofs:** Review [`PrizeVerificationProofs.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/PrizeVerificationProofs.tsx) to verify cryptographic inclusion proofs and prefix sum binary search paths for each winning ticket.
  - [ ] **Export Actions:** Test "Export to CSV" and "Export to JSON". Verify downloaded files contain accurate cycle headers, ticket ranges, and winner records formatted with `"en-US"` numbers.
- **Status:** `[ ] Unstarted`

---

### Charter #4: Web Winnings Claims, Instant Auto-Reinvestment & Huma 2-Step Redemptions

- **Objective / Focus:** Validate unclaimed prize banners, winner payout claims, instant winning reinvestment into tickets, and Huma 2-step principal redemptions with cool-down timelocks.
- **Target Components:** [`UnclaimedBanner.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/UnclaimedBanner.tsx), [`WithdrawModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/WithdrawModal.tsx), [`PrizeDetailsModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PrizeDetailsModal.tsx), [`PendingRedemptionsList.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PendingRedemptionsList.tsx), [`PrizeHistoryLedger.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PrizeHistoryLedger.tsx), [`ClaimAllModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/ClaimAllModal.tsx), [`ReinvestAllModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/ReinvestAllModal.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Unclaimed Prize Banner Notification:** As a winner, log into the dApp. Verify [`UnclaimedBanner.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/UnclaimedBanner.tsx) renders prominently with exact winning amount, congratulatory badge, and direct "Claim" / "Reinvest" buttons.
  - [ ] **Claim Winnings Flow:** Click "Claim Winnings". Verify transaction submits `claim_winnings` instruction. After confirmation, verify wallet token balance increases by payout amount and unclaimed winnings balance resets to `$0.00`.
  - [ ] **Reinvest Winnings Flow:** Click "Reinvest Winnings". Verify winnings are converted directly into active/pending bond tickets without requiring token withdrawal and re-deposit.
  - [ ] **Initiate Principal Redemption (Step 1):** Open [`WithdrawModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/WithdrawModal.tsx), select "Redeem Principal Bonds", enter amount (e.g. 50 Bonds). Confirm modal details the 2-step Huma PST redemption process and estimated settlement cool-down time. Submit transaction.
  - [ ] **Pending Redemptions Ledger:** Navigate to portfolio. Verify [`PendingRedemptionsList.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PendingRedemptionsList.tsx) lists the new redemption with `Pending` status, redemption ID, locked PST shares, and real-time unlock countdown timer.
  - [ ] **Complete Principal Redemption (Step 2):** After cool-down timelock expires, verify status badge flips to `Ready to Claim`. Click "Claim Redeemed Tokens". Verify tokens transfer to wallet and redemption record updates to `Claimed`.
- **Status:** `[ ] Unstarted`

---

### Charter #5: Web Documentation Hub & Interactive On-Chain Error Decoder

- **Objective / Focus:** Validate in-app documentation navigation, live search filtering, responsive article viewer, and the interactive on-chain error decoder tool.
- **Target Components:** [`DocArticleViewer.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/docs/DocArticleViewer.tsx), [`DocsSearch.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/docs/DocsSearch.tsx), [`DocsSidebar.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/docs/DocsSidebar.tsx), [`ErrorDecoderTool.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/docs/ErrorDecoderTool.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Docs Navigation & Slug Routing:** Navigate to `/docs` and child slugs (e.g. `/docs/protocol-overview`, `/docs/draw-mechanics`, `/docs/huma-integration`, `/docs/error-codes`). Verify breadcrumbs, sidebar active indicators, and markdown rendering are flawless.
  - [ ] **Live Documentation Search:** Type search queries (e.g. "Yield", "Switchboard", "Redemption", "6001") into [`DocsSearch.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/docs/DocsSearch.tsx). Verify instant result filtering with highlighted text matching and keyboard navigation (`Up`/`Down`/`Enter`).
  - [ ] **Interactive Error Decoder Tool:** Test [`ErrorDecoderTool.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/docs/ErrorDecoderTool.tsx) with various inputs:
    - Custom Anchor hex error: `0x1770` -> Decodes to `6000: InvalidBondPrice`
    - Custom Anchor hex error: `0x177a` -> Decodes to `6010: PoolFrozenForDraw`
    - Custom Anchor hex error: `0x1782` -> Decodes to `6018: YieldBelowMinimumThreshold`
    - Custom Anchor hex error: `0x1787` -> Decodes to `6023: AdminNominationPending`
    - Decimal error code: `6015` -> Decodes to `InvalidPrizeTierSum`
    - Simulation log paste: Paste raw transaction error log containing `Program log: AnchorError thrown in src/instructions/harvest_yield.rs:42. Error Code: 0x1782`. Verify tool extracts error code, identifies `YieldBelowMinimumThreshold`, and displays plain-English resolution advice.
    - Invalid or unknown hex: Input `0x9999` -> Verify graceful "Unknown Error Code" fallback with generic troubleshooting steps.
- **Status:** `[ ] Unstarted`

---

### Charter #6: Web Portfolio Activity Feed, Timelocks & Crank Execution

- **Objective / Focus:** Validate the portfolio view, historical activity feeds, crank action triggers for permissionless keeper tasks, and ledger modal dialogues.
- **Target Components:** [`PortfolioHeroRow.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PortfolioHeroRow.tsx), [`ActivityFeed.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/ActivityFeed.tsx), [`PrizeHistoryLedger.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/PrizeHistoryLedger.tsx), [`CrankActionButton.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/CrankActionButton.tsx), [`CompleteActivityModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/CompleteActivityModal.tsx), [`CompleteLedgerModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/CompleteLedgerModal.tsx).
- **Test Scenarios & Edge Cases:**
  - [ ] **Portfolio Metrics Aggregation:** Verify that `PortfolioHeroRow` displays correct cumulative deposited principal, active tickets, pending tickets, all-time prizes won, and pending redemption claims.
  - [ ] **Activity Feed Pagination & Filters:** Filter activity feed by event type (`Deposit`, `Redeem`, `Claim`, `Reinvest`). Confirm timestamps, tx hashes with explorer links, and token amounts are displayed correctly.
  - [ ] **Permissionless Crank Action Trigger:** When a draw is eligible for harvest or winner processing, verify [`CrankActionButton.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/CrankActionButton.tsx) becomes active. Click button to trigger client-side crank execution. Verify wallet prompts for transaction signature, submits CPI, and refreshes UI upon finality.
  - [ ] **Complete History Modal Views:** Click "View Full History" to open [`CompleteActivityModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/CompleteActivityModal.tsx) and [`CompleteLedgerModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/portfolio/CompleteLedgerModal.tsx). Verify modal traps focus, supports keyboard navigation, and provides CSV export capabilities.
- **Status:** `[ ] Unstarted`

---

### Charter #7: CLI Admin Governance & Two-Step Authority Transfer

- **Objective / Focus:** Validate administrative global configuration setup, parameter updates, and the two-step governance admin transfer pattern (`nominate-admin` -> `accept-admin` or `cancel-admin-nomination`) via [`scripts/pb-cli.ts`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/pb-cli.ts).
- **Target Commands:** `init-global`, `update-global-config`, `nominate-admin`, `cancel-admin-nomination`, `accept-admin`.
- **Test Scenarios & Security Guardrails:**
  - [ ] **Global Config Init (`init-global`):** Run `npm run pb-cli init-global -- --guardian <GUARDIAN_PUBKEY> --jobs <JOBS_PUBKEY>`. Verify `GlobalConfig` PDA is initialized with the deployer as admin and specified guardian/jobs keys.
  - [ ] **Guardian and Jobs Config Update (`update-global-config`):** Run `update-global-config --guardian <NEW_GUARDIAN> --jobs <NEW_JOBS>`. Verify on-chain state updates accordingly.
  - [ ] **Admin Nomination Step 1 (`nominate-admin`):**
    - Run `nominate-admin` without `--new-admin`. Verify command fails with clear `CliArgumentError`.
    - Run `nominate-admin --new-admin <CANDIDATE_PUBKEY>`. Verify transaction succeeds.
    - Run `query-config` to verify `pendingAdmin` is set to `<CANDIDATE_PUBKEY>` while `admin` remains unchanged.
  - [ ] **Admin Nomination Cancellation (`cancel-admin-nomination`):**
    - Run `cancel-admin-nomination`. Verify `pendingAdmin` resets to zero address (`11111111111111111111111111111111`).
    - Attempt to call `accept-admin` after cancellation. Verify transaction rejects with `NoPendingAdminNomination`.
  - [ ] **Admin Nomination Finalization Step 2 (`accept-admin`):**
    - Re-nominate `<CANDIDATE_PUBKEY>`.
    - Attempt `accept-admin` using current admin keypair. Verify transaction fails with unauthorized signer error (`SignerIsNotNominatedAdmin`).
    - Execute `accept-admin --keypair candidate-admin.json`. Verify success!
    - Run `query-config` to confirm `admin` is now `<CANDIDATE_PUBKEY>` and `pendingAdmin` is cleared.
- **Status:** `[ ] Unstarted`

---

### Charter #8: CLI Pool Lifecycle, Provisioning & Emergency Guardrails

- **Objective / Focus:** Test administrative initialization, pool creation, tier configuration, registry resizing, and emergency safety mechanisms (`pause`, `unpause`, `void-draw`, `close-pool`, `force-unlock-draw`, `rebind-randomness`) with strict `--confirm` flag enforcement.
- **Target Commands:** `create-pool`, `initialize-huma-lender`, `resize-registry`, `set-prize-tiers`, `update-pool-config`, `withdraw-fees`, `pause-pool`, `unpause-pool`, `close-pool`, `void-draw`, `force-unlock-draw`, `rebind-randomness`.
- **Test Scenarios & Security Rules:**
  - [ ] **Pool Provisioning (`create-pool`):** Create Pool 1 with `--bond-price 1000000 --fee-bps 100 --stake-duration 24 --tiers "1:5000,2:1500,5:400"`. Verify `PrizePool` PDA, vault PDAs, and zero-copy `TicketRegistry` PDA are initialized.
  - [ ] **Huma Lender Setup (`initialize-huma-lender`):** Run `initialize-huma-lender --pool 1`. Verify Huma lender state PDA and `$PST` token vault are linked to the pool.
  - [ ] **Registry Capacity Resizing (`resize-registry`):** Run `resize-registry --pool 1`. Verify zero-copy account reallocates space for expanded user entries without wiping existing ticket records.
  - [ ] **Prize Tier Validation (`set-prize-tiers`):**
    - Valid config: `--tiers "1:5000,2:2500,5:500"` (sums to 10000 bps = 100%). Verify success.
    - Invalid config: `--tiers "1:6000,2:5000"` (sums to 11000 bps > 100%). Verify command rejects with `InvalidPrizeTierSum`.
  - [ ] **Pool Parameter Update (`update-pool-config`):** Update `--fee-bps 150 --min-yield-threshold 5000000 --max-yield-bps 500 --payout-timelock 600`. Verify on-chain pool state reflects all updated parameters.
  - [ ] **Fee Withdrawal Safeguard (`withdraw-fees`):** Run `withdraw-fees --amount all` without `--confirm`. Verify strict refusal. Re-run with `--confirm` and verify accrued protocol fees transfer to `feeWallet`.
  - [ ] **Emergency Pause (`pause-pool`):** Execute `pause-pool --pool 1` using Guardian keypair. Query pool state and verify `status = Paused`. Verify dApp deposit/withdraw actions are blocked.
  - [ ] **Emergency Unpause (`unpause-pool`):**
    - Run `unpause-pool --pool 1` without `--confirm` -> verify strict refusal.
    - Attempt `unpause-pool` using non-admin Guardian keypair -> verify unauthorized failure.
    - Execute with Admin keypair and `--confirm` -> verify pool status returns to `Active`.
  - [ ] **Emergency Void Draw (`void-draw`):** In a cycle where winner selection occurred but payouts have not settled, run `void-draw --pool 1 --cycle 0` without `--confirm` -> verify refusal. Run with `--confirm` -> verify draw cycle state flips to `Voided` and prize pot returns to pool funds.
  - [ ] **Force Unlock Draw (`force-unlock-draw`):** Freeze a pool for draw, then execute `force-unlock-draw --pool 1` without `--confirm` -> verify refusal. Re-run with `--confirm` -> verify `isFrozenForDraw` resets to `false`.
  - [ ] **Randomness Rebinding (`rebind-randomness`):** Run `rebind-randomness --pool 1 --new-randomness <NEW_SB_ACCOUNT>`. Verify `DrawCycle` randomness account pointer updates.
  - [ ] **Pool Decommissioning (`close-pool`):** Run `close-pool --pool 1` without `--confirm` -> verify refusal. Run with `--confirm` -> verify pool status permanently transitions to `Closed`.
- **Status:** `[ ] Unstarted`

---

### Charter #9: CLI Squads V4 Multisig Middleware & Proposal Governance

- **Objective / Focus:** Validate Squads V4 multisig integration across all admin operations using CLI execution modes (`--propose`, `--export-ix`, `--dry-run`, `--no-auto-approve`) and dedicated Squads subcommands.
- **Target Subcommands & Flags:** `squads-status`, `squads-proposals`, `squads-inspect-tx`, `squads-approve`, `squads-reject`, `squads-cancel`, `squads-close`, `squads-execute`, `--multisig`, `--vault-index`, `--propose`, `--export-ix`, `--dry-run`.
- **Test Scenarios & Multisig Lifecycles:**
  - [ ] **Multisig Status Inspection (`squads-status`):** Run `npm run pb-cli squads-status -- --multisig <MULTISIG_PDA>`. Verify display of multisig threshold, member count, timelock delay, transaction index sequence, and vault address.
  - [ ] **Dry-Run Simulation Mode (`--dry-run`):** Run an admin command with `--dry-run` (e.g. `npm run pb-cli update-pool-config -- --pool 1 --fee-bps 120 --dry-run`). Verify the transaction is simulated against the RPC node, logs are printed, and NO on-chain state changes or proposals are created.
  - [ ] **Instruction Export Mode (`--export-ix`):** Run `npm run pb-cli update-pool-config -- --pool 1 --fee-bps 120 --export-ix`. Verify that the CLI outputs instruction base64 wire bytes and a JSON payload formatted for direct copy-paste into the Squads web app.
  - [ ] **Atomic Proposal Creation (`--propose`):** Run `npm run pb-cli update-pool-config -- --pool 1 --fee-bps 120 --propose`. Verify that:
    - A new `VaultTransaction` PDA and `Proposal` PDA are initialized under the multisig.
    - If `--no-auto-approve` is omitted, the proposing member's vote is automatically cast.
    - Proposal status is set to `Active` (or `Draft`).
  - [ ] **Proposal History Listing (`squads-proposals`):** Run `npm run pb-cli squads-proposals -- --limit 5`. Verify the newly created proposal is displayed with index, author, status, and approval count.
  - [ ] **Proposal Inspection (`squads-inspect-tx`):** Run `npm run pb-cli squads-inspect-tx -- --index <PROPOSAL_INDEX>`. Verify inner instructions are decoded, showing target program ID ([`PROGRAM_ID`](file:///home/sebastian/vsc-workspace/premium-bonds/scripts/pb-cli.ts#L84)), accounts, and arguments.
  - [ ] **Quorum Voting (`squads-approve` / `squads-reject`):**
    - Execute `squads-approve --index <PROPOSAL_INDEX>` with Member 2 keypair. Verify approval count reaches threshold (2 of 3) and status transitions to `Approved`.
    - Test `squads-reject` with Member 3 keypair and verify rejection is recorded with optional `--memo`.
  - [ ] **Proposal Execution (`squads-execute`):** Run `npm run pb-cli squads-execute -- --index <PROPOSAL_INDEX>`. Verify that the multisig vault executes the CPI, on-chain pool config is updated, and proposal status transitions to `Executed`.
  - [ ] **Proposal Cancellation & Rent Reclamation (`squads-cancel` & `squads-close`):** Create a test proposal, run `squads-cancel --index <IDX>`, verify status becomes `Cancelled`. Run `squads-close --index <IDX>` and verify rent lamports are refunded to the rent collector.
- **Status:** `[ ] Unstarted`

---

### Charter #10: CLI Crank Pipeline & State Inspection Engine

- **Objective / Focus:** Validate complete execution of the yield harvesting and winner selection pipeline via automated CLI crank commands, and ensure all read-only inspection commands deserialize on-chain accounts accurately with `"en-US"` number formatting.
- **Target Commands:** `harvest`, `prepare-draw`, `reveal`, `reinvest`, `query-config`, `query-pool`, `query-draw`, `query-payout`, `query-winnings`, `query-redemption`, `query-registry`, `query-mock-huma-pool-state`.
- **Test Scenarios & Crank Workflow:**
  - [ ] **Yield Harvesting (`harvest`):** Run `npm run pb-cli harvest -- --pool 1`. Verify yield is harvested from Huma lending pool, protocol fee is deducted into fee accumulator, remaining yield is committed as `DrawCycle.prizePot`, and `PrizePool.isFrozenForDraw` is set to `true`.
  - [ ] **Batched Draw Preparation (`prepare-draw`):** Run `npm run pb-cli prepare-draw -- --pool 1 --batch-size 500`. Verify pending tickets from recent deposits are merged into active tickets, prefix sums are computed sequentially, and `drawPreparedUpTo` increments until all users are prepared.
  - [ ] **Random Seed Reveal & Winner Selection (`reveal`):** Run `npm run pb-cli reveal -- --pool 1`. Verify:
    - Switchboard randomness seed is unpacked from oracle account
    - Pseudo-random winning ticket numbers are derived per tier
    - Binary search on ticket registry prefix sums resolves winning user public keys
    - `PayoutRegistry` PDA is initialized with winner records
    - `PrizePool.isFrozenForDraw` resets to `false` and `currentDrawCycleId` increments
  - [ ] **Winner Payout Reinvestment (`reinvest`):** Run `npm run pb-cli reinvest -- --pool 1`. Verify winning payouts are automatically converted into new tickets for the subsequent draw cycle.
  - [ ] **Global & Pool State Inspection (`query-config`, `query-pool`):** Verify output cleanly displays admin, guardian, jobs keys, token mints, vault PDAs, total deposited principal, fee stats, and prize tiers.
  - [ ] **Draw & Payout State Inspection (`query-draw`, `query-payout`):** Query active and historical cycles. Verify locked ticket counts, randomness seed hex strings, harvest slot, and winner payout arrays.
  - [ ] **User State Filtering (`query-winnings`, `query-redemption`, `query-registry`):**
    - Run `query-winnings --pool 1` (lists all user winnings) vs `query-winnings --pool 1 --user <PUBKEY>` (detailed single user view).
    - Run `query-redemption --pool 1` (lists all pending redemptions) vs `query-redemption --pool 1 --id 1` (single redemption breakdown).
    - Run `query-registry --pool 1` (prints full user table with lazy-merge status) vs `query-registry --pool 1 --user <PUBKEY>` (specific ticket allocation).
  - [ ] **Mock Huma Pool State (`query-mock-huma-pool-state`):** Query mock Huma lender state. Verify total assets, lending mode, and redemption queue pointers.
  - [ ] **Number Formatting Verification:** Confirm that all amounts in terminal output use period (`.`) for decimals and comma (`,`) for thousands (e.g. `1,000,000.00 USDC`), matching frontend formatting standards.
- **Status:** `[ ] Unstarted`

---

## 🧪 Comprehensive CLI Command Execution Matrix

| Test ID    | Command                      | Required Flags                 | Optional / Test Arguments                                                   | Expected Outcome / On-Chain State Result                                |
| :--------- | :--------------------------- | :----------------------------- | :-------------------------------------------------------------------------- | :---------------------------------------------------------------------- |
| **CLI-01** | `init-global`                | None                           | `--admin <pubkey> --guardian <pubkey> --jobs <pubkey>`                      | `GlobalConfig` PDA initialized with specified roles.                    |
| **CLI-02** | `update-global-config`       | None                           | `--guardian <pubkey> --jobs <pubkey>`                                       | Guardian and jobs accounts updated on `GlobalConfig`.                   |
| **CLI-03** | `nominate-admin`             | `--new-admin <pubkey>`         | `--multisig <pubkey> --propose`                                             | Sets `pendingAdmin` on `GlobalConfig`. Fails if flag omitted.           |
| **CLI-04** | `cancel-admin-nomination`    | None                           | `--multisig <pubkey> --propose`                                             | Clears `pendingAdmin` on `GlobalConfig`.                                |
| **CLI-05** | `accept-admin`               | None                           | `--keypair candidate-admin.json`                                            | Finalizes admin transfer. Fails if signer != `pendingAdmin`.            |
| **CLI-06** | `create-pool`                | None (uses defaults)           | `--pool 1 --bond-price 1000000 --fee-bps 100 --tiers "1:5000,2:1500,5:400"` | `PrizePool` PDA, vault PDAs, and zero-copy `TicketRegistry` created.    |
| **CLI-07** | `initialize-huma-lender`     | None                           | `--pool 1`                                                                  | Huma lender state PDA and `$PST` vault initialized.                     |
| **CLI-08** | `resize-registry`            | None                           | `--pool 1`                                                                  | Zero-copy ticket registry PDA resized for increased user capacity.      |
| **CLI-09** | `set-prize-tiers`            | `--tiers <str\|json>`          | `--tiers "1:5000,2:2500,5:500" --pool 1`                                    | Prize tier distribution updated. Fails if sum != 10000 bps.             |
| **CLI-10** | `update-pool-config`         | At least 1 param               | `--fee-bps 150 --min-yield-threshold 5000000 --max-yield-bps 500 --pool 1`  | Pool configuration parameters updated on-chain.                         |
| **CLI-11** | `withdraw-fees`              | `--amount <val>` & `--confirm` | `--amount all --confirm --pool 1`                                           | Protocol fees transferred to `feeWallet`. Fails if `--confirm` omitted. |
| **CLI-12** | `pause-pool`                 | None                           | `--pool 1`                                                                  | Pool status changed to `Paused`. Deposits/withdrawals blocked.          |
| **CLI-13** | `unpause-pool`               | `--confirm`                    | `--pool 1 --confirm`                                                        | Pool status restored to `Active`. Fails if non-admin or unconfirmed.    |
| **CLI-14** | `close-pool`                 | `--confirm`                    | `--pool 1 --confirm`                                                        | Pool decommissioned permanently. Fails if unconfirmed.                  |
| **CLI-15** | `void-draw`                  | `--confirm`                    | `--pool 1 --cycle 0 --confirm`                                              | Active draw cycle voided; prize pot refunded. Fails if unconfirmed.     |
| **CLI-16** | `force-unlock-draw`          | `--confirm`                    | `--pool 1 --confirm`                                                        | Stuck draw unlocked; `isFrozenForDraw` reset to `false`.                |
| **CLI-17** | `rebind-randomness`          | `--new-randomness <pubkey>`    | `--pool 1 --new-randomness <PUBKEY>`                                        | Expired randomness account replaced on `DrawCycle`.                     |
| **CLI-18** | `harvest`                    | None                           | `--pool 1`                                                                  | Yield harvested from Huma, committed to prize pot, pool frozen.         |
| **CLI-19** | `prepare-draw`               | None                           | `--pool 1 --batch-size 500`                                                 | Batched ticket registry prefix sum calculation completed.               |
| **CLI-20** | `reveal`                     | None                           | `--pool 1 --seed <hex>`                                                     | Seed revealed, winners picked, `PayoutRegistry` populated.              |
| **CLI-21** | `reinvest`                   | None                           | `--pool 1 --winner 0`                                                       | Winnings converted back into principal bond tickets.                    |
| **CLI-22** | `query-config`               | None                           | None                                                                        | Prints formatted `GlobalConfig` state.                                  |
| **CLI-23** | `query-pool`                 | None                           | `--pool 1`                                                                  | Prints `PrizePool` state, vault balances, and parameters.               |
| **CLI-24** | `query-draw`                 | None                           | `--pool 1 --cycle 0`                                                        | Prints target `DrawCycle` state, prize pot, and randomness.             |
| **CLI-25** | `query-payout`               | None                           | `--pool 1 --cycle 0`                                                        | Prints winner payout distribution and progress.                         |
| **CLI-26** | `query-winnings`             | None                           | `--user <pubkey> --pool 1`                                                  | Prints user winnings PDA balance and claim stats.                       |
| **CLI-27** | `query-redemption`           | None                           | `--id 1 --user <pubkey> --pool 1`                                           | Prints pending redemption status, cool-down, and shares.                |
| **CLI-28** | `query-registry`             | None                           | `--user <pubkey> --pool 1`                                                  | Prints zero-copy ticket registry table & lazy-merge status.             |
| **CLI-29** | `query-mock-huma-pool-state` | None                           | `--address <pubkey>`                                                        | Prints mock Huma lending pool state and redemption queue.               |
| **CLI-30** | `squads-status`              | None                           | `--multisig <pubkey>`                                                       | Displays multisig threshold, members, timelock, and vault PDA.          |
| **CLI-31** | `squads-proposals`           | None                           | `--multisig <pubkey> --limit 10`                                            | Lists recent proposals with voting status and timelock.                 |
| **CLI-32** | `squads-inspect-tx`          | `--index <num>`                | `--multisig <pubkey> --index 1`                                             | Decodes inner instructions of target vault transaction.                 |
| **CLI-33** | `squads-approve`             | `--index <num>`                | `--multisig <pubkey> --index 1 --memo "Approve"`                            | Casts member approval vote on proposal.                                 |
| **CLI-34** | `squads-reject`              | `--index <num>`                | `--multisig <pubkey> --index 1 --memo "Reject"`                             | Casts member rejection vote on proposal.                                |
| **CLI-35** | `squads-cancel`              | `--index <num>`                | `--multisig <pubkey> --index 1`                                             | Cancels pending proposal by author or config authority.                 |
| **CLI-36** | `squads-close`               | `--index <num>`                | `--multisig <pubkey> --index 1 --rent-collector <pubkey>`                   | Closes executed/cancelled proposal and reclaims rent lamports.          |
| **CLI-37** | `squads-execute`             | None                           | `--index <num> --multisig <pubkey>`                                         | Executes approved proposal via multisig vault CPI.                      |

---

## 🎨 Visual, Layout & Accessibility (a11y) Checkpoints

### 1. Viewport & Breakpoint Matrix

- **Mobile (375px):** Verify single-column card layouts, collapsible drawer navigation, touch-friendly tap targets (minimum 44x44px), and zero horizontal overflow.
- **Tablet (768px):** Verify two-column dashboard grid, table scrolling with sticky headers, and responsive modal scaling.
- **Desktop (1024px - 1440px):** Verify full multi-column dashboard, sidebar expansion, and high-density data tables.

### 2. Accessibility (WCAG 2.1 Level AA) Matrix

- **Keyboard Navigation:** Full tab order traversal (`Tab` / `Shift+Tab`) across header, pool cards, modals, tabs, and docs search.
- **Focus Indicators:** Unbroken, high-contrast focus rings (`focus-visible:ring-2 focus-visible:ring-amber-500`) on all interactive inputs, buttons, and links.
- **No Keyboard Traps:** Modals ([`DepositModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/DepositModal.tsx), [`WithdrawModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/dashboard/WithdrawModal.tsx), [`DrawCycleInspectorModal.tsx`](file:///home/sebastian/vsc-workspace/premium-bonds/app/components/draws/DrawCycleInspectorModal.tsx)) trap focus internally while open and restore focus to trigger element upon `Escape` key close.
- **Color Contrast:** Minimum `4.5:1` contrast ratio for normal body text and `3:1` for large text/badges in both dark and light modes.
- **200% Zoom Scaling:** Verify full page layout reflows without text overlapping, clipped labels, or broken form inputs at 200% browser zoom.

---

## 🐛 Logged Bugs & Issues Tracker

| ID         | Title / Summary     | Charter / Tool | Severity | Environment       | Steps to Reproduce            | Expected vs. Actual           | Evidence / Logs       | Status |
| :--------- | :------------------ | :------------- | :------- | :---------------- | :---------------------------- | :---------------------------- | :-------------------- | :----- |
| _Template_ | _Example bug entry_ | _Charter #X_   | _Minor_  | _Chrome / Devnet_ | _1. Open modal<br>2. Click X_ | _Exp: Closes<br>Act: Freezes_ | _Console log snippet_ | _Open_ |

> **Severity Scale:**
>
> - **Critical:** Blocks core funds flow (deposit/withdrawal/claim), security vulnerability, potential fund loss, or application crash.
> - **Major:** Feature broken or command fails with no reasonable workaround (e.g. CLI confirmation bypass failure, modal submit hang).
> - **Minor:** UI layout issues, visual misalignment, minor accessibility warning, or terminal formatting cosmetic defect.

---

## 🔍 Sign-off & Verification Checklist

- [ ] **Web Functional Verification:** All deposit, draw inspection, yield claim, auto-reinvest, and 2-step principal redemption flows operate cleanly without unhandled exceptions.
- [ ] **Web Edge Case & Boundary Handling:** Form validations catch negative amounts, zero inputs, remainder dust, and insufficient balances with context-aware helper alerts.
- [ ] **Web Realtime Synchronization:** Pusher webhook broadcasts trigger automatic UI invalidation and state synchronization across multiple open browser tabs.
- [ ] **Web Visual & Responsive Fidelity:** Layouts verified across 375px, 768px, 1024px, and 1440px breakpoints with zero layout shift (CLS).
- [ ] **Web Accessibility (a11y):** Full keyboard navigation verified, focus rings visible, modal focus traps intact, and 200% zoom reflow passes.
- [ ] **Web Console & Runtime Health:** Browser console is free of uncaught JavaScript errors, network 404/500 errors, or missing React `key` warnings.
- [ ] **CLI Admin Governance & Two-Step Transfer:** Two-step admin transfer (`nominate-admin` -> `accept-admin` / `cancel-admin-nomination`) works seamlessly on-chain.
- [ ] **CLI Safety & Guardrails:** High-risk admin operations (`withdraw-fees`, `unpause-pool`, `close-pool`, `void-draw`, `force-unlock-draw`) strictly enforce `--confirm` flags.
- [ ] **CLI Squads V4 Multisig Pipeline:** Proposal creation, transaction inspection, member voting, timelock verification, and vault CPI execution succeed across all execution modes (`--propose`, `--export-ix`, `--dry-run`).
- [ ] **CLI Crank & Draw Pipeline Integrity:** Batched preparation, yield harvesting, seed revelation, winner resolution, and reinvestment execute successfully across all cycles.
- [ ] **CLI Query Accuracy & Number Formatting:** All `query-*` commands accurately deserialize on-chain accounts and format token amounts in `"en-US"` format.
- [ ] **Sign-off Status:** `[ ] Approved | [ ] Blocked`

---

## 📝 Execution Guide & Setup Steps

1. **LiteSVM Contract Base Verification:**
   ```bash
   cd anchor && cargo test
   ```
2. **Localnet Environment Provisioning:**
   ```bash
   npm run localnet start
   npm run localnet bootstrap
   ```
3. **Frontend Development Server:**
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` to execute Web dApp test charters.
4. **CLI Test Execution:**
   ```bash
   npm run pb-cli -- --help
   ```
