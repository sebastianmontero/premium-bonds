# Troubleshooting & FAQ Reference for Web3 dApps

## Overview

The Troubleshooting & Support section is the primary self-service resource for users experiencing transaction failures, wallet connection conflicts, network latency, or unexpected error popups. This reference provides an error translation matrix, step-by-step resolution guides, and a canonical Web3 dApp FAQ template.

---

## Web3 & Solana Error Translation Matrix

Map cryptic, low-level error codes into actionable user troubleshooting instructions:

| Raw Error Code / Name                   | Underlying Root Cause                                               | User-Facing Explanation                                | Step-by-Step Resolution                                                                             |
| :-------------------------------------- | :------------------------------------------------------------------ | :----------------------------------------------------- | :-------------------------------------------------------------------------------------------------- |
| **`4001` / `UserRejectedRequestError`** | User clicked "Deny" or closed the wallet popup.                     | Action was cancelled in your wallet.                   | No action required. Re-initiate action whenever you are ready.                                      |
| **`Custom(6000)` / `0x1770`**           | Custom Anchor program error (e.g. `InsufficientFunds`).             | Insufficient token balance to complete deposit.        | Verify your wallet token balance and ensure you have enough funds.                                  |
| **`Custom(6001)` / `0x1771`**           | Custom Anchor program error (e.g. `SlippageExceeded`).              | Price moved beyond your set slippage limit.            | Increase slippage tolerance (e.g. from `0.5%` to `1.0%`) or wait for market volatility to decrease. |
| **`0x1` / `InsufficientFundsForFee`**   | Wallet native balance is too low to pay network fees.               | Insufficient SOL balance for network transaction fees. | Transfer at least `0.05 SOL` to your wallet to cover network transaction fees.                      |
| **`BlockheightExceeded` / `0x...`**     | Network congestion; transaction blockhash expired before execution. | Transaction timed out due to high network traffic.     | Click **[Retry Transaction]**. Enable Priority Fees in settings to prioritize your submission.      |
| **`TransactionSimulationFailed`**       | On-chain pre-flight simulation failed.                              | Transaction pre-check failed on the network.           | Review form inputs. Check if your wallet holds required tokens or approvals.                        |
| **`WalletNotConnectedError`**           | App tried executing instruction without active wallet connection.   | Wallet disconnected unexpectedly.                      | Click **[Connect Wallet]** in the top header and re-authenticate.                                   |

---

## Step-by-Step Troubleshooting Playbooks

### Playbook 1: Resolving Stuck / Pending Transactions

When transactions hang in a "Pending" state due to RPC node congestion or low priority fees:

1. **Do NOT Resubmit Repeatedly**: Sending multiple identical transactions can lead to duplicate executions or wasted network fees.
2. **Check Solscan Explorer**: Click your wallet's transaction history link to inspect the on-chain status on [Solscan Explorer](https://solscan.io).
3. **Adjust Priority Fees**:
   - Open dApp **Settings** (⚙️ gear icon).
   - Set Priority Fee Mode to **Dynamic High** or input a custom compute unit price (e.g. `50,000 micro-lamports`).
4. **Switch RPC Endpoint**:
   - If the RPC node is unresponsive, go to dApp Settings -> RPC Connection.
   - Switch from Default Public RPC to a dedicated RPC provider (e.g. Helius, Triton, QuickNode).

---

### Playbook 2: Fixing Wallet Connection & Browser Extension Conflicts

When multiple wallet extensions (Phantom, Solflare, Backpack, MetaMask) conflict for `window.solana` window injection:

1. **Disable Unused Extension Injections**:
   - Open browser extension settings (`chrome://extensions`).
   - Temporarily disable secondary wallet extensions not currently in use.
2. **Clear Site Cache & Reconnect**:
   - Hard refresh the dApp page (`Ctrl + Shift + R` or `Cmd + Shift + R`).
   - Click **[Disconnect Wallet]** inside the dApp menu, then click **[Connect Wallet]** to select your primary wallet.
3. **Hardware Wallet (Ledger) Troubleshooting**:
   - Ensure the **Solana App** is open on your physical Ledger device.
   - Enable **Blind Signing** / **Allow Arbitrary Data** in Ledger device settings.

---

## Canonical Web3 dApp FAQ Template

Incorporate these standardized Q&As into your `docs/4-troubleshooting-and-support/faq.md` page:

```markdown
# Frequently Asked Questions (FAQ)

## 1. General & Account Questions

### Q: Do I need to create an account or password to use this dApp?

**A:** No. Web3 applications do not require traditional usernames or passwords. Your connected Web3 wallet (e.g. Phantom) serves as your secure account identity.

### Q: Why am I prompted to sign a message when connecting?

**A:** Signing a message (e.g. "Verify Ownership") allows the dApp to verify that you own the connected wallet address. This signature is strictly read-only and **does not cost any SOL or execute transactions**.

---

## 2. Transactions & Fees

### Q: Why did my transaction fail, and why did it cost SOL?

**A:** On blockchain networks like Solana, validators consume compute resources to process and simulate instructions. If a transaction fails on-chain (for example, due to price slippage exceeding limits), network validators still collect a tiny transaction fee for processing the computational execution.

### Q: How much SOL should I keep in my wallet for fees?

**A:** We recommend maintaining a minimum buffer of **`0.05 SOL`** in your wallet at all times to ensure smooth approval of network transaction fees and account rent deposits.

### Q: Where did my tokens go after depositing?

**A:** Deposited tokens are safely transferred into the protocol's audited program vault. In return, your wallet receives an on-chain receipt or yield ticket balance. You can view your active deposits and claimable yields at any time on the dApp Dashboard page.

---

## 3. Support & Community

### Q: How can I contact official support if I need assistance?

**A:** Official support is available through our community channels:

- **Discord**: Join [Official Discord Server ↗](https://discord.gg/yourdapp) and open a ticket in `#support`.
- **Security Inquiries**: Email `security@your-dapp-domain.io`.

> [!CAUTION]
> **Beware of Impersonators**: Official team members will NEVER direct message (DM) you first on Discord or Twitter. Never share your seed phrase or private key!
```
