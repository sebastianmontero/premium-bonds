import { buildAtomicRevealAndPickWinnersInstructions } from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
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

    const revealResult = await this.vrfProvider.prepareReveal(
      snapshot.randomnessAccount,
      snapshot.harvestSlot,
      snapshot.currentSlot
    );

    if (!revealResult.ready) {
      return {
        shouldExecute: false,
        reason:
          revealResult.error ||
          "Switchboard randomness oracle proof is not yet ready",
      };
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
