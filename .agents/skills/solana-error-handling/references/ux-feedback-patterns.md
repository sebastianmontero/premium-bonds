# Solana UX Feedback & Toast Patterns

This document defines UI design patterns, notification rules, transaction lifecycle progress indicators, and explorer deep link guidelines for Solana dApps.

---

## 1. Toast Notification Guidelines

### Rule 1: Quiet Handle User Rejections (4001)
When `isUserCancellation` is `true`:
- **Do NOT** trigger a large red toast notification with error sounds or flashing borders.
- Show a brief gray/neutral toast (duration: 2000ms): *"Transaction cancelled by user."* or simply clear the loading state.

### Rule 2: Actionable Error Toasts
When an error requires user action (e.g. Insufficient SOL or Slippage):
- Include a clear human title and explanation.
- Add an explicit call-to-action button inside the toast component.

```tsx
// Example using standard React Toast library (e.g. Sonner)
toast.error("Insufficient SOL for Gas", {
  description: "You need ~0.005 SOL to pay for account creation and network fees.",
  action: {
    label: "Get SOL",
    onClick: () => openFaucetOrBuyModal(),
  },
  duration: 8000,
});
```

---

## 2. Block Explorer Links & Signature Formatting

Always surface transaction signatures as soon as they are available, even while confirmation is pending.

### Explorer URL Builders:
```typescript
export function getExplorerUrl(
  signature: string,
  cluster: 'mainnet-beta' | 'devnet' | 'localnet' = 'devnet',
  provider: 'solscan' | 'solana-explorer' = 'solscan'
): string {
  const clusterSuffix = cluster === 'mainnet-beta' ? '' : `?cluster=${cluster}`;
  
  if (provider === 'solscan') {
    return `https://solscan.io/tx/${signature}${clusterSuffix}`;
  }
  return `https://explorer.solana.com/tx/${signature}${clusterSuffix}`;
}

export function truncateSignature(signature: string): string {
  if (!signature) return '';
  return `${signature.slice(0, 4)}...${signature.slice(-4)}`;
}
```

---

## 3. Transaction Progress UI Component Pattern

```tsx
import React from 'react';

interface TxProgressModalProps {
  stage: 'idle' | 'preparing' | 'signing' | 'submitting' | 'confirming' | 'success' | 'error';
  signature?: string | null;
  errorMessage?: string | null;
  onClose: () => void;
}

export const TxProgressModal: React.FC<TxProgressModalProps> = ({
  stage,
  signature,
  errorMessage,
  onClose,
}) => {
  if (stage === 'idle') return null;

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 max-w-md w-full text-white shadow-2xl">
        <h3 className="text-lg font-semibold mb-4">
          {stage === 'preparing' && 'Preparing Transaction...'}
          {stage === 'signing' && 'Approve in Wallet'}
          {stage === 'submitting' && 'Broadcasting to Solana...'}
          {stage === 'confirming' && 'Confirming on Chain...'}
          {stage === 'success' && 'Transaction Confirmed! 🎉'}
          {stage === 'error' && 'Transaction Failed ❌'}
        </h3>

        {signature && (
          <div className="mb-4 text-xs font-mono bg-slate-950 p-2 rounded flex justify-between items-center">
            <span className="text-slate-400">Tx Hash:</span>
            <a
              href={`https://solscan.io/tx/${signature}?cluster=devnet`}
              target="_blank"
              rel="noreferrer"
              className="text-indigo-400 hover:underline"
            >
              {signature.slice(0, 6)}...{signature.slice(-6)} ↗
            </a>
          </div>
        )}

        {errorMessage && (
          <div className="p-3 bg-red-950/50 border border-red-800 rounded text-red-200 text-sm mb-4">
            {errorMessage}
          </div>
        )}

        <div className="flex justify-end mt-4">
          {(stage === 'success' || stage === 'error') && (
            <button
              onClick={onClose}
              className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 rounded font-medium text-sm text-white"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
```
