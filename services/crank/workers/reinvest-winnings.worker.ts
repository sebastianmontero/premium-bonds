import { IInstruction } from "@solana/kit";
import { buildPackedReinvestWinningsInstructions } from "../../../app/lib/bonds-sdk";
import {
  ICrankWorker,
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";

export class ReinvestWinningsWorker implements ICrankWorker<
  Extract<PoolStateSnapshot, { state: "REINVESTMENT_PENDING" }>
> {
  readonly name = "ReinvestWinningsWorker";
  readonly targetState = "REINVESTMENT_PENDING" as const;

  evaluate(
    snapshot: Extract<PoolStateSnapshot, { state: "REINVESTMENT_PENDING" }>,
    context: CrankExecutionContext
  ): CrankDecision {
    const count = snapshot.unprocessedWinners.length;
    if (count === 0) {
      return {
        shouldExecute: false,
        reason: "No unprocessed winners to reinvest",
      };
    }

    const batchSize = Math.min(context.maxReinvestBatchSize, count);
    return {
      shouldExecute: true,
      reason: `Reinvesting batch of ${batchSize} winners (${count} remaining)`,
      priorityFeeTier: "medium",
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "REINVESTMENT_PENDING" }>,
    context: CrankExecutionContext
  ): Promise<IInstruction[]> {
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
