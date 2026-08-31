import { Instruction } from "@solana/kit";
import { buildAtomicRevealAndPickWinnersInstructions } from "../../../app/lib/bonds-sdk";
import {
  ICrankWorker,
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";

export class AtomicRevealWorker implements ICrankWorker<
  Extract<PoolStateSnapshot, { state: "READY_TO_DRAW" }>
> {
  readonly name = "AtomicRevealWorker";
  readonly targetState = "READY_TO_DRAW" as const;

  constructor(private readonly vrfProvider: IVrfProvider) {}

  evaluate(
    snapshot: Extract<PoolStateSnapshot, { state: "READY_TO_DRAW" }>
  ): CrankDecision {
    return {
      shouldExecute: true,
      reason: `Cycle #${snapshot.cycleId} prepared and ready for atomic reveal & winner selection`,
      priorityFeeTier: "high",
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "READY_TO_DRAW" }>,
    context: CrankExecutionContext
  ): Promise<Instruction[]> {
    const revealResult = await this.vrfProvider.prepareReveal(
      snapshot.randomnessAccount,
      0n,
      snapshot.currentSlot
    );

    return await buildAtomicRevealAndPickWinnersInstructions({
      crank: context.signer,
      poolId: snapshot.poolId,
      currentDrawCycleId: snapshot.cycleId,
      ticketRegistry: snapshot.ticketRegistryAddress,
      randomnessAccount: snapshot.randomnessAccount,
      switchboardRevealInstruction: revealResult.revealInstruction,
    });
  }

  getComputeUnitLimit(): number {
    return 500_000;
  }
}
