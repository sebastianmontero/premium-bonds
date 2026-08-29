import { IInstruction } from "@solana/kit";
import { buildCrankRebindExpiredRandomnessInstruction } from "../../../app/lib/bonds-sdk";
import {
  ICrankWorker,
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";

export class RebindRandomnessWorker implements ICrankWorker<
  Extract<PoolStateSnapshot, { state: "VRF_EXPIRED" }>
> {
  readonly name = "RebindRandomnessWorker";
  readonly targetState = "VRF_EXPIRED" as const;

  constructor(private readonly vrfProvider: IVrfProvider) {}

  evaluate(
    snapshot: Extract<PoolStateSnapshot, { state: "VRF_EXPIRED" }>
  ): CrankDecision {
    return {
      shouldExecute: true,
      reason: `VRF randomness expired after ${snapshot.elapsedSlots} slots. Rebinding fresh randomness account.`,
      priorityFeeTier: "urgent",
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "VRF_EXPIRED" }>,
    context: CrankExecutionContext
  ): Promise<IInstruction[]> {
    const newRandomnessAccount =
      await this.vrfProvider.provisionRandomnessAccount(
        snapshot.poolId,
        snapshot.cycleId
      );

    const ix = await buildCrankRebindExpiredRandomnessInstruction({
      crank: context.signer,
      poolId: snapshot.poolId,
      cycleId: snapshot.cycleId,
      newRandomnessAccount,
    });

    return [ix];
  }

  getComputeUnitLimit(): number {
    return 120_000;
  }
}
