import { Address, address, IInstruction } from "@solana/kit";
import {
  buildClaimRedemptionInstruction,
  SYSTEM_PROGRAM_ID,
  HumaPoolAddresses,
} from "../../../app/lib/bonds-sdk";
import {
  CrankDecision,
  CrankExecutionContext,
  PoolStateSnapshot,
} from "../types";

export interface PendingRedemptionCandidate {
  redemptionId: bigint;
  user: Address;
  humaRequestId: bigint;
}

export class DisburseSentinelWorker {
  readonly name = "DisburseSentinelWorker";

  evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext,
    candidate?: PendingRedemptionCandidate | null
  ): CrankDecision {
    if (!context.enableAutoDisburse) {
      return {
        shouldExecute: false,
        reason: "Auto-disburse disabled in config",
      };
    }

    if (!candidate) {
      return {
        shouldExecute: false,
        reason: "No settled redemption requests pending claim",
      };
    }

    return {
      shouldExecute: true,
      reason: `Claiming settled redemption #${candidate.redemptionId} for user ${candidate.user}`,
      priorityFeeTier: "low",
    };
  }

  async buildInstructions(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext,
    candidate: PendingRedemptionCandidate,
    humaAddresses?: HumaPoolAddresses
  ): Promise<IInstruction[]> {
    const defaultHumaAddresses: HumaPoolAddresses = humaAddresses || {
      poolState: address(
        process.env.NEXT_PUBLIC_HUMA_POOL_STATE ||
          process.env.HUMA_POOL_STATE ||
          SYSTEM_PROGRAM_ID
      ),
      config: address(
        process.env.NEXT_PUBLIC_HUMA_CONFIG ||
          process.env.HUMA_CONFIG ||
          SYSTEM_PROGRAM_ID
      ),
      poolConfig: address(
        process.env.NEXT_PUBLIC_HUMA_POOL_CONFIG ||
          process.env.HUMA_POOL_CONFIG ||
          SYSTEM_PROGRAM_ID
      ),
      modeConfig: address(
        process.env.NEXT_PUBLIC_HUMA_MODE_CONFIG ||
          process.env.HUMA_MODE_CONFIG ||
          SYSTEM_PROGRAM_ID
      ),
      lenderState: address(
        process.env.NEXT_PUBLIC_HUMA_LENDER_STATE ||
          process.env.HUMA_LENDER_STATE ||
          SYSTEM_PROGRAM_ID
      ),
    };

    const tokenMint = address(snapshot.pool.tokenMint);

    const ix = await buildClaimRedemptionInstruction({
      crank: context.signer,
      beneficiary: candidate.user,
      poolId: snapshot.poolId,
      redemptionId: candidate.redemptionId,
      tokenMint,
      humaAddresses: defaultHumaAddresses,
    });

    return [ix];
  }

  getComputeUnitLimit(): number {
    return 150_000;
  }
}
