import type { PrizePool, RedemptionBatch } from "../../../app/lib/bonds-sdk";
import {
  canCloseRedemptionBatch,
  RedemptionBatchStatus,
} from "../../../app/lib/bonds-sdk";

export interface HumaPoolSnapshot {
  readonly nextRequestId: bigint;
  isRedemptionSettled(humaRequestId: bigint): boolean;
}

export function createHumaPoolSnapshot(
  nextRequestId: bigint
): HumaPoolSnapshot {
  return {
    nextRequestId,
    isRedemptionSettled: (id: bigint) => id < nextRequestId,
  };
}

export type BatchAction =
  | { readonly type: "NONE"; readonly reason: string }
  | {
      readonly type: "SETTLE";
      readonly poolId: number;
      readonly batchId: bigint;
      readonly reason: string;
    }
  | {
      readonly type: "SUBMIT";
      readonly poolId: number;
      readonly batchId: bigint;
      readonly nextBatchId: bigint;
      readonly principalRequested: bigint;
      readonly reason: string;
    }
  | {
      readonly type: "CLOSE";
      readonly poolId: number;
      readonly batchId: bigint;
      readonly reason: string;
    };

export interface BatchClassifierInput {
  readonly poolId: number;
  readonly pool: PrizePool;
  readonly accumulatingBatch?: RedemptionBatch | null;
  readonly submittedBatch?: RedemptionBatch | null;
  readonly humaSnapshot?: HumaPoolSnapshot | null;
  readonly currentTimestamp: bigint | number;
}

export function hasSubmittedBatch(submittedBatchId?: bigint | null): boolean {
  return (
    submittedBatchId !== null &&
    submittedBatchId !== undefined &&
    submittedBatchId !== 0xffffffffffffffffn
  );
}

export function classifyBatchAction(input: BatchClassifierInput): BatchAction {
  const {
    poolId,
    pool,
    accumulatingBatch,
    submittedBatch,
    humaSnapshot,
    currentTimestamp,
  } = input;

  const hasSubmitted = hasSubmittedBatch(pool.submittedBatchId);

  // 1. Priority 1: Settle submitted batch if Huma queue has progressed
  if (hasSubmitted && submittedBatch) {
    if (
      submittedBatch.status === RedemptionBatchStatus.Submitted &&
      humaSnapshot &&
      humaSnapshot.isRedemptionSettled(submittedBatch.humaRequestId)
    ) {
      return {
        type: "SETTLE",
        poolId,
        batchId: submittedBatch.batchId,
        reason: `Huma queue has settled request #${submittedBatch.humaRequestId}`,
      };
    }
  }

  // 2. Priority 2: Submit accumulating batch if no batch in-flight, pool solvent, and not frozen
  const isFrozen =
    typeof pool.isFrozenForDraw === "boolean"
      ? pool.isFrozenForDraw
      : Number(pool.isFrozenForDraw) !== 0;

  if (!hasSubmitted && !isFrozen && accumulatingBatch) {
    if (
      accumulatingBatch.status === RedemptionBatchStatus.Accumulating &&
      accumulatingBatch.totalPrincipalRequested > 0n
    ) {
      return {
        type: "SUBMIT",
        poolId,
        batchId: accumulatingBatch.batchId,
        nextBatchId: BigInt(pool.nextRedemptionBatchId),
        principalRequested: accumulatingBatch.totalPrincipalRequested,
        reason: `Accumulating batch #${accumulatingBatch.batchId} has ${accumulatingBatch.totalPrincipalRequested} micro-USDC pending`,
      };
    }
  }

  // 3. Priority 3: Close submitted batch if fully claimed or 180d expired
  if (
    submittedBatch &&
    canCloseRedemptionBatch(submittedBatch, currentTimestamp)
  ) {
    return {
      type: "CLOSE",
      poolId,
      batchId: submittedBatch.batchId,
      reason: `Batch #${submittedBatch.batchId} eligible for rent closure and sweep`,
    };
  }

  return { type: "NONE", reason: "Batch pipeline idle" };
}
