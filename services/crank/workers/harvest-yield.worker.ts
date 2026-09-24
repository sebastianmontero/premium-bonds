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

    const instructions = await this.buildInstructions(snapshot, context);

    return {
      shouldExecute: true,
      reason: `Cycle #${snapshot.currentCycleId} is ready for yield harvest`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "medium",
      writableAccounts: [snapshot.poolAddress, snapshot.ticketRegistryAddress],
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
