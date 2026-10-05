import { Address, Instruction, KeyPairSigner } from "@solana/kit";
import type {
  PrizePool,
  TicketRegistry,
  ParsedPayoutRegistry,
} from "../../app/lib/bonds-sdk";
import type { CrankConfig } from "./config";
import type { ParsedTransactionError } from "../../app/lib/errors";
import type { ResilientRpcClient } from "../../app/lib/rpc-transport";

// ─── Branded Primitive Types ─────────────────────────────────────────────────

export type PoolId = number & { readonly __brand: unique symbol };
export type DrawCycleId = number & { readonly __brand: unique symbol };
export type UnixTimestamp = bigint & { readonly __brand: unique symbol };
export type Slot = bigint & { readonly __brand: unique symbol };

export function toPoolId(id: number): PoolId {
  return id as PoolId;
}

export function toDrawCycleId(id: number): DrawCycleId {
  if (!Number.isInteger(id) || id < 0) {
    throw new RangeError(
      `Invalid DrawCycleId: ${id}. Must be a non-negative integer.`
    );
  }
  return id as DrawCycleId;
}

export function toUnixTimestamp(ts: bigint | number): UnixTimestamp {
  return BigInt(ts) as UnixTimestamp;
}

export function toSlot(slot: bigint | number): Slot {
  return BigInt(slot) as Slot;
}

export type PriorityFeeTier = "low" | "medium" | "high" | "urgent";

// ─── Branded RandomnessSeed Value Object ──────────────────────────────────────

export type RandomnessSeed = Uint8Array & { readonly __brand: unique symbol };

/**
 * Validates and converts a 32-byte Uint8Array into a branded RandomnessSeed.
 * Performs a defensive copy to prevent exterior array buffer mutations.
 */
export function toRandomnessSeed(bytes: Uint8Array): RandomnessSeed {
  if (bytes.byteLength !== 32) {
    throw new RangeError(
      `Invalid RandomnessSeed length: expected 32 bytes, got ${bytes.byteLength}`
    );
  }
  const copy = new Uint8Array(32);
  copy.set(bytes);
  return copy as RandomnessSeed;
}

/**
 * Parses a 64-character hex string (with or without '0x' prefix) or Uint8Array
 * into a branded RandomnessSeed.
 */
