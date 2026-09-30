"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { signature as toSignature } from "@solana/kit";
import {
  parseTransactionError,
  ParsedTransactionError,
  TransactionError,
} from "@/app/lib/errors";
import { pollSignatureConfirmation } from "@/app/lib/transaction-poller";
import type { TransactionStage } from "@/app/components/dashboard/TransactionProgressModal";

export const MOCK_TX_PREFIX = "DEMO_TX_";
const BROADCAST_MIN_DISPLAY_MS = 300;
const CONFIRMING_MIN_DISPLAY_MS = 200;

export interface TransactionLifecycleReporter {
  /** Notify the runner that instruction building & validation succeeded and wallet signing has started */
  onSigning: () => void;
}

export type TransactionRunnerFn = (
  reporter: TransactionLifecycleReporter
) => Promise<string | undefined>;

export function delayWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function useTransactionRunner() {
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const [stage, setStage] = useState<TransactionStage>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<ParsedTransactionError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastExecutionRef = useRef<{
    txFn: TransactionRunnerFn;
    onSuccess?: (sig?: string) => void;
  } | null>(null);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const runTransaction = useCallback(
    async (txFn: TransactionRunnerFn, onSuccess?: (sig?: string) => void) => {
      lastExecutionRef.current = { txFn, onSuccess };
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setStage("preparing");
      setError(null);
      setTxSignature(null);

      try {
        let signingReported = false;
        const capturedSig = await txFn({
          onSigning: () => {
            if (!abortController.signal.aborted && !signingReported) {
              signingReported = true;
              setStage("signing");
            }
          },
        });

        if (!capturedSig) {
          throw new DOMException(
            "Transaction signature not returned",
            "AbortError"
          );
        }

        setTxSignature(capturedSig);
        setStage("broadcasting");

        // 1. Start polling or simulated delay (concurrent execution)
        const isMock = capturedSig.startsWith(MOCK_TX_PREFIX);
        const pollPromise = isMock
          ? delayWithAbort(400, abortController.signal)
          : pollSignatureConfirmation(rpc, toSignature(capturedSig), {
              timeoutMs: 60_000,
              abortSignal: abortController.signal,
            });

        // 2. Race broadcast visual pacing against early polling rejection
        const earlyRejectionPromise = new Promise<never>((_, reject) => {
          pollPromise.catch(reject);
        });
        await Promise.race([
          delayWithAbort(BROADCAST_MIN_DISPLAY_MS, abortController.signal),
          earlyRejectionPromise,
        ]);

        if (abortController.signal.aborted) {
          throw new DOMException("Transaction aborted", "AbortError");
        }

        // 3. Transition to "confirming" (only reached if broadcast succeeded)
        const confirmingStartTime = Date.now();
        setStage("confirming");
        await pollPromise;

        // 4. Dynamic minimum dwell time: only wait if confirmation was instant
        const elapsed = Date.now() - confirmingStartTime;
        const remainingDwell = Math.max(0, CONFIRMING_MIN_DISPLAY_MS - elapsed);
        if (remainingDwell > 0) {
          await delayWithAbort(remainingDwell, abortController.signal);
        }

        if (abortController.signal.aborted) {
          throw new DOMException("Transaction aborted", "AbortError");
        }

        setStage("success");
        if (onSuccess) onSuccess(capturedSig);
        return capturedSig;
      } catch (err: unknown) {
        const errorRecord = err as Record<string, unknown> | null;
        if (
          abortController.signal.aborted ||
          errorRecord?.name === "AbortError"
        ) {
          setStage(null);
          throw err;
        }
        const parsed = parseTransactionError(err);
        setError(parsed);
        setStage(parsed.isCancellation ? null : "error");
        throw new TransactionError(parsed, err);
      }
    },
    [rpc]
  );

  const retry = useCallback(async () => {
    if (!lastExecutionRef.current) return;
    const { txFn, onSuccess } = lastExecutionRef.current;
    return runTransaction(txFn, onSuccess);
  }, [runTransaction]);

  const reset = useCallback(() => {
    abortControllerRef.current?.abort();
    setStage(null);
    setTxSignature(null);
    setError(null);
    lastExecutionRef.current = null;
  }, []);

  return {
    stage,
    txSignature,
    error,
    runTransaction,
    retry,
    reset,
    setStage,
    setError,
  };
}
