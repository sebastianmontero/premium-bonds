# Security & Risk Disclosures Guide for Web3 dApps

## Overview

Security transparency builds user confidence and protects users from malicious phishing attacks, unvetted smart contracts, and unexpected financial losses. This reference outlines standardized callout alerts, audit disclosures, token approval management guides, and risk disclaimer templates for Web3 dApps.

---

## Standardized Alert Callouts

Use GitHub-style alert callouts strategically across documentation pages and in-app help drawers to emphasize critical security information:

```markdown
> [!CAUTION]
> **NEVER Share Your Seed Phrase**: The protocol team, support agents, or moderators will NEVER ask for your 12/24-word seed phrase, recovery keys, or private key under any circumstances.

> [!WARNING]
> **Check the Domain Name**: Always verify that the URL in your browser address bar is exactly `https://app.your-dapp-name.io`. Bookmark official links and avoid clicking sponsored links on search engines.

> [!IMPORTANT]
> **Token Approvals**: When approving token allowances for decentralized trades, verify the exact spender address. Regularly review and revoke unused approvals on [Revoke.cash](https://revoke.cash).

> [!NOTE]
> **Rent Exemption Fee**: Solana requires a small, one-time SOL deposit (approx. `0.00204 SOL`) to initialize on-chain storage for new accounts. This SOL is fully refunded when you close the account.
```

---

## Smart Contract Audit & Verification Template

Every dApp documentation site must maintain a dedicated **Smart Contract Audits & Security** page containing verified contract details, audit reports, and multi-sig information.

### Markdown Page Structure Template

```markdown
# Smart Contract Security & Audits

Transparency and security are foundational to our protocol. All on-chain smart contracts undergo rigorous external security audits and formal verification prior to mainnet deployment.

## Audit Reports

| Date             | Security Firm | Scope / Contracts Audited          | Status               | Report Link                                                      |
| :--------------- | :------------ | :--------------------------------- | :------------------- | :--------------------------------------------------------------- |
| **June 2026**    | **OtterSec**  | Anchor Core Protocol (`v1.2.0`)    | Passed (0 Critical)  | [View Audit PDF ↗](https://example.com/audits/ottersec-v1.2.pdf) |
| **January 2026** | **Sec3**      | Vault & Ticket Registry (`v1.0.0`) | Resolved (All Fixed) | [View Audit PDF ↗](https://example.com/audits/sec3-v1.0.pdf)     |

---

## On-Chain Contract Addresses

Always verify the contract addresses displayed in your wallet approval prompts against this official list:

| Network            | Contract Name           | Program / Token Address | Explorer Link                                      |
| :----------------- | :---------------------- | :---------------------- | :------------------------------------------------- |
| **Solana Mainnet** | Core Protocol Program   | `Pzo...111`             | [Solscan ↗](https://solscan.io/account/Pzo...111)  |
| **Solana Mainnet** | Prize Vault Storage PDA | `Vau...222`             | [Solscan ↗](https://solscan.io/account/Vau...222)  |
| **Solana Mainnet** | Protocol Multi-Sig      | `MSig...333`            | [Solscan ↗](https://solscan.io/account/MSig...333) |

---

## Multi-Sig Governance & Emergency Circuit Breakers

- **Admin Multi-Sig Threshold**: Program upgrades and critical parameters require a **4-of-7 multi-sig approval** managed by key community stakeholders.
- **Timelock**: Upgrade transactions are delayed by a **48-hour timelock**, allowing users time to withdraw funds if they disagree with protocol changes.
- **Circuit Breakers**: In the event of anomalous price volatility or external exploit detection, the multi-sig can pause deposits while preserving emergency user withdrawals.

---

## Bug Bounty Program

We host an active Bug Bounty program on **Immunefi**.

- **Maximum Reward**: Up to `$100,000.00 USDC` for critical smart contract vulnerabilities.
- **Report Vulnerability**: Submit reports securely via [Immunefi Bug Bounty Page ↗](https://immunefi.com).
```

---

## DeFi Financial Risk Disclosures

Integrate clear, explicit risk disclaimers into protocol feature guides (such as liquidity pools, lending, or yield farming):

### 1. Impermanent Loss Risk Disclosure

```markdown
### ⚠️ Impermanent Loss Risk

Providing liquidity to dual-asset pools (e.g. `SOL-USDC`) carries the risk of impermanent loss. If the relative price of `SOL` changes significantly compared to `USDC` while deposited, the total value of your assets upon withdrawal may be lower than if you had simply held the tokens in your wallet.
```

### 2. Collateral Liquidation Risk Disclosure

```markdown
### ⚠️ Liquidation Risk

When borrowing assets against collateral (e.g. borrowing `USDC` against `SOL`), your position maintains a **Loan-to-Value (LTV) Ratio**. If the market value of your collateral decreases and exceeds the maximum LTV threshold (e.g., `80.00%`), your collateral will be partially liquidated to pay down debt, incurring a `5.00%` liquidation penalty.
```

### 3. Smart Contract Risk Disclosure

```markdown
### ⚠️ Smart Contract & Protocol Risk

While our smart contracts are audited by leading security firms, interacting with decentralized financial protocols inherently carries smart contract risk, network congestion risk, and systemic oracle risks. Never deposit more funds than you can afford to lose.
```

---

## Official Domain & Anti-Phishing Checklist

Maintain an explicit anti-phishing verification checklist for users:

1. **Verify Browser URL**: Always bookmark `https://app.your-dapp-name.io` and enter via bookmarked links.
2. **Never Click Sponsored Search Ads**: Malicious actors frequently purchase search engine ads posing as legitimate dApps.
3. **Verify Wallet Connection Prompts**: When connecting Phantom or Solflare, confirm the origin site shown in the wallet popup matches the official domain.
4. **Official Social Media & Support Channels**:
   - **X (Twitter)**: `@YourDappOfficial` (Verify official badge)
   - **Discord**: `discord.gg/yourdapp` (Never trust direct messages from support impersonators)
   - **GitHub**: `github.com/yourdapp/core`
