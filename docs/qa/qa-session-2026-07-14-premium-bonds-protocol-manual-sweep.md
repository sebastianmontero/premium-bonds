# QA Session: YieldBonds Protocol Manual Sweep (2026-07-14)

## 📋 Session Metadata

- **Date:** 2026-07-14
- **Session Lead:** [Assign Tester/Agent Name]
- **Target Environment:** Localnet / Surfpool Simulator (Or Devnet staging)
- **Scope & Objective:** Verify functional correctness, visual consistency, responsive layout, and technical accessibility of the YieldBonds Protocol client interface.
- **Test Credentials / Wallets:**
  - Account 1 (Connected Mode): `[Insert Localnet/Devnet Solana Wallet Address]`
  - Account 2 (Connected Mode): `[Insert Secondary Wallet Address for Crank/Winner Testing]`

---

## 🎯 Test Charters

These charters guide the exploratory testing session without restricting testers to rigid scripts.

### Charter #1: Wallet Connection & Dual-State Navigation

- **Objective / Focus:** Explore the behavior and usability of Wallet Connection states and mock/connected navigation.
- **Scenario Notes:**
  1. Load the landing page ([/](file:///home/sebastian/vsc-workspace/premium-bonds/app/page.tsx)) and verify all hero, stats, and informational sections load without layout shifts.
  2. Navigate to the dashboard.
  3. **Disconnected State (Mock Demo)**:
     - Verify the dashboard displays the simulated demo mode banner/indicator.
     - Confirm all cards render initial mock state metrics: Net Worth (~$1,257.00), Active Tickets (250), Unclaimed Winnings ($7.00), Lifetime Winnings (~$150.00), and Wallet Balance (500.00 USDC).
  4. **Connection Flow**:
     - Click **Connect Wallet** in the Navbar/Header.
     - Verify the Solana wallet selection modal appears and triggers the adapter connection prompt.
     - Connect a Solana wallet configured for Solana Localnet.
  5. **Connected State**:
     - Verify the wallet address displays in truncated base58 format in the Navbar.
     - Verify dashboard counters update to show actual on-chain account data (e.g. 0 active tickets for a new wallet).
  6. **Disconnection Flow**:
     - Disconnect the wallet from the Navbar button.
     - Verify the dashboard falls back to Mock Demo mode immediately without visual glitches or memory leaks.
- **Target Areas:** State synchronization, session recovery, UX continuity, wallet-standard compliance.
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed

### Charter #2: Deposit Flow & Ticket Minting (Mock & On-Chain)

- **Objective / Focus:** Validate input sanitization, ticket calculations, and the transaction execution pipeline for deposits.
- **Scenario Notes:**
  1. Open the **Deposit Modal** (click "Deposit" on the Pool Card).
  2. **Boundary & Negative Input Testing**:
     - Attempt to input negative numbers (e.g., `-10`), letters (`abc`), special characters, or emojis. Verify they are either blocked or sanitized.
     - Click **Buy Tickets** with an empty input field. Verify a helpful validation warning is shown.
     - Enter `0`. Verify validation blocks the transaction.
     - Enter a value exceeding the wallet balance (e.g., `600` in mock mode). Verify the modal displays a balance warning or disables submission.
     - Verify the ticket multiplier: entering `10` USDC correctly outputs "2 tickets" (since bond price is 5 USDC). Verify how fractional inputs (e.g., `7` USDC) are handled.
  3. **Mock Mode Execution**:
     - Input `25` USDC (5 tickets) and click **Buy Tickets**.
     - Verify simulated spinner completes, Net Worth increases by $25.00, Active/Pending Tickets increases by 5, and the Activity Feed displays: "Deposited 25 USDC → +5 tickets".
  4. **On-Chain Mode Execution**:
     - Connect your wallet and seed it using: `npm run localnet fund <address> 100` (provides SOL + 100 USDC).
     - Open the Deposit Modal, input `50` USDC (10 tickets), and click **Buy Tickets**.
     - Approve the transaction in your wallet. Verify the spinner transitions from pending to success.
     - Confirm on-chain data updates (Active/Pending ticket counts) on the dashboard.
- **Target Areas:** Input validation, transaction signing prompts, visual feedback, on-chain balances.
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed

### Charter #3: Withdrawal (Bond Sale) & Huma Asynchronous Settle

- **Objective / Focus:** Validate bond redemptions, pending redemption status queues, local mock simulator, and on-chain Huma time warping.
- **Scenario Notes:**
  1. Open the **Withdraw Modal** (click "Withdraw" on the Pool Card).
  2. **Boundary Testing**:
     - Verify you cannot request to withdraw more bonds than your active balance.
     - Enter negative/invalid numbers and ensure they are blocked.
  3. **Mock Mode Withdrawal**:
     - Request to withdraw `10` bonds (50 USDC) and click **Request Withdrawal**.
     - Verify active tickets count decreases by 10.
     - Confirm a record is created under **Pending Redemptions** with amount `$50.00`, status `settling`, type `bond_sale`.
     - Locate the redemption in the list and click **Simulate Settle**. Verify status transitions to `ready`.
     - Click **Claim** on the settled redemption. Verify the record is removed, wallet balance increases (if simulated), and a claim activity is added to the feed.
  4. **On-Chain Withdrawal & Settlement**:
     - Connect wallet, acquire tickets, and request to withdraw `2` bonds (10 USDC).
     - Confirm the wallet transaction and verify a pending redemption is created with status `settling`.
     - In the terminal, trigger a Huma clock warp to simulate the lockup period expiring:
       `npm run localnet warp <seconds>`
     - Refresh the dashboard. Verify the redemption status has updated to `ready`.
     - Click **Claim to Wallet**, sign the transaction, and verify the USDC has been transferred back to your wallet ATA.
- **Target Areas:** Asynchronous state queueing, clock-warping logic, transaction signing, Huma integration wrapper constraints.
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed

### Charter #4: Draw History, Reinvest Crank & Dust Claiming

- **Objective / Focus:** Verify draw payouts, the multi-batch auto-reinvestment crank, and claiming non-reinvested "dust" winnings.
- **Scenario Notes:**
  1. Locate the **Prize History Ledger** on the dashboard.
  2. **Inspect Draw Details**:
     - Click on a draw cycle row (e.g., Draw #41) to open the **Prize Details Modal**.
     - Verify the winner list, total prize pot, and payout splits.
  3. **Crank Reinvestment (Mock Mode)**:
     - Locate a winning entry with status "winning" or "partial" (e.g. Draw #41 Consolation where user has a claim).
     - Click **Crank Reinvestment**. Note that reinvestment is processed in batches of up to 5 bonds ($25 USDC) per transaction.
     - Verify that for large prizes (e.g., $85), the first crank processes 5 bonds ($25), status changes to "partial" (with $25 reinvested, +5 tickets added to active tickets, $60 remaining).
     - Click crank again. It processes another 5 bonds ($25), status remains "partial" ($50 reinvested, +10 tickets, $35 remaining).
     - Click crank a third time. It processes 5 bonds ($25). Since the remaining is $10 (2 bonds, no dust), verify it completes the reinvestment.
     - If there is leftover "dust" (e.g. $2.50, which is less than the 5 USDC bond price), verify it accumulates in the user's **Unclaimed Winnings** balance, and the draw status changes to `reinvested`.
  4. **Claim Dust Winnings**:
     - Verify the **Unclaimed Banner** is displayed if the Unclaimed Winnings balance is > 0.
     - Click **Claim Winnings**. Verify the Unclaimed Winnings balance drops to $0, and a new pending redemption record is created for the claimed dust amount.
  5. **On-Chain Draw & Crank (Localnet)**:
     - Use `npm run localnet warp` to transition the current active draw cycle.
     - Verify a new draw ledger entry is populated.
     - If the connected wallet won, trigger the reinvestment crank transaction. Sign the transaction in the wallet and verify the state updates on-chain.
- **Target Areas:** Batch calculation correctness, dust accumulation logic, modal state updates.
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed

### Charter #5: Responsive Layout, UX Polish, and Accessibility (a11y)

- **Objective / Focus:** Perform a visual and interaction audit for desktop/mobile consistency and keyboard friendliness.
- **Scenario Notes:**
  1. **Responsive Viewport Sweeps**:
     - Open Chrome DevTools, toggle device mode.
     - Test at Mobile (375px), Tablet (768px), Laptop (1024px), and Desktop (1440px).
     - Verify the Sidebar collapses/toggles into a mobile drawer or hamburger menu.
     - Check the stats row and pool cards: do they wrap correctly? Verify no text clips or overflows.
  2. **Keyboard Navigation & Outline Audit**:
     - Navigate the page using ONLY the `Tab` and `Shift + Tab` keys.
     - Verify that all buttons (Connect Wallet, Deposit, Withdraw, Claim, Details, Close) have a clearly visible focus outline when selected.
     - Verify that pressings `Enter` or `Space` triggers the buttons.
     - Verify that opening a modal (Deposit/Withdraw/Details) traps the focus inside the modal so the user cannot accidentally tab back to the background page. Pressing `Esc` must close the modal and return focus to the trigger button.
  3. **Lighthouse and Console Audit**:
     - Open DevTools Console. Verify there are no errors, failed fetches, or React `key` warnings during navigation and simulation.
     - Run a Lighthouse performance scan and check accessibility scores.
  4. **Layout Shift (CLS)**:
     - Refresh `/dashboard` in mock mode. Verify that elements load smoothly without visual layout jumps or unstyled content flash.
- **Status:** [ ] Unstarted | [ ] In Progress | [ ] Completed

---

## 🐛 Logged Bugs & Issues

Use the following table to document any bugs found during the session.

| ID     | Title / Summary     | Charter    | Severity | Environment    | Steps to Reproduce | Expected vs. Actual  | Evidence (Screenshot/Logs) | Status |
| :----- | :------------------ | :--------- | :------- | :------------- | :----------------- | :------------------- | :------------------------- | :----- |
| Bug-01 | [Short description] | Charter #1 | Major    | Chrome/Phantom | 1. ...<br>2. ...   | Exp: ...<br>Act: ... | [Link to image/logs]       | Open   |
| Bug-02 | [Short description] | Charter #1 | Minor    | Safari/Mobile  | 1. ...<br>2. ...   | Exp: ...<br>Act: ... | [Link to image/logs]       | Open   |

> **Severity Scale:**
>
> - **Critical:** Blocks core flows, crashes application, security vulnerability, data corruption.
> - **Major:** Broken feature or user flow with no reasonable workaround.
> - **Minor:** UI layout issues, visual alignment, minor accessibility issues, cosmetic flaws.

---

## 🔍 Sign-off Checklist

All items must be completed and approved before signing off the release.

- [ ] **Functional Verification:** All features in scope behave correctly according to specifications.
- [ ] **Edge Case Testing:** Validations handle negative numbers, empty states, and interruptions.
- [ ] **Responsive Design:** Checked mobile, tablet, laptop, and desktop viewports.
- [ ] **A11y Check:** Visually verified high contrast, tested keyboard focus outline, no tab loops.
- [ ] **Console check:** No errors or unexpected warnings printed to the browser console.
- [ ] **Sign-off Status:** [ ] Approved | [ ] Blocked

---

## 📝 Notes / Comments

_Add any additional session feedback, performance logs, or follow-up ideas here._
