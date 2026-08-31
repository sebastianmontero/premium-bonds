import { address, Instruction } from "@solana/kit";
import {
  buildHarvestYieldAndCommitInstruction,
  SYSTEM_PROGRAM_ID,
} from "../../../app/lib/bonds-sdk";
import {
  ICrankWorker,
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";

export class HarvestYieldWorker implements ICrankWorker<
  Extract<PoolStateSnapshot, { state: "YIELD_HARVEST_READY" }>
> {
  readonly name = "HarvestYieldWorker";
  readonly targetState = "YIELD_HARVEST_READY" as const;

  constructor(private readonly vrfProvider: IVrfProvider) {}

  evaluate(
    snapshot: Extract<PoolStateSnapshot, { state: "YIELD_HARVEST_READY" }>
  ): CrankDecision {
    return {
      shouldExecute: true,
      reason: `Cycle #${snapshot.currentCycleId} is ready for yield harvest`,
      priorityFeeTier: "medium",
    };
  }

  async buildInstructions(
    snapshot: Extract<PoolStateSnapshot, { state: "YIELD_HARVEST_READY" }>,
    context: CrankExecutionContext
  ): Promise<Instruction[]> {
    const randomnessAccount = await this.vrfProvider.provisionRandomnessAccount(
      snapshot.poolId,
      snapshot.currentCycleId
    );

    const pstMint = address(
      process.env.NEXT_PUBLIC_HUMA_MODE_MINT ||
        process.env.HUMA_MODE_MINT ||
        SYSTEM_PROGRAM_ID
    );

    const humaPoolState = address(
      process.env.NEXT_PUBLIC_HUMA_POOL_STATE ||
        process.env.HUMA_POOL_STATE ||
        SYSTEM_PROGRAM_ID
    );

    const ix = await buildHarvestYieldAndCommitInstruction({
      crank: context.signer,
      poolId: snapshot.poolId,
      ticketRegistry: snapshot.ticketRegistryAddress,
      currentDrawCycleId: snapshot.currentCycleId,
      pstMint,
      humaPoolState,
      randomnessAccount,
    });

    return [ix];
  }

  getComputeUnitLimit(): number {
    return 150_000;
  }
}
