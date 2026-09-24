import { address, createSolanaRpc, Instruction } from "@solana/kit";
import {
  buildClaimRedemptionInstructions,
  SYSTEM_PROGRAM_ID,
  HumaPoolAddresses,
  fetchPendingRedemptionCandidates,
  PendingRedemptionCandidate,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";

export const MAX_REDEMPTIONS_PER_TX = 3;

interface CandidateCacheEntry {
  candidates: PendingRedemptionCandidate[];
  cachedAt: number;
}

export class DisburseSentinelWorker implements ICrankTask {
  readonly name = "DisburseSentinelWorker";
  private candidateCache: Map<number, CandidateCacheEntry> = new Map();
  private readonly cacheTtlMs = 30_000; // 30s candidate cache

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return (
      snapshot.state !== "POOL_CLOSED" &&
      snapshot.state !== "CIRCUIT_BREAKER_HALTED"
    );
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    if (!context.enableAutoDisburse) {
      return {
        shouldExecute: false,
        reason: "Auto-disburse disabled in config",
      };
    }

    if (Number(snapshot.pool.totalPendingRedemptions) === 0) {
      return {
        shouldExecute: false,
        reason: "No pending redemptions recorded on-chain for pool",
      };
    }

    // Check / fetch candidates
    const poolId = snapshot.poolId;
    let candidates = this.getCachedCandidates(poolId);

    if (!candidates) {
      try {
        const rpc = createSolanaRpc(context.rpcUrl);
        candidates = await fetchPendingRedemptionCandidates({
          rpc,
          poolId,
          humaPoolState: snapshot.pool.humaPoolState,
        });
        this.candidateCache.set(poolId, {
          candidates,
          cachedAt: Date.now(),
        });
      } catch (err: unknown) {
        return {
          shouldExecute: false,
          reason: `Failed to fetch pending redemptions: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }

    if (candidates.length === 0) {
      return {
        shouldExecute: false,
        reason: "No settled redemption requests pending claim",
      };
    }

    // Batch up to MAX_REDEMPTIONS_PER_TX = 3
    const batch = candidates.slice(0, MAX_REDEMPTIONS_PER_TX);
    const instructions = await this.buildInstructionsForBatch(
      snapshot,
      context,
      batch
    );

    return {
      shouldExecute: true,
      reason: `Claiming batch of ${batch.length} settled redemptions (IDs: [${batch.map((b) => `#${b.redemptionId}`).join(", ")}])`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "low",
      writableAccounts: [snapshot.poolAddress],
    };
  }

  private getCachedCandidates(
    poolId: number
  ): PendingRedemptionCandidate[] | null {
    const entry = this.candidateCache.get(poolId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.cacheTtlMs) {
      this.candidateCache.delete(poolId);
      return null;
    }
    return entry.candidates;
  }

  async buildInstructionsForBatch(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext,
    batch: PendingRedemptionCandidate[]
  ): Promise<Instruction[]> {
    const defaultHumaAddresses: HumaPoolAddresses = {
      poolState:
        snapshot.pool.humaPoolState ||
        address(
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
    const instructions: Instruction[] = [];

    for (const candidate of batch) {
      const ixs = await buildClaimRedemptionInstructions({
        crank: context.signer,
        beneficiary: candidate.user,
        poolId: snapshot.poolId,
        redemptionId: candidate.redemptionId,
        tokenMint,
        humaAddresses: defaultHumaAddresses,
        redemptionType: candidate.redemptionType,
        feeWallet: snapshot.pool.feeWallet
          ? address(snapshot.pool.feeWallet)
          : undefined,
      });
      instructions.push(...ixs);
    }

    return instructions;
  }

  getComputeUnitLimit(): number {
    return 800_000;
  }
}
