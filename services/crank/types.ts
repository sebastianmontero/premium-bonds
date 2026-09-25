import { Address, Instruction, TransactionSigner } from "@solana/kit";
import type {
  PrizePool,
  TicketRegistry,
  PayoutRegistry,
} from "../../app/lib/bonds-sdk";
import type { CrankConfig } from "./config";
import type { ParsedTransactionError } from "../../app/lib/errors";

// ─── Branded Primitive Types ─────────────────────────────────────────────────

export type PoolId = number & { readonly __brand: unique symbol };
export type DrawCycleId = number & { readonly __brand: unique symbol };
export type UnixTimestamp = bigint & { readonly __brand: unique symbol };

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

// ─── Discriminated Pool State Snapshot ───────────────────────────────────────

export interface BaseSnapshot {
  readonly poolId: PoolId;
  readonly poolAddress: Address;
  readonly pool: PrizePool;
  readonly ticketRegistryAddress: Address;
  readonly ticketRegistry: TicketRegistry;
  readonly currentSlot: bigint;
  readonly currentTimestamp: UnixTimestamp;
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
      readonly state: "DRAW_SKIPPED";
      readonly cycleId: DrawCycleId;
      readonly reason: string;
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
      readonly harvestSlot: bigint;
    })
  | (BaseSnapshot & {
      readonly state: "TIMELOCK_WAITING";
      readonly cycleId: DrawCycleId;
      readonly readyAt: UnixTimestamp;
    })
  | (BaseSnapshot & {
      readonly state: "REINVESTMENT_PENDING";
      readonly cycleId: DrawCycleId;
      readonly payoutRegistryAddress: Address;
      readonly payoutRegistry: PayoutRegistry;
      readonly unprocessedWinners: { winner: Address; winnerIndex: number }[];
    })
  | (BaseSnapshot & {
      readonly state: "CIRCUIT_BREAKER_HALTED";
      readonly reason: "HaltedInsolvent" | "HaltedYieldSpike" | string;
    });

// ─── Strategy Decision & Context Interfaces ──────────────────────────────────

export interface CrankDecision {
  readonly shouldExecute: boolean;
  readonly reason: string;
  readonly priorityFeeTier?: "low" | "medium" | "high" | "urgent";
}

export interface CrankExecutionContext {
  readonly signer: TransactionSigner;
  readonly rpcUrl: string;
  readonly config: CrankConfig;
  readonly maxPrepareBatchSize: number;
  readonly maxReinvestBatchSize: number;
  readonly enableAutoDisburse: boolean;
  readonly dryRun: boolean;
  readonly jitoEnabled?: boolean;
}

export type WorkerExecutionOutcome =
  | {
      readonly status: "EXECUTED";
      readonly signature: string;
      readonly computeUnitsUsed?: number;
    }
  | {
      readonly status: "CONCURRENCY_RACE_LOST";
      readonly reason: string;
    }
  | {
      readonly status: "ERROR";
      readonly reason: string;
      readonly parsedError?: ParsedTransactionError;
      readonly error?: Error;
      readonly logs?: readonly string[];
    };

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
  readonly instructions: Instruction[];
  readonly computeUnitLimit: number;
  readonly priorityFeeTier?: "low" | "medium" | "high" | "urgent";
  readonly writableAccounts?: Address[];
}

export interface CrankTaskNoAction {
  readonly shouldExecute: false;
  readonly reason: string;
}

export type CrankTaskOutcome = CrankTaskAction | CrankTaskNoAction;

export interface ICrankTask {
  readonly name: string;
  canHandle(snapshot: PoolStateSnapshot): boolean;
  evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome>;
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
