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

    const instructions = await this.buildInstructions(snapshot, context);

    return {
      shouldExecute: true,
      reason: `VRF randomness expired after ${snapshot.elapsedSlots} slots. Rebinding fresh randomness account.`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "urgent",
      writableAccounts: [snapshot.poolAddress, snapshot.staleRandomness],
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "VRF_EXPIRED" }>,
    context: CrankExecutionContext
  ): Promise<Instruction[]> {
    const newRandomnessAccount =
      await this.vrfProvider.provisionRandomnessAccount(
        snapshot.poolId,
        snapshot.cycleId
      );

    const ix = await buildCrankRebindExpiredRandomnessInstruction({
      crank: context.signer,
      poolId: snapshot.poolId,
      cycleId: snapshot.cycleId,
      currentRandomnessAccount: snapshot.staleRandomness,
      newRandomnessAccount,
    });

    return [ix];
  }

  getComputeUnitLimit(): number {
    return 120_000;
  }
}