export function parseRandomnessSeed(
  input: string | Uint8Array
): RandomnessSeed {
  if (input instanceof Uint8Array) {
    return toRandomnessSeed(input);
  }
  const cleanHex =
    input.startsWith("0x") || input.startsWith("0X")
      ? input.slice(2).trim()
      : input.trim();

  if (!/^[0-9a-fA-F]{64}$/.test(cleanHex)) {
    throw new TypeError(
      `Invalid RandomnessSeed hex string: expected 64 hex characters (32 bytes), received "${input}"`
    );
  }
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    bytes[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes as RandomnessSeed;
}

/**
 * Generates a cryptographically secure 32-byte RandomnessSeed.
 */
export function generateRandomnessSeed(): RandomnessSeed {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytes as RandomnessSeed;
}

// ─── Discriminated Pool State Snapshot ───────────────────────────────────────

export interface PayoutRegistrySnapshot {
  readonly address: Address;
  readonly account: ParsedPayoutRegistry;
}

export interface BaseSnapshot {
  readonly poolId: PoolId;
  readonly poolAddress: Address;
  readonly pool: PrizePool;
  readonly ticketRegistryAddress: Address;
  readonly ticketRegistry: TicketRegistry;
  readonly currentSlot: bigint;
  readonly currentTimestamp: UnixTimestamp;
  readonly latestPayoutRegistry?: PayoutRegistrySnapshot;
}

export type PoolStateSnapshot =
  | (BaseSnapshot & {
      readonly state: "IDLE";
      readonly nextDrawAt: UnixTimestamp;
    })
  | (BaseSnapshot & {
      readonly state: "POOL_PAUSED";
    })
  | (BaseSnapshot & {
      readonly state: "POOL_CLOSED";
    })
  | (BaseSnapshot & {
      readonly state: "YIELD_HARVEST_READY";
      readonly currentCycleId: DrawCycleId;
    })
  | (BaseSnapshot & {
      readonly state: "PREPARE_BATCHING";
      readonly cycleId: DrawCycleId;
      readonly cursor: number;
      readonly total: number;
    })
  | (BaseSnapshot & {
      readonly state: "VRF_EXPIRED";
      readonly cycleId: DrawCycleId;
      readonly staleRandomness: Address;
      readonly elapsedSlots: bigint;
    })
  | (BaseSnapshot & {
      readonly state: "READY_TO_DRAW";
      readonly cycleId: DrawCycleId;
      readonly randomnessAccount: Address;
      readonly vrfSeedSlot: bigint;
    })
  | (BaseSnapshot & {
      readonly state: "TIMELOCK_WAITING";
      readonly cycleId: DrawCycleId;
      readonly readyAt: UnixTimestamp;
      readonly payoutRegistry?: PayoutRegistrySnapshot;
    })
  | (BaseSnapshot & {
      readonly state: "REINVESTMENT_PENDING";
      readonly cycleId: DrawCycleId;
      readonly payoutRegistry: PayoutRegistrySnapshot;
      readonly unprocessedWinners: { winner: Address; winnerIndex: number }[];
    })
  | (BaseSnapshot & {
      readonly state: "CIRCUIT_BREAKER_HALTED";
      readonly reason: CircuitBreakerHaltReason;
    });

export type CircuitBreakerHaltReason = "HaltedInsolvent" | "HaltedYieldSpike";

// ─── Strategy Decision & Context Interfaces ──────────────────────────────────

export interface CrankDecision {
  readonly shouldExecute: boolean;
  readonly reason: string;
  readonly priorityFeeTier?: PriorityFeeTier;
}

export interface CrankExecutionContext {
  readonly signer: KeyPairSigner;
  readonly rpcUrl: string;
  readonly rpc: ResilientRpcClient;
  readonly config: CrankConfig;
  readonly maxPrepareBatchSize: number;
  readonly maxReinvestBatchSize: number;
  readonly enableAutoDisburse: boolean;
  readonly dryRun: boolean;
  readonly jitoEnabled?: boolean;
}

export type WorkerDeferredOutcome =
  | {
      readonly status: "CONCURRENCY_RACE_LOST";
      readonly reason: string;
    }
  | {
      readonly status: "VENUE_LIQUIDITY_DEFICIT";
      readonly reason: string;
      readonly code?: number;
      readonly logs?: readonly string[];
    };

export type WorkerExecutionOutcome =
  | {
      readonly status: "EXECUTED";
      readonly signature: string;
      readonly computeUnitsUsed?: number;
    }
  | WorkerDeferredOutcome
  | {
      readonly status: "ERROR";
      readonly reason: string;
      readonly parsedError?: ParsedTransactionError;
      readonly error?: Error;
      readonly logs?: readonly string[];
    };

export function isDeferredOutcome(
  outcome: WorkerExecutionOutcome
): outcome is WorkerDeferredOutcome {
  return (
    outcome.status === "CONCURRENCY_RACE_LOST" ||
    outcome.status === "VENUE_LIQUIDITY_DEFICIT"
  );
}

export interface WorkerExecutionResult {
  readonly workerName: string;
  readonly outcome: WorkerExecutionOutcome;
  readonly executed: boolean;
  readonly reason: string;
  readonly signature?: string;
  readonly computeUnitsUsed?: number;
  readonly error?: Error;
}

export interface CrankTaskAction {
  readonly shouldExecute: true;
  readonly reason: string;
  readonly instructions: readonly Instruction[];
  readonly computeUnitLimit: number;
  readonly priorityFeeTier?: PriorityFeeTier;
  readonly writableAccounts?: readonly Address[];
  readonly additionalSigners?: readonly KeyPairSigner[];
  readonly retryAfterMs?: number;
}

export interface CrankTaskNoAction {
  readonly shouldExecute: false;
  readonly reason: string;
  readonly retryAfterMs?: number;
}

export type CrankTaskOutcome = CrankTaskAction | CrankTaskNoAction;

export interface ExecuteInstructionsParams {
  readonly workerName: string;
  readonly instructions: readonly Instruction[];
  readonly signer: KeyPairSigner;
  readonly computeUnits: number;
  readonly priorityFeeTier?: PriorityFeeTier;
  readonly writableAccounts?: readonly Address[];
  readonly additionalSigners?: readonly KeyPairSigner[];
}

export interface ICrankTask {
  readonly name: string;
  canHandle(snapshot: PoolStateSnapshot): boolean;
  evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome>;
  onSuccess?(poolId: number, signature?: string): void | Promise<void>;
  onDeferred?(
    poolId: number,
    outcome: WorkerDeferredOutcome
  ): void | Promise<void>;
  onError?(poolId: number, error: unknown): void | Promise<void>;
}

export interface ICrankWorker<
  TSnapshot extends PoolStateSnapshot = PoolStateSnapshot,
> {
  readonly name: string;
  readonly targetState: TSnapshot["state"];
  evaluate(snapshot: TSnapshot, context: CrankExecutionContext): CrankDecision;
  buildInstructions(
    snapshot: TSnapshot,
    context: CrankExecutionContext
  ): Promise<Instruction[]>;
  getComputeUnitLimit(snapshot: TSnapshot): number;
}
