"use client";

import { useState, useCallback, useRef } from "react";
import {
  parseTransactionError,
  ParsedTransactionError,
  TransactionError,
} from "@/app/lib/errors";
import { notifyBalanceUpdate } from "@/app/hooks/useUserTokenBalance";
import { notifyProtocolUpdate } from "@/app/lib/protocol-sync-bus";
import type { TransactionStage } from "@/app/components/dashboard/TransactionProgressModal";

export function useTransactionRunner() {
  const [stage, setStage] = useState<TransactionStage>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<ParsedTransactionError | null>(null);
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
      setStage("signing");
      setError(null);
      setTxSignature(null);
      let capturedSig: string | undefined;

      try {
        capturedSig = await txFn();
        if (capturedSig) {
          setTxSignature(capturedSig);
        }
        setStage("broadcasting");
        await new Promise((resolve) => setTimeout(resolve, 800));
        setStage("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setStage("success");
        notifyBalanceUpdate();

        if (onSuccess) {
          onSuccess(capturedSig);
        }
        return capturedSig;
      } catch (err) {
        const parsed = parseTransactionError(err);
        setError(parsed);

        // Auto-sync if error is caused by draw freeze constraint (code 6007 / AwaitingRandomnessFreeze)
        if (
          parsed.code === 6007 ||
          parsed.message?.includes("AwaitingRandomnessFreeze") ||
          parsed.message?.includes("0x1777")
        ) {
          notifyProtocolUpdate("pool", { reason: "freeze_error_recovery" });
        }

        if (parsed.isCancellation) {
          setStage(null);
        } else {
          setStage("error");
        }
        throw new TransactionError(parsed, err);
      }
    },
    []
  );

  const retry = useCallback(async () => {
    if (!lastExecutionRef.current) return;
    const { txFn, onSuccess } = lastExecutionRef.current;
    return runTransaction(txFn, onSuccess);
  }, [runTransaction]);

  const reset = useCallback(() => {
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
    setError,
    setStage,
  };
}
