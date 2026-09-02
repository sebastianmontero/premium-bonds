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

export interface HeliusTransactionPayload {
  description?: string;
  type?: string;
  source?: string;
  fee?: number;
  feePayer?: Address | string;
  signature: string;
  slot: number;
  timestamp: number;
  nativeTransfers?: unknown[];
  tokenTransfers?: unknown[];
  accountData?: Array<string | { account?: string; [key: string]: unknown }>;
  instructions?: unknown[];
  transactionError?: unknown | null;
  err?: unknown | null;
  logs?: string[];
  meta?: HeliusTransactionMeta | null;
}

export type HeliusWebhookEvent =
  | HeliusTransactionPayload
  | HeliusTransactionPayload[];

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
