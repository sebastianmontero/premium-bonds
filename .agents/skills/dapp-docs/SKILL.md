---
name: dapp-docs
description: Playbook and reference guide for designing, writing, and structuring documentation, help centers, contextual in-app guidance, microcopy, and troubleshooting pages for Web3 dApps. Use when creating dApp help centers, writing user onboarding guides, adding rich tooltips or in-app help drawers, formulating security disclosures, or designing human-readable error troubleshooting guides.
user-invocable: true
license: MIT
metadata:
  version: 1.0.0
---

# Web3 dApp Documentation & Help Pages Skill

## What this Skill is for

Use this Skill when:

- **Building or Structuring Documentation Sites**: Setting up GitBook, Docusaurus, or native Next.js MDX help centers for a dApp.
- **Writing User Onboarding & Feature Guides**: Creating step-by-step walkthroughs for wallet connection, gas funding, token swaps, staking, lending, or liquidity provision.
- **Designing In-App Contextual Guidance**: Writing microcopy, rich tooltips, inline warning banners, or help drawers inside the dApp UI.
- **Formulating Security & Risk Disclosures**: Writing audit verification callouts, seed phrase/security warnings, slippage notices, and financial risk disclosures.
- **Building Error & Troubleshooting Pages**: Designing human-readable error messages, stuck transaction resolution guides, and self-service support FAQs.

---

## Core Guidelines & Best Practices

### 1. Plain-Language Microcopy ("Familiarity First")

Crypto-jargon increases cognitive load and causes user drop-off. Always translate technical blockchain terms into plain, human-friendly UX copy.

| Avoid ("Crypto-Speak")            | Prefer (Human UX Copy)               | Contextual Purpose                       |
| :-------------------------------- | :----------------------------------- | :--------------------------------------- |
| **Gas Fee / Priority Fee**        | **Network Fee**                      | Explaining transaction costs clearly.    |
| **Public Key / Address**          | **Account Address / Wallet Address** | Identifying destination accounts.        |
| **Sign Transaction**              | **Confirm Action**                   | Presenting wallet approval prompts.      |
| **Broadcast / Mining**            | **Submitting to Blockchain**         | Progress status during execution.        |
| **Slippage Tolerance**            | **Price Difference Limit**           | Form inputs for decentralized trades.    |
| **PDA (Program Derived Address)** | **Protocol Account / Vault**         | On-chain state storage accounts.         |
| **Nonce / Blockhash Expired**     | **Transaction Timeout**              | Explaining why a request needs retrying. |

> [!TIP]
> Always format numbers using explicit `"en-US"` locale formatting: use commas (`,`) for thousands separators and periods (`.`) for decimals (e.g. `1,250.50 SOL`, `$4,500.00`).

---

### 2. The 3-Step Human-Readable Error Formula

Every dApp error message—whether presented in a toast, modal, or troubleshooting doc—must satisfy three criteria:

1. **State What Happened**: Explain the issue without raw hex codes (e.g., `"The price moved beyond your slippage limit"` instead of `Custom(6001)`).
2. **Explain How to Fix It**: Provide actionable advice (e.g., `"Increase slippage tolerance to 1.0% or wait for market volatility to decrease"`).
3. **Provide an Immediate Action Path**: Supply a button or direct link (e.g., `[Adjust Slippage]`, `[Switch to Devnet]`, `[Read Troubleshooting Guide]`).

---

### 3. Progressive Disclosure Architecture

Do not overwhelm new users with 20 pages of smart contract code or tokenomics on their first visit. Structure information progressively:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. IN-APP MICROCOPY & TOOLTIPS (Level 1: Just-in-time info)  │
└───────────────┬─────────────────────────────────────────────┘
                │ User clicks "Learn More"
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. USER GUIDES & HOW-TO DOCS (Level 2: Step-by-step UI)     │
└───────────────┬─────────────────────────────────────────────┘
                │ User clicks "Protocol Mechanics / Technical"
                ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. TECHNICAL SPECS & AUDITS (Level 3: Deep architecture)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 4-Tier Information Architecture Matrix

When organizing documentation for a Web3 application, enforce this 4-tier directory hierarchy:

