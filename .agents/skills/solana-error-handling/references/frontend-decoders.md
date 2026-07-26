# Solana Frontend Error Decoders & Custom React Hooks

This reference provides production-ready TypeScript error decoding functions and custom React hooks for Solana dApps.

---

## 1. Unified Solana Error Resolver Engine

```typescript
import { AnchorError } from "@coral-xyz/anchor";

export interface ParsedErrorResult {
  layer: "wallet" | "anchor" | "spl" | "system" | "rpc" | "unknown";
  code: string | number;
  title: string;
  message: string;
  actionableStep?: string;
  isUserCancellation: boolean;
  rawError: unknown;
  logs?: string[];
}

/**
 * Main entrypoint for resolving any error thrown during Solana transaction processing.
 */
export function resolveSolanaError(err: unknown): ParsedErrorResult {
  if (!err) {
    return createUnknownError(err);
  }

  // 1. Check for User Wallet Rejection (Code 4001)
  if (isWalletCancellation(err)) {
    return {
      layer: "wallet",
      code: 4001,
      title: "Transaction Cancelled",
      message: "You cancelled the transaction request in your wallet.",
      isUserCancellation: true,
      rawError: err,
    };
  }

  // 2. Check for Anchor IDL Parsed Error
  const anchorParsed = tryParseAnchorError(err);
  if (anchorParsed) {
    return anchorParsed;
  }

  // 3. Extract Logs if available (SendTransactionError / Simulation error)
  const logs = extractErrorLogs(err);
  if (logs.length > 0) {
    const logParsed = parseLogsFallback(logs, err);
    if (logParsed) return logParsed;
  }

  // 4. Check for Common String Matches (Insufficient SOL, Slippage, Blockhash)
  const stringParsed = parseErrorString(err);
  if (stringParsed) return stringParsed;

  return createUnknownError(err);
}

function isWalletCancellation(err: any): boolean {
  if (err?.code === 4001 || err?.name === "UserRejectedRequestError")
    return true;
  const msg = typeof err?.message === "string" ? err.message.toLowerCase() : "";
  return (
    msg.includes("user rejected") ||
    msg.includes("user cancelled") ||
    msg.includes("user denied")
  );
}

function tryParseAnchorError(err: unknown): ParsedErrorResult | null {
  const anchorErr = AnchorError.parse(err as Error);
  if (anchorErr) {
    return {
      layer: "anchor",
      code: anchorErr.error.errorCode.code,
      title: `Program Error: ${anchorErr.error.errorCode.name}`,
      message:
        anchorErr.error.errorMessage || "On-chain program constraint failed.",
      isUserCancellation: false,
      rawError: err,
      logs: anchorErr.logs,
    };
  }
  return null;
}

function extractErrorLogs(err: any): string[] {
  if (Array.isArray(err?.logs)) return err.logs;
  if (Array.isArray(err?.simulationResponse?.logs))
    return err.simulationResponse.logs;
  return [];
}

function parseLogsFallback(
  logs: string[],
  rawError: unknown
): ParsedErrorResult | null {
  for (const log of logs) {
    // System Program Insufficient Lamports
    if (
      log.includes("custom program error: 0x1") ||
      log.includes("Insufficient funds")
    ) {
      return {
        layer: "system",
        code: "0x1",
        title: "Insufficient SOL",
        message:
          "Your wallet does not have enough SOL to cover transaction fees or balance requirements.",
        actionableStep: "Add SOL to your wallet and try again.",
        isUserCancellation: false,
        rawError,
        logs,
      };
    }

    // Anchor Custom Error hex regex
    const hexMatch = log.match(/Custom error: (0x[0-9a-fA-F]+|\d+)/);
    if (hexMatch) {
      const hexStr = hexMatch[1];
      const decCode = hexStr.startsWith("0x")
        ? parseInt(hexStr, 16)
        : parseInt(hexStr, 10);
      return {
        layer: "anchor",
        code: decCode,
        title: `Program Error (${hexStr})`,
        message: `On-chain execution failed with custom error code ${decCode}.`,
        isUserCancellation: false,
        rawError,
        logs,
      };
    }
  }
  return null;
}

function parseErrorString(err: any): ParsedErrorResult | null {
  const msg = String(err?.message || err);

  if (
    msg.includes("BlockheightExceeded") ||
    msg.includes("blockhash not found")
  ) {
    return {
      layer: "rpc",
      code: "EXPIRED_BLOCKHASH",
      title: "Transaction Expired",
      message:
        "The network was slow and the transaction expired before confirmation.",
      actionableStep: "Click retry to send again with a fresh blockhash.",
      isUserCancellation: false,
      rawError: err,
    };
  }

  return null;
}

function createUnknownError(rawError: unknown): ParsedErrorResult {
  const message =
    (rawError as Error)?.message || "An unexpected error occurred.";
  return {
    layer: "unknown",
    code: "UNKNOWN_ERROR",
    title: "Transaction Failed",
    message,
    isUserCancellation: false,
    rawError,
  };
}
```

---

## 2. React Hook: `useTransactionFeedback`

```typescript
import { useState, useCallback } from "react";
import { resolveSolanaError, ParsedErrorResult } from "./resolveSolanaError";

export type TxStage =
  | "idle"
  | "preparing"
  | "signing"
  | "submitting"
  | "confirming"
  | "success"
  | "error";

export function useTransactionFeedback() {
  const [stage, setStage] = useState<TxStage>("idle");
  const [signature, setSignature] = useState<string | null>(null);
  const [errorInfo, setErrorInfo] = useState<ParsedErrorResult | null>(null);

  const reset = useCallback(() => {
    setStage("idle");
    setSignature(null);
    setErrorInfo(null);
  }, []);

  const executeTransaction = useCallback(
    async <T>(
      txFn: (updateStage: (s: TxStage, sig?: string) => void) => Promise<T>
    ): Promise<T | null> => {
      try {
        reset();
        setStage("preparing");

        const result = await txFn((newStage, sig) => {
          setStage(newStage);
          if (sig) setSignature(sig);
        });

        setStage("success");
        return result;
      } catch (err) {
        const parsed = resolveSolanaError(err);
        setErrorInfo(parsed);
        setStage(parsed.isUserCancellation ? "idle" : "error");
        return null;
      }
    },
    [reset]
  );

  return {
    stage,
    signature,
    errorInfo,
    executeTransaction,
    reset,
  };
}
```
