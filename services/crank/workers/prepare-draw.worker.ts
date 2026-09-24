import { Instruction } from "@solana/kit";
import { buildPrepareDrawInstruction } from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";

export class PrepareDrawWorker implements ICrankTask {
  readonly name = "PrepareDrawWorker";

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state === "PREPARE_BATCHING";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (snapshot.state !== "PREPARE_BATCHING") {
      return {
        shouldExecute: false,
        reason: `State is not PREPARE_BATCHING (current: ${snapshot.state})`,
      };
    }

    const remaining = snapshot.total - snapshot.cursor;
    if (remaining <= 0) {
      return {
        shouldExecute: false,
        reason: "All users already prepared for draw",
      };
    }

    const batchSize = Math.min(context.maxPrepareBatchSize, remaining);
    const instructions = await this.buildInstructions(snapshot, context);

    return {
      shouldExecute: true,
      reason: `Preparing batch of ${batchSize} users (${snapshot.cursor}/${snapshot.total})`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(snapshot),
      priorityFeeTier: "medium",
      writableAccounts: [snapshot.poolAddress, snapshot.ticketRegistryAddress],
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
