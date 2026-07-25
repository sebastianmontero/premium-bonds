# Solana dApp Error Handling & User Feedback: Deep Research & Best Practices

> **Status**: Complete Primary Source Research  
> **Author**: Senior Staff Solana AI Assistant  
> **Date**: July 2026  
> **Target Audience**: Solana dApp Engineers, Smart Contract Developers, UX Designers  

---

## Executive Summary

Solana transaction processing involves complex asynchronous states, multi-instruction transactions, off-chain RPC node interactions, wallet signature flows, compute budget constraints, and custom on-chain program logic. When errors occur, users are frequently presented with cryptic hex strings (e.g., `Custom(6001)`, `0x1770`), opaque simulation failures (`Transaction simulation failed: Error processing Instruction 0`), or generic red alerts when they simply closed a wallet popup.

This document presents a comprehensive, battle-tested framework for **categorizing, parsing, and surfacing errors in Solana dApps**, alongside UX guidelines for user feedback.

---

## 1. Solana Error Taxonomy & Classification

Errors in a Solana dApp originate from five distinct layers. Correctly categorizing the error layer is prerequisite to providing appropriate user feedback.

```
+-----------------------------------------------------------------------+
|                       1. Wallet & Signer Layer                        |
|  (User Rejection 4001, Wallet Disconnected, Network/Cluster Mismatch) |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                    2. Pre-flight & Simulation Layer                   |
|  (Rent Exemption Fail, Account Not Found, CU Limit Exceeded, Insuff)  |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                    3. RPC & Network Transport Layer                   |
|  (Rate Limit 429, RPC Timeout, Blockhash Expired, Network Congestion) |
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                       4. On-Chain Program Layer                       |
|  (System Program 0x1, SPL Token 0x0-0x17, Anchor Custom 6000+ / 0x1770)|
+-----------------------------------------------------------------------+
                                   |
+-----------------------------------------------------------------------+
|                 5. Post-Confirmation & Sync State Layer               |
|  (Tx Confirmed with meta.err, Indexer Lag, Optimistic Rollback Race)  |
+-----------------------------------------------------------------------+
```

### Layer 1: Wallet & Signer Layer
- **User Rejection (`4001` / `UserRejectedRequestError`)**: The user clicked "Deny" or closed the wallet popup. This is an intentional user choice, **not an application bug**.
- **Wallet Not Connected**: Triggered when a user attempts a transaction without an active wallet session.
- **Cluster/Network Mismatch**: Wallet is configured to Devnet while dApp expects Mainnet-Beta.
- **Hardware Wallet Disconnect / Timeout**: Ledger/hardware wallet locked or timeout during approval.

### Layer 2: Pre-flight & Simulation Layer
- **Account Rent Exemption Failure**: Account creation missing required lamports for rent exemption.
- **Account Not Found / Uninitialized**: Instruction expects an account that does not exist on-chain.
- **Compute Unit (CU) Limit Exceeded**: Transaction requires more CUs than requested (default 200k per instruction).
- **Invalid Account Owner / Authority**: Signer does not match expected authority constraint.

### Layer 3: RPC & Network Transport Layer
- **HTTP 429 Rate Limit**: RPC endpoint throttling requests due to excessive traffic.
- **Blockhash Expired (`SOLANA_ERROR__TRANSACTION__BLOCKHEIGHT_EXCEEDED` / `TransactionExpiredBlockheightExceededError`)**: Transaction was not included in a block before the blockhash reached its valid blockheight limit (~150 blocks, ~60 seconds).
- **RPC Timeout / Dropped Transaction**: Transaction sent via RPC but never reached validator leader.
- **Priority Fee / Network Congestion**: Transaction dropped or deprioritized due to low compute unit price during high cluster load.

### Layer 4: On-Chain Program Layer
- **System Program Errors**:
  - `0x0` (0): Account already in use / initialized.
  - `0x1` (1): Insufficient funds for transaction fee or transfer.
  - `0x2` (2): Invalid instruction data.
- **SPL Token & Token-2022 Errors**:
  - `0x0` (0): Already in use.
  - `0x1` (1): Invalid state.
  - `0x2` (2): Uninitialized account.
  - `0x3` (3): Insufficient funds.
  - `0x4` (4): Mint mismatch.
  - `0x17` (23): Calculation overflow / underflow.
- **Anchor Custom Errors**:
  - Anchor custom error codes start at offset `6000` (`0x1770`).
  - Example: `0x1771` = `6001` = Second custom error defined in `#[error_code]`.

