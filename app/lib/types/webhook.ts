import type { Address } from "@solana/kit";

export interface HeliusInnerInstruction {
  programId: Address | string;
  data: string | Uint8Array;
  accounts?: (Address | string)[];
}

export interface HeliusInnerInstructionSet {
  index: number;
  instructions: HeliusInnerInstruction[];
}

export interface HeliusTransactionMeta {
  err: unknown | null;
  fee?: number;
  preBalances?: number[];
  postBalances?: number[];
  logMessages?: string[];
  innerInstructions?: HeliusInnerInstructionSet[];
  accountKeys?: (Address | string)[];
  loadedAddresses?: {
    readonly?: (Address | string)[];
    writable?: (Address | string)[];
  };
}

export interface RawSolanaTransactionPayload {
  slot?: number;
  blockTime?: number | null;
  timestamp?: number;
  err?: unknown | null;
  transactionError?: unknown | null;
  signature?: string;
  signatures?: string[];
  transaction?: {
    signatures?: string[];
    message?: {
      accountKeys?: (Address | string | { pubkey: string })[];
      instructions?: unknown[];
    };
  };
  instructions?: unknown[];
  type?: string;
  description?: string;
  source?: string;
  fee?: number;
  feePayer?: Address | string;
  nativeTransfers?: unknown[];
  tokenTransfers?: unknown[];
  accountData?: Array<string | { account?: string; [key: string]: unknown }>;
  logs?: string[];
  meta: HeliusTransactionMeta | null;
}

export type HeliusTransactionPayload = RawSolanaTransactionPayload;

export type HeliusWebhookEvent =
  | RawSolanaTransactionPayload
  | RawSolanaTransactionPayload[];

/**
 * Extracts primary signature from canonical Solana RPC or relayer payload.
 */
export function extractTransactionSignature(
  tx: RawSolanaTransactionPayload | Record<string, unknown>
): string | null {
  if (typeof tx.signature === "string" && tx.signature.length > 0) {
    return tx.signature;
  }
  if (
    tx.transaction &&
    typeof tx.transaction === "object" &&
    Array.isArray((tx.transaction as { signatures?: string[] }).signatures)
  ) {
    const firstSig = (tx.transaction as { signatures: string[] }).signatures[0];
    if (typeof firstSig === "string" && firstSig.length > 0) return firstSig;
  }
  if (Array.isArray(tx.signatures) && typeof tx.signatures[0] === "string" && tx.signatures[0].length > 0) {
    return tx.signatures[0];
  }
  return null;
}

/**
 * Extracts all unique account keys across transaction message, metadata, loaded addresses, and accountData.
 */
export function extractTransactionAccountKeys(
  tx: RawSolanaTransactionPayload | Record<string, unknown>
): string[] {
  const keys = new Set<string>();
  const raw = tx as RawSolanaTransactionPayload;

  // 1. Transaction message account keys (Standard Solana RPC / Raw Webhook format)
  if (Array.isArray(raw.transaction?.message?.accountKeys)) {
    for (const k of raw.transaction.message.accountKeys) {
      if (typeof k === "string") keys.add(k);
      else if (
        k &&
        typeof k === "object" &&
        "pubkey" in k &&
        typeof k.pubkey === "string"
      ) {
        keys.add(k.pubkey);
      }
    }
  }

  // 2. Meta account keys (Local relayer & simulated RPC format)
  if (Array.isArray(raw.meta?.accountKeys)) {
    for (const k of raw.meta.accountKeys) {
      if (k) keys.add(k.toString());
    }
  }

  // 3. Meta loaded addresses (Versioned Transactions / Address Lookup Tables)
  if (raw.meta?.loadedAddresses) {
    for (const k of raw.meta.loadedAddresses.writable || []) {
      if (k) keys.add(k.toString());
    }
    for (const k of raw.meta.loadedAddresses.readonly || []) {
      if (k) keys.add(k.toString());
    }
  }

  // 4. Enhanced accountData compatibility
  if (Array.isArray(raw.accountData)) {
    for (const item of raw.accountData) {
      if (typeof item === "string") keys.add(item);
      else if (
        item &&
        typeof item === "object" &&
        "account" in item &&
        typeof item.account === "string"
      ) {
        keys.add(item.account);
      }
    }
  }

  return Array.from(keys);
}

/**
 * Returns true if the payload has markers of Helius Enhanced format (stripped meta/logs).
 */
export function isEnhancedWebhookPayload(tx: unknown): boolean {
  if (!tx || typeof tx !== "object") return false;
  const t = tx as Record<string, unknown>;
  return (
    !t.meta &&
    Boolean(
      t.instructions ||
      t.type ||
      t.tokenTransfers ||
      t.nativeTransfers ||
      t.accountData
    )
  );
}

/**
 * Type predicate that asserts a raw transaction has valid signature and metadata and is not reverted.
 */
export function isValidRawSolanaTransaction(
  tx: unknown
): tx is RawSolanaTransactionPayload & { meta: HeliusTransactionMeta } {
  if (!tx || typeof tx !== "object") return false;
  const t = tx as RawSolanaTransactionPayload;
  const sig = extractTransactionSignature(t);
  if (!sig) return false;
  if (t.err != null || t.transactionError != null) return false;
  if (!t.meta || t.meta.err != null) return false;
  return true;
}

export interface WebhookRelayerConfig {
  rpcUrl: string;
  programId: Address | string;
  webhookUrl: string;
  webhookSecret: string;
  pollIntervalMs: number;
  batchSize: number;
  network: string;
  dbName?: string;
  fromGenesis?: boolean;
  once?: boolean;
  quiet?: boolean;
}
