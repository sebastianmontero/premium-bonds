import { address, Instruction } from "@solana/kit";
import {
  buildClaimRedemptionInstructions,
  fetchPendingRedemptionCandidates,
  PendingRedemptionCandidate,
  RedemptionType,
  resolveHumaAddresses,
  CLAIM_REDEMPTION_REQUIRED_HUMA_KEYS,
} from "../../../app/lib/bonds-sdk";
import {
  REDEMPTION_CANDIDATE_QUARANTINE_MS,
  VENUE_LIQUIDITY_ALERT_STALLED_MS,
} from "../constants";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
  WorkerDeferredOutcome,
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
  private quarantinedCandidates: Map<string, number> = new Map(); // key: `${poolId}:${candidate.redemptionId}` -> expiresAt
  private deficitStreak: Map<number, { count: number; firstSeenAt: number }> =
    new Map();
  private forceSingleCandidate: Map<number, boolean> = new Map();
  private lastEvaluatedBatch: Map<number, PendingRedemptionCandidate[]> =
    new Map();

  invalidateCandidateCache(poolId?: number): void {
    if (poolId !== undefined) {
      this.candidateCache.delete(poolId);
    } else {
      this.candidateCache.clear();
    }
  }

  clearQuarantines(poolId?: number): void {
    if (poolId !== undefined) {
      const prefix = `${poolId}:`;
      for (const key of this.quarantinedCandidates.keys()) {
        if (key.startsWith(prefix)) {
          this.quarantinedCandidates.delete(key);
        }
      }
    } else {
      this.quarantinedCandidates.clear();
    }
  }

  isCandidateQuarantined(poolId: number, redemptionId: bigint): boolean {
    const key = `${poolId}:${redemptionId}`;
    const expiresAt = this.quarantinedCandidates.get(key);
    if (!expiresAt) return false;
    if (Date.now() >= expiresAt) {
      this.quarantinedCandidates.delete(key);
      return false;
    }
    return true;
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

    const humaAddresses = resolveHumaAddresses(
      {
        lenderState:
          context.config?.poolHumaLenderStates?.[snapshot.poolId] ??
          context.config?.humaLenderState,
        config: context.config?.humaConfig,
        poolConfig: context.config?.humaPoolConfig,
        modeConfig: context.config?.humaModeConfig,
        poolUnderlyingToken: context.config?.humaPoolUnderlyingToken,
      },
      snapshot.pool.humaPoolState
    );

    const missing = CLAIM_REDEMPTION_REQUIRED_HUMA_KEYS.filter(
      (k) => !humaAddresses[k]
    );
    if (missing.length > 0) {
      return {
        shouldExecute: false,
        reason: `Auto-disburse skipped for Pool #${snapshot.poolId}: missing required Huma address(es) [${missing.join(", ")}]`,
      };
    }

    // Check / fetch candidates
    const poolId = snapshot.poolId;
    let candidates = this.getCachedCandidates(poolId);

    if (!candidates) {
      try {
        const rpc = context.rpc;
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

    // Filter out quarantined candidates
    const now = Date.now();
    for (const [key, expiresAt] of this.quarantinedCandidates.entries()) {
      if (now >= expiresAt) {
        this.quarantinedCandidates.delete(key);
      }
    }

    const eligibleCandidates = candidates.filter(
      (c) => !this.quarantinedCandidates.has(`${poolId}:${c.redemptionId}`)
    );

    if (eligibleCandidates.length === 0) {
      return {
        shouldExecute: false,
        reason: `All ${candidates.length} pending redemptions currently quarantined due to liquidity deficit`,
      };
    }

    // Single-Candidate Fallback vs Normal Batching
    const isSingleCandidateForced =
      this.forceSingleCandidate.get(poolId) ?? false;
    const batchSize = isSingleCandidateForced ? 1 : MAX_REDEMPTIONS_PER_TX;
    const batch = eligibleCandidates.slice(0, batchSize);

    this.lastEvaluatedBatch.set(poolId, batch);

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

  onSuccess(poolId: number): void {
    this.deficitStreak.delete(poolId);
    this.forceSingleCandidate.delete(poolId);
    this.lastEvaluatedBatch.delete(poolId);
    this.invalidateCandidateCache(poolId);
  }

  onDeferred(poolId: number, outcome: WorkerDeferredOutcome): void {
    if (outcome.status === "VENUE_LIQUIDITY_DEFICIT") {
      const batch = this.lastEvaluatedBatch.get(poolId);
      if (batch && batch.length > 1) {
        // Multi-candidate batch failed simulation: retry candidate #0 individually before deferring / quarantining
        console.warn(
          `[DisburseSentinelWorker] [Pool #${poolId}] Multi-candidate batch failed simulation due to liquidity deficit. Retrying single candidate #${batch[0].redemptionId} individually next tick.`
        );
        this.forceSingleCandidate.set(poolId, true);
        this.invalidateCandidateCache(poolId);
      } else if (batch && batch.length === 1) {
        // Single candidate failed: quarantine this specific candidate
        const candidate = batch[0];
        const key = `${poolId}:${candidate.redemptionId}`;
        this.quarantinedCandidates.set(
          key,
          Date.now() + REDEMPTION_CANDIDATE_QUARANTINE_MS
        );
        console.warn(
          `[DisburseSentinelWorker] [Pool #${poolId}] Quarantining redemption candidate #${candidate.redemptionId} for ${REDEMPTION_CANDIDATE_QUARANTINE_MS / 1000}s due to venue liquidity deficit.`
        );
        this.forceSingleCandidate.delete(poolId);
        this.invalidateCandidateCache(poolId);

        // Track streak for alerts
        const streak = this.deficitStreak.get(poolId) || {
          count: 0,
          firstSeenAt: Date.now(),
        };
        streak.count++;
        this.deficitStreak.set(poolId, streak);
        if (
          Date.now() - streak.firstSeenAt >=
          VENUE_LIQUIDITY_ALERT_STALLED_MS
        ) {
          console.warn(
            `[DisburseSentinelWorker] [Pool #${poolId}] Venue liquidity deficit has persisted continuously for > ${VENUE_LIQUIDITY_ALERT_STALLED_MS / 1000}s.`
          );
        }
      } else {
        this.invalidateCandidateCache(poolId);
      }
    } else {
      this.invalidateCandidateCache(poolId);
    }
  }

  onError(poolId: number): void {
    this.invalidateCandidateCache(poolId);
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
    const humaAddresses = resolveHumaAddresses(
      {
        lenderState:
          context.config?.poolHumaLenderStates?.[snapshot.poolId] ??
          context.config?.humaLenderState,
        config: context.config?.humaConfig,
        poolConfig: context.config?.humaPoolConfig,
        modeConfig: context.config?.humaModeConfig,
        poolUnderlyingToken: context.config?.humaPoolUnderlyingToken,
      },
      snapshot.pool.humaPoolState
    );

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
