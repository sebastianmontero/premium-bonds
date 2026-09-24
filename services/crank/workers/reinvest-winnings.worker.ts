import { Instruction } from "@solana/kit";
import { buildPackedReinvestWinningsInstructions } from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";

export class ReinvestWinningsWorker implements ICrankTask {
  readonly name = "ReinvestWinningsWorker";

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state === "REINVESTMENT_PENDING";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (snapshot.state !== "REINVESTMENT_PENDING") {
      return {
        shouldExecute: false,
        reason: `State is not REINVESTMENT_PENDING (current: ${snapshot.state})`,
      };
    }

    const count = snapshot.unprocessedWinners.length;
    if (count === 0) {
      return {
        shouldExecute: false,
        reason: "No unprocessed winners to reinvest",
      };
    }

    const batchSize = Math.min(context.maxReinvestBatchSize, count);
    const instructions = await this.buildInstructions(snapshot, context);

    return {
      shouldExecute: true,
      reason: `Reinvesting batch of ${batchSize} winners (${count} remaining)`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(snapshot),
      priorityFeeTier: "medium",
      writableAccounts: [
        snapshot.poolAddress,
        snapshot.payoutRegistryAddress,
        snapshot.ticketRegistryAddress,
      ],
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "REINVESTMENT_PENDING" }>,
    context: CrankExecutionContext
  ): Promise<Instruction[]> {
    const winnersToProcess = snapshot.unprocessedWinners.slice(
      0,
      context.maxReinvestBatchSize
    );

    return await buildPackedReinvestWinningsInstructions({
      crank: context.signer,
      poolId: snapshot.poolId,
      cycleId: snapshot.cycleId,
      winners: winnersToProcess,
      ticketRegistry: snapshot.ticketRegistryAddress,
    });
  }

  getComputeUnitLimit(
    snapshot: Extract<PoolStateSnapshot, { state: "REINVESTMENT_PENDING" }>
  ): number {
    const batchSize = Math.min(5, snapshot.unprocessedWinners.length);
    return Math.max(150_000, batchSize * 70_000 + 50_000);
  }
}