```
docs/
├── 1-getting-started/       # Onboarding, wallet setup, acquiring native tokens
├── 2-protocol-guides/      # Core features, visual walkthroughs, risk disclosures
├── 3-in-app-help/          # Microcopy guidelines, tooltip references, UI states
└── 4-troubleshooting/      # Error decoders, FAQs, stuck transactions, security
```

### Overview of Tiers

1. **Getting Started & Onboarding**:
   - What is the dApp & Key Value Proposition.
   - Setting up a compatible wallet (e.g., Phantom, Solflare).
   - Acquiring SOL / native gas tokens.
   - Connecting wallet and signature vs. transaction authorization safety.

2. **Protocol Mechanics & Feature Guides**:
   - Visual step-by-step guides for core features (e.g., Deposit, Swap, Borrow, Stake).
   - Yield breakdown: Explaining APY vs. APR, rewards emission schedule, and fees.
   - Risk disclosures: Impermanent loss, collateral liquidation thresholds, smart contract risks.

3. **In-App Contextual Assistance**:
   - Tooltip specs for UI elements.
   - Transaction progress state machine indicators.
   - Inline warning banners (e.g. low SOL balance, high slippage, unverified tokens).

4. **Troubleshooting, Recovery & Support**:
   - Common error codes mapped to step-by-step solutions.
   - Resolving stuck / pending transactions & switching RPC nodes.
   - Official links, security audit reports, multi-sig addresses, and community support channels.

---

## Transaction Lifecycle UX & Status Messaging

Surfacing transaction progress reduces user anxiety during on-chain execution:

```
       [IDLE]
         │ (User clicks action)
         ▼
 ┌────────────────┐
 │ 1. PREPARING   │ ──► "Estimating fees & simulating transaction..."
 └───────┬────────┘
         │
         ▼
 ┌────────────────┐
 │ 2. SIGNING     │ ──► "Please approve the prompt in your wallet."
 └───────┬────────┘
         ├─── (User Denies / Code 4001) ──► Quiet Gray Toast: "Action cancelled"
         │
         ▼
 ┌────────────────┐
 │ 3. SUBMITTING  │ ──► "Submitting transaction to the network..."
 └───────┬────────┘
         │
         ▼
 ┌────────────────┐
 │ 4. CONFIRMING  │ ──► "Waiting for network confirmation..." (Show Explorer Link)
 └───────┬────────┘
         ├───────────────┬───────────────┐
         ▼               ▼               ▼
   [CONFIRMED]     [SIM ERROR]     [TIMEOUT / EXPIRED]
   Green Toast     Decode Error    Amber Toast with
   + Explorer link & Red Toast     "Retry Transaction"
```

---

## Documentation Platform Matrix

Choose the appropriate documentation tool based on team workflow and technical requirements:

| Platform               | Best For                              | Pros                                                                       | Cons                                                                |
| :--------------------- | :------------------------------------ | :------------------------------------------------------------------------- | :------------------------------------------------------------------ |
| **Docusaurus**         | Technical teams, Docs-as-code         | Free, open-source, full React/MDX support, native search, git-integrated.  | Requires developer setup & deployment pipeline.                     |
| **GitBook**            | Cross-functional teams (PMs, writers) | WYSIWYG editor, zero infrastructure, clean default theme.                  | Closed ecosystem, limited custom React components on free tiers.    |
| **Native Next.js MDX** | Unified dApp + Docs integration       | Seamless styling with dApp design system, shared UI components & tooltips. | Must build site navigation, search, and table-of-contents manually. |

---

## Reference Guides (Progressive Disclosure)

Refer to these targeted reference guides when executing specific documentation tasks:

- **Information Architecture Taxonomy**: [references/information-architecture.md](references/information-architecture.md) — Full directory layout, sidebar configuration, and page templates.
- **In-App Microcopy & Tooltips**: [references/in-app-microcopy-and-tooltips.md](references/in-app-microcopy-and-tooltips.md) — Tooltip components, microcopy dictionary, and React boilerplate.
- **Security & Risk Disclosures**: [references/security-and-risk-disclosures.md](references/security-and-risk-disclosures.md) — Security warning banners, audit display templates, and risk callouts.
- **Troubleshooting & FAQs**: [references/troubleshooting-and-faqs.md](references/troubleshooting-and-faqs.md) — Error translation matrix, stuck transaction resolution, and canonical Web3 FAQ.
