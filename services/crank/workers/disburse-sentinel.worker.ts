import { address, createSolanaRpc, Instruction } from "@solana/kit";
import {
  buildClaimRedemptionInstructions,
  SYSTEM_PROGRAM_ID,
  HumaPoolAddresses,
  fetchPendingRedemptionCandidates,
  PendingRedemptionCandidate,
  RedemptionType,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";

/**
 * Physical MTU Ceiling Note:
 * Each claim instruction requires ~8 accounts. With associated token account (ATA) creation
 * and compute budget instructions, 3 claims compile to ~24 accounts (~1,000 bytes).
 * Given the Solana IPv6 MTU transaction size limit of 1232 bytes, MAX_REDEMPTIONS_PER_TX = 3
 * is the maximum physical payload that can safely fit into a single transaction.
 */
export const MAX_REDEMPTIONS_PER_TX = 3;

interface CandidateCacheEntry {
  candidates: PendingRedemptionCandidate[];
  cachedAt: number;
}

export class DisburseSentinelWorker implements ICrankTask {
  readonly name = "DisburseSentinelWorker";
  private candidateCache: Map<number, CandidateCacheEntry> = new Map();
  private readonly cacheTtlMs = 30_000; // 30s candidate cache

  invalidateCandidateCache(poolId?: number): void {
    if (poolId !== undefined) {
      this.candidateCache.delete(poolId);
    } else {
      this.candidateCache.clear();
    }
  }

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
    const humaAddresses: HumaPoolAddresses = {
      poolState: snapshot.pool.humaPoolState || SYSTEM_PROGRAM_ID,
      config: SYSTEM_PROGRAM_ID,
      poolConfig: SYSTEM_PROGRAM_ID,
      modeConfig: SYSTEM_PROGRAM_ID,
      lenderState: SYSTEM_PROGRAM_ID,
      poolUnderlyingToken: context.config?.humaPoolUnderlyingToken,
    };

    const tokenMint = address(snapshot.pool.tokenMint);
    const instructions: Instruction[] = [];
    const seenBeneficiaries = new Set<string>();

    for (const candidate of batch) {
      const isFeeWithdrawal =
        candidate.redemptionType === RedemptionType.FeeWithdrawal;
      const targetBeneficiary =
        isFeeWithdrawal && snapshot.pool.feeWallet
          ? snapshot.pool.feeWallet
          : candidate.user;

      const skipAta = seenBeneficiaries.has(targetBeneficiary);
      seenBeneficiaries.add(targetBeneficiary);

      const ixs = await buildClaimRedemptionInstructions({
        crank: context.signer,
        beneficiary: candidate.user,
        poolId: snapshot.poolId,
        redemptionId: candidate.redemptionId,
        tokenMint,
        humaAddresses,
        redemptionType: candidate.redemptionType,
        feeWallet: snapshot.pool.feeWallet
          ? address(snapshot.pool.feeWallet)
          : undefined,
        skipAtaCreation: skipAta,
      });
      instructions.push(...ixs);
    }

    return instructions;
  }

  getComputeUnitLimit(): number {
    return 800_000;
  }
}
