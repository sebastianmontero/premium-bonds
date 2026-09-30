import type { TransactionRunnerFn } from "@/app/hooks/useTransactionRunner";
import { MOCK_TX_PREFIX } from "@/app/hooks/useTransactionRunner";

export function createMockTransactionFn(delayMs = 1000): TransactionRunnerFn {
  return async ({ onSigning }) => {
    onSigning();
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return MOCK_TX_PREFIX + Math.random().toString(36).slice(2, 10);
  };
}
