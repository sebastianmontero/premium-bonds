import { Instruction } from "@solana/kit";
import { buildPrepareDrawInstruction } from "../../../app/lib/bonds-sdk";
import {
  ICrankWorker,
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";

export class PrepareDrawWorker implements ICrankWorker<
  Extract<PoolStateSnapshot, { state: "PREPARE_BATCHING" }>
> {
  readonly name = "PrepareDrawWorker";
  readonly targetState = "PREPARE_BATCHING" as const;

  evaluate(
    snapshot: Extract<PoolStateSnapshot, { state: "PREPARE_BATCHING" }>,
    context: CrankExecutionContext
  ): CrankDecision {
    const remaining = snapshot.total - snapshot.cursor;
    if (remaining <= 0) {
      return {
        shouldExecute: false,
        reason: "All users already prepared for draw",
      };
    }

    const batchSize = Math.min(context.maxPrepareBatchSize, remaining);
    return {
      shouldExecute: true,
      reason: `Preparing batch of ${batchSize} users (${snapshot.cursor}/${snapshot.total})`,
      priorityFeeTier: "medium",
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "PREPARE_BATCHING" }>,
    context: CrankExecutionContext
  ): Promise<Instruction[]> {
    const remaining = snapshot.total - snapshot.cursor;
    const batchSize = Math.min(context.maxPrepareBatchSize, remaining);

    const ix = await buildPrepareDrawInstruction({
      crank: context.signer,
      poolId: snapshot.poolId,
      currentDrawCycleId: snapshot.cycleId,
      ticketRegistry: snapshot.ticketRegistryAddress,
      batchSize,
    });

    return [ix];
  }

  getComputeUnitLimit(
    snapshot: Extract<PoolStateSnapshot, { state: "PREPARE_BATCHING" }>
  ): number {
    const remaining = Math.max(1, snapshot.total - snapshot.cursor);
    const effectiveBatch = Math.min(500, remaining);
    return Math.min(200_000, Math.max(100_000, 30_000 + effectiveBatch * 180));
  }
}
