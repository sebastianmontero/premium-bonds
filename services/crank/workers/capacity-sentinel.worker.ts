import { IInstruction } from "@solana/kit";
import { buildResizeRegistryInstruction } from "../../../app/lib/bonds-sdk";
import {
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";

export class CapacitySentinelWorker {
  readonly name = "CapacitySentinelWorker";

  evaluate(snapshot: PoolStateSnapshot): CrankDecision {
    const registry = snapshot.ticketRegistry;
    if (!registry || registry.capacity <= 0) {
      return { shouldExecute: false, reason: "Invalid registry capacity" };
    }

    // Do not resize if draw is currently in progress
    if (snapshot.pool.isFrozenForDraw === 1) {
      return {
        shouldExecute: false,
        reason: "Pool is frozen for draw; skipping capacity resize",
      };
    }

    const utilization = registry.userCount / registry.capacity;
    if (utilization >= 0.85) {
      return {
        shouldExecute: true,
        reason: `Registry utilization is ${(utilization * 100).toFixed(1)}% (${registry.userCount}/${registry.capacity}). Triggering +10KB expansion.`,
        priorityFeeTier: "low",
      };
    }

    return {
      shouldExecute: false,
      reason: `Registry utilization is normal (${(utilization * 100).toFixed(1)}%)`,
    };
  }

  async buildInstructions(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<IInstruction[]> {
    const ix = await buildResizeRegistryInstruction({
      payer: context.signer,
      poolId: snapshot.poolId,
      ticketRegistry: snapshot.ticketRegistryAddress,
    });
    return [ix];
  }

  getComputeUnitLimit(): number {
    return 80_000;
  }
}
