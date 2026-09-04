import {
  type Rpc,
  type GetSignatureStatusesApi,
  type Signature,
} from "@solana/kit";
import { parseTransactionError, TransactionError } from "./errors";

export interface PollOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  abortSignal?: AbortSignal;
}

export async function pollSignatureConfirmation(
  rpc: Rpc<GetSignatureStatusesApi>,
  signature: Signature,
  options: PollOptions = {}
): Promise<void> {
  const startTime = Date.now();
  const timeoutMs = options.timeoutMs ?? 60_000;
  let delay = options.initialDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 4000;

  while (Date.now() - startTime < timeoutMs) {
    if (options.abortSignal?.aborted) {
      throw new DOMException("Transaction cancelled or aborted", "AbortError");
    }

    try {
      const res = await rpc.getSignatureStatuses([signature]).send();
      const status = res.value[0];

      if (status) {
        if (status.err) {
          const parsed = parseTransactionError(status.err);
          throw new TransactionError(parsed, status.err);
        }
        if (
          status.confirmationStatus === "confirmed" ||
          status.confirmationStatus === "finalized"
        ) {
          return;
        }
      }
    } catch (err: unknown) {
      const errorRecord = err as Record<string, unknown> | null;
      if (
        err instanceof TransactionError ||
        errorRecord?.name === "AbortError"
      ) {
        throw err;
      }
      // Non-fatal: transient network error during polling, continue until timeout
    }

    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.3, maxDelay);
  }

  throw new Error("Transaction confirmation timed out after 60 seconds");
}
