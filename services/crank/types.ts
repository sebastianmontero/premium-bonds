import { Address, IInstruction, TransactionSigner } from "@solana/kit";
import type {
  PrizePool,
  TicketRegistry,
  PayoutRegistry,
} from "../../app/lib/bonds-sdk";

// ─── Branded Primitive Types ─────────────────────────────────────────────────

export type PoolId = number & { readonly __brand: unique symbol };
export type DrawCycleId = number & { readonly __brand: unique symbol };
export type UnixTimestamp = bigint & { readonly __brand: unique symbol };

export function toPoolId(id: number): PoolId {
  return id as PoolId;
}

export function toDrawCycleId(id: number): DrawCycleId {
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
  readonly maxPrepareBatchSize: number;
  readonly maxReinvestBatchSize: number;
  readonly enableAutoDisburse: boolean;
  readonly dryRun: boolean;
  readonly jitoEnabled?: boolean;
}

export interface WorkerExecutionResult {
  readonly workerName: string;
  readonly executed: boolean;
  readonly reason: string;
  readonly signature?: string;
  readonly computeUnitsUsed?: number;
  readonly error?: Error;
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
  ): Promise<IInstruction[]>;
  getComputeUnitLimit(snapshot: TSnapshot): number;
}
