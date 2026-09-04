"use client";

import { useState, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { signature as toSignature } from "@solana/kit";
import {
  parseTransactionError,
  ParsedTransactionError,
  TransactionError,
} from "@/app/lib/errors";
import { pollSignatureConfirmation } from "@/app/lib/transaction-poller";
import type { TransactionStage } from "@/app/components/dashboard/TransactionProgressModal";

export function useTransactionRunner() {
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const [stage, setStage] = useState<TransactionStage>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<ParsedTransactionError | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const lastExecutionRef = useRef<{
    txFn: () => Promise<string | undefined>;
    onSuccess?: (sig?: string) => void;
  } | null>(null);

  const runTransaction = useCallback(
    async (
      txFn: () => Promise<string | undefined>,
      onSuccess?: (sig?: string) => void
    ) => {
      lastExecutionRef.current = { txFn, onSuccess };
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setStage("signing");
      setError(null);
      setTxSignature(null);

      try {
        const capturedSig = await txFn();
        if (!capturedSig) {
          throw new DOMException(
            "Transaction signature not returned",
            "AbortError"
          );
        }

        setTxSignature(capturedSig);
        setStage("broadcasting");
        setStage("confirming");

        await pollSignatureConfirmation(rpc, toSignature(capturedSig), {
          timeoutMs: 60_000,
          abortSignal: abortController.signal,
        });

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