### Layer 5: Post-Confirmation & Sync State Layer
- **Confirmed Execution Failure**: Transaction confirmed on chain, but contains instruction error (`meta.err != null`).
- **Indexer / Read Replica Lag**: Transaction succeeded on chain, but dApp UI queries a stale RPC node before state updates propagate.

---

## 2. Programmatic Error Decoding Pipeline

To transform opaque errors into structured objects, implement a multi-stage decoding pipeline.

```typescript
export interface ParsedSolanaError {
  layer: 'wallet' | 'simulation' | 'rpc' | 'program' | 'unknown';
  code: string | number;
  title: string;
  message: string;
  actionableStep?: string;
  isUserCancellation: boolean;
  rawError: unknown;
  logs?: string[];
  txSignature?: string;
}
```

### 2.1 Anchor Error Decoding (`AnchorError`)
In `@coral-xyz/anchor`, the `AnchorError` class automatically decodes Anchor-defined errors when the IDL is attached to the `Program` instance.

```typescript
import { AnchorError } from "@coral-xyz/anchor";

export function parseAnchorError(err: unknown): ParsedSolanaError | null {
  const anchorErr = AnchorError.parse(err as Error);
  if (anchorErr) {
    return {
      layer: 'program',
      code: anchorErr.error.errorCode.code,
      title: `Program Error: ${anchorErr.error.errorCode.name}`,
      message: anchorErr.error.errorMessage || 'An on-chain program constraint failed.',
      isUserCancellation: false,
      rawError: err,
      logs: anchorErr.logs,
    };
  }
  return null;
}
```

### 2.2 Modern `@solana/errors` and `@solana/kit` Handling
In Solana Web3.js v2 (`@solana/kit` and `@solana/errors`), use `isSolanaError` and specific `SOLANA_ERROR__*` codes:

```typescript
import {
  isSolanaError,
  SOLANA_ERROR__TRANSACTION__BLOCKHEIGHT_EXCEEDED,
  SOLANA_ERROR__RPC__INTEGER_OVERFLOW,
} from "@solana/errors";

export function parseKitError(err: unknown): ParsedSolanaError | null {
  if (isSolanaError(err, SOLANA_ERROR__TRANSACTION__BLOCKHEIGHT_EXCEEDED)) {
    return {
      layer: 'rpc',
      code: 'BLOCKHEIGHT_EXCEEDED',
      title: 'Transaction Expired',
      message: 'The transaction took too long to confirm and expired.',
      actionableStep: 'Please try sending the transaction again.',
      isUserCancellation: false,
      rawError: err,
    };
  }
  
  if (isSolanaError(err)) {
    return {
      layer: 'rpc',
      code: err.code,
      title: 'Solana Protocol Error',
      message: err.message,
      isUserCancellation: false,
      rawError: err,
    };
  }

  return null;
}
```

### 2.3 Wallet Rejection & Standard Error Codes
Wallets implementing the Wallet Standard or Legacy adapter emit error code `4001` or name `UserRejectedRequestError`.

```typescript
export function isUserRejection(err: any): boolean {
  if (!err) return false;
  if (err.code === 4001) return true;
  if (err.name === 'UserRejectedRequestError') return true;
  if (typeof err.message === 'string' && err.message.toLowerCase().includes('user rejected')) return true;
  return false;
}
```

### 2.4 Program Log Regex Parsing (Fallback Decoder)
When standard decoders miss (e.g. missing IDL or raw RPC simulation error string), parse the transaction logs using regular expressions.

```typescript
const ANCHOR_ERROR_REGEX = /Program log: AnchorError thrown in (.*?):(\d+)\. Error Code: (.*?)\. Error Message: (.*?)\./;
const CUSTOM_HEX_REGEX = /Custom error: (0x[0-9a-fA-F]+|\d+)/;
const INSTRUCTION_ERROR_REGEX = /Instruction (\d+) failed: Custom error (0x[0-9a-fA-F]+|\d+)/;

export function parseLogsFallback(logs: string[]): { code: number; message?: string } | null {
  for (const log of logs) {
    const anchorMatch = log.match(ANCHOR_ERROR_REGEX);
    if (anchorMatch) {
      return { code: 6000, message: anchorMatch[4] };
    }
    const customMatch = log.match(CUSTOM_HEX_REGEX) || log.match(INSTRUCTION_ERROR_REGEX);
    if (customMatch) {
      const rawCode = customMatch[1] || customMatch[2];
      const decimalCode = rawCode.startsWith('0x') ? parseInt(rawCode, 16) : parseInt(rawCode, 10);
      return { code: decimalCode };
    }
  }
  return null;
}
```

