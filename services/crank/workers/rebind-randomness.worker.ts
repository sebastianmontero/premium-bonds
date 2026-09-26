import { Instruction } from "@solana/kit";
import { buildCrankRebindExpiredRandomnessInstruction } from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";

export class RebindRandomnessWorker implements ICrankTask {
  readonly name = "RebindRandomnessWorker";

  constructor(private readonly vrfProvider: IVrfProvider) {}

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state === "VRF_EXPIRED";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (snapshot.state !== "VRF_EXPIRED") {
      return {
        shouldExecute: false,
        reason: `State is not VRF_EXPIRED (current: ${snapshot.state})`,
      };
    }

    const vrf = await this.vrfProvider.prepareRebindRandomness({
      poolId: snapshot.poolId,
      cycleId: snapshot.cycleId,
      staleRandomness: snapshot.staleRandomness,
    });

    const rebindIx = await buildCrankRebindExpiredRandomnessInstruction({
      crank: context.signer,
      poolId: snapshot.poolId,
      cycleId: snapshot.cycleId,
      currentRandomnessAccount: snapshot.staleRandomness,
      newRandomnessAccount: vrf.randomnessAccount,
    });

    const instructions: Instruction[] = [...vrf.instructions, rebindIx];

    return {
      shouldExecute: true,
      reason: `VRF randomness expired after ${snapshot.elapsedSlots} slots. Rebinding fresh randomness account.`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "urgent",
      writableAccounts: [snapshot.poolAddress, snapshot.staleRandomness],
      additionalSigners: vrf.signers,
    };
  }

  getComputeUnitLimit(): number {
    return 375_000;
  }
}
