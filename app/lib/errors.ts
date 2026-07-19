/**
 * Structured output of a parsed transaction error.
 */
export interface ParsedTransactionError {
  /** True if the user intentionally rejected or cancelled the transaction. */
  isCancellation: boolean;
  /** Human-readable error message or raw error details. */
  message: string;
}

/**
 * Parses transaction errors from `@solana/kit` and wallet-standard adapters
 * to identify user cancellations gracefully and format error messages.
 *
 * @param err - The raw error object caught from a transaction sending process.
 * @returns An object containing whether it was a cancellation, and the parsed message.
 */
export function parseTransactionError(err: unknown): ParsedTransactionError {
  if (!err) {
    return { isCancellation: false, message: "An unknown error occurred" };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const errorObj = err as any;
  const message = errorObj.message || String(err);

  // Helper to check common user rejection phrases
  const isCancelledMessage = (msg: string): boolean => {
    const normalized = msg.toLowerCase();
    return (
      normalized.includes("user rejected") ||
      normalized.includes("user cancelled") ||
      normalized.includes("rejected the request") ||
      normalized.includes("cancellation") ||
      normalized.includes("transaction cancelled") ||
      normalized.includes("declined") ||
      normalized.includes("user declined")
    );
  };

  // 1. Direct message check
  if (isCancelledMessage(message)) {
    return { isCancellation: true, message: "Transaction cancelled by user" };
  }

  // 2. Cause property check (often holds the original error in modern Solana SDK wrappers)
  if (errorObj.cause) {
    const causeMsg = errorObj.cause.message || String(errorObj.cause);
    if (isCancelledMessage(causeMsg)) {
      return { isCancellation: true, message: "Transaction cancelled by user" };
    }
  }

  // 3. transactionPlanResult check (modern Solana Kit transaction plan execution results)
  if (errorObj.transactionPlanResult) {
    try {
      const resultStr = JSON.stringify(errorObj.transactionPlanResult);
      if (isCancelledMessage(resultStr)) {
        return {
          isCancellation: true,
          message: "Transaction cancelled by user",
        };
      }
    } catch {
      // Ignored
    }
  }

  // 4. If it's a plan execution error but not a cancellation, try to extract a meaningful detail
  let details = message;
  if (errorObj.cause?.message) {
    details = errorObj.cause.message;
  } else if (
    message.includes("failed to execute") &&
    errorObj.transactionPlanResult
  ) {
    // If it's the generic "The provided transaction plan failed to execute" message,
    // let's try to extract something more helpful from the plan result.
    const result = errorObj.transactionPlanResult;
    if (result.error) {
      details = String(result.error);
    }
  }

  return {
    isCancellation: false,
    message: details,
  };
}
