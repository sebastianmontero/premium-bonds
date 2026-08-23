"use client";

import { useState, useCallback } from "react";
import {
  parseTransactionError,
  ParsedTransactionError,
  TransactionError,
} from "@/app/lib/errors";
import { notifyBalanceUpdate } from "@/app/hooks/useUserTokenBalance";
import type { TransactionStage } from "@/app/components/dashboard/TransactionProgressModal";

export function useTransactionRunner() {
  const [stage, setStage] = useState<TransactionStage>(null);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<ParsedTransactionError | null>(null);

  const runTransaction = useCallback(
    async (
      txFn: () => Promise<string | undefined>,
      onSuccess?: (sig?: string) => void
    ) => {
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

  const reset = useCallback(() => {
    setStage(null);
    setTxSignature(null);
    setError(null);
  }, []);

  return {
    stage,
    txSignature,
    error,
    runTransaction,
    reset,
    setError,
    setStage,
  };
}
