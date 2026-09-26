import { buildAtomicRevealAndPickWinnersInstructions } from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
  toSlot,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";

export class AtomicRevealWorker implements ICrankTask {
  readonly name = "AtomicRevealWorker";

  constructor(private readonly vrfProvider: IVrfProvider) {}

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state === "READY_TO_DRAW";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (snapshot.state !== "READY_TO_DRAW") {
      return {
        shouldExecute: false,
        reason: `State is not READY_TO_DRAW (current: ${snapshot.state})`,
      };
    }

    const revealResult = await this.vrfProvider.prepareReveal({
      randomnessAccount: snapshot.randomnessAccount,
      harvestSlot: toSlot(snapshot.harvestSlot),
      currentSlot: toSlot(snapshot.currentSlot),
    });

    switch (revealResult.status) {
      case "pending_oracle":
        return {
          shouldExecute: false,
          reason: `Awaiting oracle proof: ${revealResult.reason}`,
          retryAfterMs: revealResult.retryAfterMs ?? 2000,
        };
      case "uncommitted": {
        const deltaSlots =
          snapshot.harvestSlot + 1001n - snapshot.currentSlot;
        const backoffMs = Math.max(1000, Number(deltaSlots) * 400);
        console.warn(
          `[AtomicRevealWorker] [Pool #${snapshot.poolId}] Randomness uncommitted (seedSlot < harvestSlot). Backing off for ${deltaSlots} slots (~${Math.round(backoffMs / 1000)}s) until rebind eligible.`
        );
        return {
          shouldExecute: false,
          reason: `Randomness uncommitted: ${revealResult.reason}`,
          retryAfterMs: backoffMs,
        };
      }
      case "expired":
        return {
          shouldExecute: false,
          reason: `Randomness expired (${revealResult.elapsedSlots} slots elapsed): ${revealResult.reason}`,
        };
      case "ready":
        break;
      default: {
        const _exhaustive: never = revealResult;
        throw new Error(
          `Unhandled VRF reveal status: ${JSON.stringify(_exhaustive)}`
        );
      }
    }

    const instructions = await buildAtomicRevealAndPickWinnersInstructions({
      crank: context.signer,
      poolId: snapshot.poolId,
      currentDrawCycleId: snapshot.cycleId,
      ticketRegistry: snapshot.ticketRegistryAddress,
      randomnessAccount: snapshot.randomnessAccount,
      switchboardRevealInstruction: revealResult.revealInstruction,
    });

    return {
      shouldExecute: true,
      reason: `Cycle #${snapshot.cycleId} prepared and ready for atomic reveal & winner selection`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "high",
      writableAccounts: [
        snapshot.poolAddress,
        snapshot.ticketRegistryAddress,
        snapshot.randomnessAccount,
      ],
    };
  }

  getComputeUnitLimit(): number {
    return 800_000;
  }
}
