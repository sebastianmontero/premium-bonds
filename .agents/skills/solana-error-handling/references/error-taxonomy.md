# Solana Error Taxonomy & Error Codes Reference

This document provides a comprehensive mapping of error codes across Solana wallet standard adapters, System Program, SPL Token Program, Anchor framework, and network transport RPC errors.

---

## 1. Wallet & Signer Error Codes

| Code   | Standard Name              | Meaning                                                                | Recommended Action                                            |
| :----- | :------------------------- | :--------------------------------------------------------------------- | :------------------------------------------------------------ |
| `4001` | `UserRejectedRequestError` | User clicked "Deny" or closed the wallet approval modal.               | Quiet toast or silent UI reset. Do not show red error banner. |
| `4100` | `UnauthorizedError`        | The requested method/account is not authorized by the wallet.          | Request wallet connection (`connect()`).                      |
| `4200` | `UnsupportedMethodError`   | Wallet does not support requested method (e.g. `signAllTransactions`). | Fall back to sequential `signTransaction()`.                  |
| `4900` | `DisconnectedError`        | Wallet disconnected from dApp session.                                 | Prompt user to reconnect wallet.                              |
| `4901` | `ChainDisconnectedError`   | Wallet lost connection to RPC node / cluster.                          | Alert user to check wallet network settings.                  |

---

## 2. System Program Error Codes

System Program error codes are returned in hexadecimal (`0x0`, `0x1`, `0x2`) in transaction simulation logs.

| Hex Code | Decimal | Rust Enum Variant                                  | Cause                                               | User-Friendly Message                                 |
| :------- | :------ | :------------------------------------------------- | :-------------------------------------------------- | :---------------------------------------------------- |
| `0x0`    | `0`     | `AccountAlreadyInUse`                              | Account already created or initialized.             | _"Account already exists."_                           |
| `0x1`    | `1`     | `ResultWithNegativeLamports` / `InsufficientFunds` | Account lacks SOL for transfer or fee payment.      | _"Insufficient SOL balance to complete transaction."_ |
| `0x2`    | `2`     | `InvalidInstructionData`                           | Data payload passed to System Program is malformed. | _"Invalid instruction parameters."_                   |
| `0x3`    | `3`     | `InvalidArgument`                                  | Invalid account parameter passed.                   | _"Invalid account argument."_                         |

---

## 3. SPL Token & Token-2022 Error Codes

SPL Token program errors are returned as custom program errors (`0x0` through `0x1e`).

| Hex Code | Decimal | Name                 | Cause                                             | User-Friendly Message                             |
| :------- | :------ | :------------------- | :------------------------------------------------ | :------------------------------------------------ |
| `0x0`    | `0`     | `AlreadyInUse`       | Token account already initialized.                | _"Token account already exists."_                 |
| `0x1`    | `1`     | `InvalidState`       | Token account or mint in invalid state.           | _"Token account state is invalid."_               |
| `0x2`    | `2`     | `UninitializedState` | Token account not initialized.                    | _"Token account is not initialized."_             |
| `0x3`    | `3`     | `InsufficientFunds`  | Token account balance lower than transfer amount. | _"Insufficient token balance for this transfer."_ |
| `0x4`    | `4`     | `MintMismatch`       | Provided mint does not match token account.       | _"Token mint mismatch."_                          |
| `0x5`    | `5`     | `UnitializedMint`    | Mint account not initialized.                     | _"Mint account is not initialized."_              |
| `0x17`   | `23`    | `Overflow`           | Mathematical overflow in token calculations.      | _"Token calculation overflow."_                   |

---

## 4. Anchor Custom Error Codes

Anchor program error codes start at base offset **`6000`** (`0x1770` in hex).

| Hex Code | Decimal Code | Anchor Error Type           | Description                                            |
| :------- | :----------- | :-------------------------- | :----------------------------------------------------- |
| `0x1770` | `6000`       | Anchor Internal Base Offset | First custom program error defined in Rust.            |
| `0x1771` | `6001`       | Second Custom Error         | Defined as the second variant in `#[error_code]` enum. |
| `0xbc2`  | `3010`       | `AccountNotInitialized`     | Anchor constraint `#[account(init)]` failed.           |
| `0x7d1`  | `2001`       | `ConstraintMut`             | Anchor constraint `#[account(mut)]` failed.            |
| `0x7d3`  | `2003`       | `ConstraintHasOne`          | Anchor constraint `has_one` failed.                    |
| `0x7d6`  | `2006`       | `ConstraintSeeds`           | PDA seed constraint mismatch.                          |
| `0x7d8`  | `2008`       | `ConstraintSigner`          | Required account did not sign transaction.             |

---

## 5. Network & Transport RPC Error Codes

| Error Identifier                                  | Source           | Trigger Scenario                                  | UX Remediation                                 |
| :------------------------------------------------ | :--------------- | :------------------------------------------------ | :--------------------------------------------- |
| `SOLANA_ERROR__TRANSACTION__BLOCKHEIGHT_EXCEEDED` | `@solana/errors` | Blockhash expired before confirmation (~60s).     | Auto-retry transaction with updated blockhash. |
| `429 Too Many Requests`                           | RPC Node         | Exceeded RPC provider rate limits.                | Switch to secondary RPC URL or pause polling.  |
| `Transaction simulation failed`                   | RPC Node         | Pre-flight check failed before signing.           | Show parsed error from simulation logs.        |
| `Blockhash not found`                             | RPC Node         | Blockhash missing or invalidated by cluster fork. | Re-fetch recent blockhash and re-sign.         |
