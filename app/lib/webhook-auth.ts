import crypto from "crypto";
import type { HeliusTransactionPayload } from "./types/webhook";

/**
 * Validates the Authorization header against the expected secret using timing-safe comparison.
 */
export function isTimingSafeAuthorized(
  authHeader: string | null | undefined,
  expectedSecret: string
): boolean {
  if (!authHeader || !expectedSecret) return false;
  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7)
    : authHeader;
  if (token.length !== expectedSecret.length) return false;
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expectedSecret)
  );
}

/**
 * Checks if a transaction payload from Helius or a relayer represents a valid, non-reverted transaction.
 */
export function isSuccessfulHeliusTransaction(
  tx: HeliusTransactionPayload | null | undefined
): tx is HeliusTransactionPayload & { signature: string } {
  if (!tx || typeof tx.signature !== "string" || tx.signature.length === 0) {
    return false;
  }
  if (tx.err != null || tx.transactionError != null) {
    return false;
  }
  if (tx.meta && tx.meta.err != null) {
    return false;
  }
  return true;
}
