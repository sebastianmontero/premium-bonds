import { address, Instruction } from "@solana/kit";
import {
  buildHarvestYieldAndCommitInstruction,
  SYSTEM_PROGRAM_ID,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";
import { IVrfProvider } from "../vrf/randomness-provider";
import { CrankConfig } from "../config";

export class HarvestYieldWorker implements ICrankTask {
  readonly name = "HarvestYieldWorker";

  constructor(
    private readonly vrfProvider: IVrfProvider,
    private readonly config?: CrankConfig
  ) {}

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return snapshot.state === "YIELD_HARVEST_READY";
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (snapshot.state !== "YIELD_HARVEST_READY") {
      return {
        shouldExecute: false,
        reason: `State is not YIELD_HARVEST_READY (current: ${snapshot.state})`,
      };
    }

    const vrf = await this.vrfProvider.prepareHarvestRandomness({
      poolId: snapshot.poolId,
      cycleId: snapshot.currentCycleId,
    });

    const pstMint =
      this.config?.pstMint ||
      address(
        process.env.NEXT_PUBLIC_HUMA_MODE_MINT ||
          process.env.HUMA_MODE_MINT ||
          SYSTEM_PROGRAM_ID
      );

    const humaPoolState =
      snapshot.pool.humaPoolState ||
      address(
        process.env.NEXT_PUBLIC_HUMA_POOL_STATE ||
          process.env.HUMA_POOL_STATE ||
          SYSTEM_PROGRAM_ID
      );

    const harvestIx = await buildHarvestYieldAndCommitInstruction({
      crank: context.signer,
      poolId: snapshot.poolId,
      ticketRegistry: snapshot.ticketRegistryAddress,
      currentDrawCycleId: snapshot.currentCycleId,
      pstMint,
      humaPoolState,
      randomnessAccount: vrf.randomnessAccount,
    });

    const instructions: Instruction[] = [...vrf.instructions, harvestIx];
    const computeUnitLimit =
      vrf.computeUnitsRequired && vrf.computeUnitsRequired > 50_000
        ? 375_000
        : 200_000;

    return {
      shouldExecute: true,
      reason: `Cycle #${snapshot.currentCycleId} is ready for yield harvest`,
      instructions,
      computeUnitLimit,
      priorityFeeTier: "medium",
      writableAccounts: [snapshot.poolAddress, snapshot.ticketRegistryAddress],
      additionalSigners: vrf.signers,
    };
  }

  getComputeUnitLimit(): number {
    return 200_000;
  }
}