---

## 3. User Feedback & UX Best Practices Matrix

### 3.1 Tiered Feedback Model

| Error Scenario | User Feedback Pattern | Visual Tone | Toast/Modal Behavior | Example User Message |
| :--- | :--- | :--- | :--- | :--- |
| **User Cancelled (4001)** | Subtle Toast / Silent Reset | Neutral / Gray | Auto-dismiss after 2s, non-blocking | *"Transaction cancelled."* |
| **Insufficient SOL** | Inline Alert or Persistent Toast | Warning / Amber | Actionable button ("Get SOL" / "Faucet") | *"Insufficient SOL for transaction fees. You need at least 0.005 SOL."* |
| **Slippage Exceeded** | Persistent Toast / Form Feedback | Warning / Amber | Actionable setting link ("Adjust Slippage") | *"Price moved beyond your 0.5% slippage tolerance."* |
| **Anchor Custom Error** | Banner / Toast Notification | Error / Red | Clear human explanation from `#[msg]` | *"Your deposit exceeds the maximum allowed pool limit."* |
| **Expired Blockhash** | Retry Toast | Information / Blue | Auto-retry or 1-click "Retry Transaction" | *"Network busy. Retrying with fresh blockhash..."* |
| **RPC Rate Limit (429)** | System Notice | Warning / Amber | Pause auto-refreshes, switch RPC | *"Network connection throttled. Retrying shortly..."* |
| **Uncaught Exception** | Error Modal with Tx Log Accordion | Danger / Red | Copy debug log button + Explorer link | *"Unexpected transaction failure. Copy details for support."* |

---

## 4. Transaction Lifecycle Feedback Workflow

A premium Solana dApp must guide the user through each phase of transaction execution.

```
[Idle] 
  └─► User Clicks Action 
        └─► Phase 1: Validating Inputs & Fetching Blockhash (Loading Spinner)
              └─► Phase 2: Awaiting Wallet Signature (Wallet Toast)
                    ├─► User Rejects (4001) ──► Reset UI & Quiet Toast ("Cancelled")
                    └─► User Signs 
                          └─► Phase 3: Submitting to Solana Cluster (Sending Tx)
                                └─► Phase 4: Confirming Transaction (Polling Commitment)
                                      ├─► Success ──► Green Toast + Solscan Link
                                      └─► Failure ──► Parse Error & Surface Resolution
```

### Key UI Principles for Solana Transactions:
1. **Never Leave the User Guessing**: Update UI status immediately when moving between Signature -> Submission -> Confirmation.
2. **Always Provide Tx Hash Links**: Once a transaction signature is received, display a link to Solana Explorer / Solscan immediately, even while confirming.
3. **Simulate First**: Run simulation in the background before popping up the wallet. If simulation fails, warn the user *before* requesting signature.
4. **Dynamic Compute Budget & Priority Fees**: Automatically attach priority fees during congestion to prevent dropped transactions.

---

## 5. Smart Contract Best Practices (Anchor Rust)

To enable client-side error decoding, on-chain Anchor programs must implement high-quality error definitions.

### Rust Best Practices:
```rust
use anchor_lang::prelude::*;

#[error_code]
pub enum VaultError {
    #[msg("Deposit amount must be greater than zero.")]
    InvalidDepositAmount,

    #[msg("Vault is currently paused by protocol governance.")]
    VaultPaused,

    #[msg("Slippage tolerance exceeded. Expected minimum output not met.")]
    SlippageExceeded,

    #[msg("Operation requires admin signature.")]
    UnauthorizedAdmin,
}
```

- Always include descriptive `#[msg("...")]` strings.
- Use distinct error codes for distinct logical failures (do not reuse a generic `InvalidInput` error for multiple checks).
- Re-export IDL files so frontend clients can resolve custom error codes automatically.

---

## 6. Primary Source References

1. **Solana Web3.js v2 & `@solana/errors`**: [https://solanakit.com](https://solanakit.com)
2. **Anchor Error Handling & IDL Specification**: [https://www.anchor-lang.com/docs/errors](https://www.anchor-lang.com/docs/errors)
3. **Wallet Standard & Standard Error Codes**: [https://github.com/solana-labs/wallet-standard](https://github.com/solana-labs/wallet-standard)
4. **SPL Token Program Error Source (`error.rs`)**: [https://github.com/solana-labs/solana-program-library](https://github.com/solana-labs/solana-program-library)
5. **Anza Agave RPC Error Codes**: [https://solana.com/docs/rpc](https://solana.com/docs/rpc)
