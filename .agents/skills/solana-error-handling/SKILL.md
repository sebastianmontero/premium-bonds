---
name: solana-error-handling
description: Best practices playbook and reference guide for handling errors and presenting user feedback in Solana dApps. Use when designing error handling architectures, translating raw hex/Anchor error codes into human-readable user messages, building transaction lifecycle toasts/modals, handling wallet user rejections (4001), setting up `@solana/errors` and `@coral-xyz/anchor` decoders, or defining on-chain `#[error_code]` enums in Rust programs.
user-invocable: true
license: MIT
metadata:
  author: Solana Foundation & Community
  version: 1.0.0
---

# Solana Error Handling & User Feedback Skill

## What this Skill is for

Use this Skill when:
- Designing or auditing error handling architecture in a Solana dApp (React / Next.js).
- Translating raw Solana error codes (`Custom(6001)`, `0x1770`, `0x1`, `4001`, simulation failures) into human-readable user feedback.
- Building transaction lifecycle feedback components (preparing, signing, submitting, confirming, success, error).
- Differentiating between intentional user cancellations (Wallet Error 4001) vs actual system/program failures.
- Setting up error decoders for `@coral-xyz/anchor`, `@solana/kit` / `@solana/errors`, or Codama-generated clients.
- Writing smart contract error enums (`#[error_code]`, `#[msg("...")]`) in Anchor / Rust.

---

## Core Principles

### 1. Never Show Raw Hex or Cryptic Error Codes to Users
Users should **never** see raw errors like `Error processing Instruction 0: custom program error: 0x1771` or `Transaction simulation failed: Error processing Instruction 1`.
Always translate raw codes using Anchor IDLs, `@solana/errors` type guards, or humanized fallback message maps.

### 2. Differentiate User Intent (Wallet Code 4001)
When a user closes the wallet popup or clicks "Deny", the wallet returns error code `4001` or name `UserRejectedRequestError`.
- **Do NOT** display an aggressive red "Transaction Failed!" alert.
- **Do** show a quiet, short-lived neutral toast (e.g. *"Transaction cancelled"*) or simply reset the UI loading state.

### 3. Tiered Feedback Matrix

| Error Category | Visual Style | UX Component | Primary User Message | Actionable Button |
| :--- | :--- | :--- | :--- | :--- |
| **User Cancelled (4001)** | Neutral (Gray) | Short Toast (2s) | *"Transaction cancelled."* | None |
| **Insufficient SOL** | Warning (Amber) | Persistent Alert | *"Insufficient SOL for transaction fees."* | *"Get SOL"* / Faucet |
| **Slippage Tolerance** | Warning (Amber) | Form / Toast | *"Price moved beyond your slippage limit."* | *"Adjust Slippage"* |
| **Anchor Program Custom** | Error (Red) | Toast / Modal | Human message from `#[msg("...")]` | *"Try Again"* |
| **Blockhash Expired** | Info (Blue) | Toast with Spinner | *"Network busy. Retrying with fresh blockhash..."* | *"Retry Now"* |
| **Network Congestion** | Warning (Amber) | Notice Banner | *"High network traffic. Priority fee recommended."* | *"Boost Fee"* |
| **Uncaught / Unknown** | Error (Red) | Modal w/ Details | *"Unexpected transaction failure."* | *"Copy Debug Logs"* |

---

## Transaction Lifecycle State Machine

Surfacing transaction progress reduces user anxiety and prevents duplicate transaction submissions.

```
       [IDLE]
         │ (User clicks action)
         ▼
 ┌────────────────┐
 │ 1. PREPARING   │ ──► Building transaction, fetching recent blockhash, simulating.
 └───────┬────────┘
         │
         ▼
 ┌────────────────┐
 │ 2. SIGNING     │ ──► Prompting wallet signature.
 └───────┬────────┘
         ├─── (User Denies / 4001) ──► Quiet Toast & Return to IDLE
         │
         ▼
 ┌────────────────┐
 │ 3. SUBMITTING  │ ──► Transaction signed; broadcasting to RPC nodes.
 └───────┬────────┘
         │
         ▼
 ┌────────────────┐
 │ 4. CONFIRMING  │ ──► Polling RPC commitment status (show Solscan link!).
 └───────┬────────┘
         ├───────────────┬───────────────┐
         ▼               ▼               ▼
   [CONFIRMED]     [SIM ERROR]     [TIMEOUT / EXPIRED]
   Success Toast   Decode IDL      Auto-retry w/ fresh
   + Solscan link  & Red Toast     blockhash or alert
```

---

## Decoding Pipeline Quick Reference

### Anchor Error Decoding
```typescript
import { AnchorError } from "@coral-xyz/anchor";

try {
  await program.methods.myInstruction().rpc();
} catch (err) {
  const anchorErr = AnchorError.parse(err as Error);
  if (anchorErr) {
    console.log("Error Name:", anchorErr.error.errorCode.name);
    console.log("Error Message:", anchorErr.error.errorMessage);
    showErrorToast(anchorErr.error.errorMessage);
    return;
  }
  // Fall back to general decoder
}
```

### Modern `@solana/errors` Decoding
```typescript
import { isSolanaError, SOLANA_ERROR__TRANSACTION__BLOCKHEIGHT_EXCEEDED } from '@solana/errors';

try {
  await sendAndConfirmTransaction(tx);
} catch (err) {
  if (isSolanaError(err, SOLANA_ERROR__TRANSACTION__BLOCKHEIGHT_EXCEEDED)) {
    showInfoToast("Transaction expired due to network congestion. Retrying...");
  } else if (isSolanaError(err)) {
    showErrorToast(`Solana network error: ${err.message}`);
  }
}
```

---

## Reference Guides (Progressive Disclosure)

Read these detailed guides when implementing error handling:

- **Error Taxonomy & Error Codes**: [references/error-taxonomy.md](references/error-taxonomy.md) — System Program, SPL Token, Anchor 6000+, Wallet 4001.
- **Frontend Decoders & Hooks**: [references/frontend-decoders.md](references/frontend-decoders.md) — Complete TypeScript decoding engine & `useSolanaErrorResolver` React hook.
- **UX Feedback & Toast Patterns**: [references/ux-feedback-patterns.md](references/ux-feedback-patterns.md) — Toast component guidelines, Solscan deep links, optimistic updates.
- **Smart Contract Error Design**: [references/anchor-error-design.md](references/anchor-error-design.md) — Rust `#[error_code]` enums, `#[msg]` attributes, and IDL setup.
