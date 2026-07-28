# In-App Microcopy & Tooltip Design Patterns for Web3 dApps

## Overview

In-app microcopy and contextual help bridge the gap between complex blockchain mechanics and intuitive user interfaces. By embedding "just-in-time" guidance directly into forms, action buttons, and status indicators, you reduce user anxiety and transaction abandonment.

---

## Web3 Microcopy Translation Dictionary

Replace confusing technical crypto terms across all dApp UI elements with standardized, human-centric UX copy:

| Category            | Raw Blockchain Term           | Recommended UI Microcopy    | Context / Helper Text                                                               |
| :------------------ | :---------------------------- | :-------------------------- | :---------------------------------------------------------------------------------- |
| **Authentication**  | Connect Web3 Wallet           | **Connect Wallet**          | _"Connect your Web3 wallet to access your assets."_                                 |
| **Authentication**  | Sign Message / Personal Sign  | **Verify Wallet Ownership** | _"This signature is free and does not cost any gas."_                               |
| **Costs**           | Gas Limit / Compute Units     | **Max Network Fee**         | _"Maximum SOL paid to process your transaction."_                                   |
| **Costs**           | Priority Fee / Dynamic CU     | **Speed Boost Fee**         | _"Optional priority fee to speed up processing."_                                   |
| **Transactions**    | Execute Instruction           | **Confirm Action**          | _"Clicking confirm will open your wallet prompt."_                                  |
| **Transactions**    | Transaction Broadcasted       | **Submitted to Network**    | _"Your request is being processed on the blockchain."_                              |
| **State Storage**   | Rent Exemption                | **Account Storage Fee**     | _"One-time deposit to open on-chain storage. Fully refundable on closure."_         |
| **DeFi Parameters** | Slippage Tolerance            | **Price Difference Limit**  | _"Your transaction will cancel if the price changes by more than this percentage."_ |
| **DeFi Yield**      | APY (Compound) vs APR         | **Net Annual Yield**        | _"Estimated return per year including reward distributions."_                       |
| **Solana State**    | PDA (Program Derived Address) | **Protocol Vault**          | _"Secure program-controlled storage account."_                                      |

---

## Tooltip Design Patterns

### 1. Simple Tooltips (Inline Terminology Clarification)

Use simple tooltips (short text on hover/focus) for quick definitions of abbreviations or standard metric labels.

- **Trigger**: `(i)` info icon or dotted underlined text.
- **Content Limit**: 1–2 short sentences (max 120 characters).
- **Accessibility**: Must include `aria-describedby` or `aria-label` and handle keydown (`Escape`) events.

### 2. Rich Tooltips (Interactive / Complex Explanations)

Use rich tooltips for multi-step or multi-variable concepts like Slippage, APY vs. APR, or Impermanent Loss.

- **Content**: Formatted title, bulleted breakdown, and explicit `[Learn More ->]` link pointing to the documentation site.
- **Behavior**: Dismissible with an explicit close button or backdrop tap.

---

## Production React Component Boilerplate

### 1. Accessible Contextual Tooltip Component (`ContextualHelpTooltip.tsx`)

```tsx
"use client";

import React, { useState, useId } from "react";

interface ContextualHelpTooltipProps {
  title: string;
  content: string;
  docLink?: string;
  children?: React.ReactNode;
}

export function ContextualHelpTooltip({
  title,
  content,
  docLink,
  children,
}: ContextualHelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();

  return (
    <div className="relative inline-flex items-center gap-1.5">
      {children}
      <button
        type="button"
        aria-describedby={isOpen ? tooltipId : undefined}
        onClick={() => setIsOpen((prev) => !prev)}
        onMouseEnter={() => setIsOpen(true)}
        onMouseLeave={() => setIsOpen(false)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-slate-300 hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500"
      >
        <span aria-hidden="true">?</span>
        <span className="sr-only">Help information for {title}</span>
      </button>

      {isOpen && (
        <div
          id={tooltipId}
          role="tooltip"
          className="absolute bottom-full left-1/2 mb-2 w-64 -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900 p-3 shadow-xl z-50 text-xs text-slate-200"
        >
          <div className="font-semibold text-slate-100 mb-1">{title}</div>
          <p className="leading-relaxed text-slate-300">{content}</p>
          {docLink && (
            <a
              href={docLink}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block font-medium text-indigo-400 hover:underline"
            >
              Learn more in docs →
            </a>
          )}
        </div>
      )}
    </div>
  );
}
```

---

### 2. Transaction Status Toast Component (`TransactionStatusToast.tsx`)

```tsx
"use client";

import React from "react";

export type TxStep =
  | "idle"
  | "preparing"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

interface TransactionStatusToastProps {
  step: TxStep;
  txSignature?: string;
  errorMessage?: string;
  onRetry?: () => void;
  onClose?: () => void;
}

export function TransactionStatusToast({
  step,
  txSignature,
  errorMessage,
  onRetry,
  onClose,
}: TransactionStatusToastProps) {
  if (step === "idle") return null;

  const explorerUrl = txSignature
    ? `https://solscan.io/tx/${txSignature}?cluster=mainnet`
    : null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-5 right-5 z-50 flex w-96 flex-col gap-2 rounded-xl border border-slate-800 bg-slate-950/95 p-4 shadow-2xl backdrop-blur-md text-sm text-slate-100"
    >
      <div className="flex items-center justify-between">
        <span className="font-semibold text-base">
          {step === "preparing" && "⚙️ Preparing Transaction..."}
          {step === "signing" && "✍️ Waiting for Signature..."}
          {step === "submitting" && "🚀 Submitting to Network..."}
          {step === "confirming" && "⏳ Confirming on Blockchain..."}
          {step === "success" && "🎉 Transaction Confirmed!"}
          {step === "error" && "❌ Transaction Failed"}
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-xs"
          >
            ✕
          </button>
        )}
      </div>

      <p className="text-xs text-slate-400">
        {step === "preparing" &&
          "Simulating instruction outcomes and estimating priority fees."}
        {step === "signing" &&
          "Please review and confirm the action inside your wallet extension."}
        {step === "submitting" &&
          "Broadcasting transaction payload to RPC validator nodes."}
        {step === "confirming" && "Awaiting network consensus block inclusion."}
        {step === "success" &&
          "Your transaction has been successfully included on-chain."}
        {step === "error" &&
          (errorMessage || "An unexpected error occurred during execution.")}
      </p>

      {explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-indigo-400 hover:underline flex items-center gap-1"
        >
          View on Solscan Explorer ↗
        </a>
      )}

      {step === "error" && onRetry && (
        <button
          onClick={onRetry}
          className="mt-1 w-full rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}
```

---

## Action Button Microcopy Rules

1. **State the Specific Action**: Never use vague button text like `"Submit"` or `"Go"`. Use `"Deposit 100.00 USDC"`, `"Confirm Swap"`, `"Stake 5.00 SOL"`.
2. **Disable & Show Spinner During Execution**: Disable buttons while in `preparing`, `signing`, `submitting`, or `confirming` states to prevent double submission.
3. **Show Insufficient Gas State Promptly**: If wallet native balance is below estimated fees, change button copy to `"Insufficient SOL for Fees"` and disable action.
