import { DrawCycleInfo, PayoutRegistryInfo } from "./bonds-sdk";
import { deriveRandomIndex, formatSeedHex } from "./vrf-utils";
import type { DrawWinnerRecord, DrawCycleSummary } from "../types";

/**
 * Normalizes a DrawCycle account and optional PayoutRegistry account into a DrawCycleSummary.
 */
export function formatDrawCycleSummary(
  drawCycle: DrawCycleInfo,
  payout?: PayoutRegistryInfo
): DrawCycleSummary {
  const winnersCount = payout ? payout.winnersCount : 0;
  const payoutsCompleted = payout ? payout.payoutsCompleted : 0;

  // Handle both bigint and number for revealedAt
  const revealedAtNum =
    payout && payout.revealedAt !== undefined
      ? typeof payout.revealedAt === "bigint"
        ? payout.revealedAt > 0n
          ? Number(payout.revealedAt)
          : undefined
        : payout.revealedAt > 0
          ? Number(payout.revealedAt)
          : undefined
      : undefined;

  const initiatedAtNum =
    drawCycle.initiatedAt !== undefined
      ? typeof drawCycle.initiatedAt === "bigint"
        ? drawCycle.initiatedAt > 0n
          ? Number(drawCycle.initiatedAt)
          : undefined
        : drawCycle.initiatedAt > 0
          ? Number(drawCycle.initiatedAt)
          : undefined
      : undefined;

  const completedAtNum =
    drawCycle.completedAt !== undefined
      ? typeof drawCycle.completedAt === "bigint"
        ? drawCycle.completedAt > 0n
          ? Number(drawCycle.completedAt)
          : undefined
        : drawCycle.completedAt > 0
          ? Number(drawCycle.completedAt)
          : undefined
      : undefined;

  return {
    poolId: drawCycle.poolId,
    cycleId: drawCycle.cycleId,
    status: drawCycle.status,
    prizePot: Number(drawCycle.prizePot),
    cycleFeeCollected: Number(drawCycle.cycleFeeCollected),
    lockedTicketCount: drawCycle.lockedTicketCount,
    harvestSlot: Number(drawCycle.harvestSlot),
    randomnessAccount: drawCycle.randomnessAccount.toString(),
    randomnessSeed: drawCycle.randomnessSeed,
    vrfSeedHex: formatSeedHex(drawCycle.randomnessSeed),
    revealedAt: revealedAtNum,
    initiatedAt: initiatedAtNum,
    completedAt: completedAtNum,
    winnersCount,
    payoutsCompleted,
    hasPayoutRegistry: Boolean(payout),
  };
}

/**
 * Parses winner entries from PayoutRegistry and calculates derived winning ticket indices
 * matching on-chain derive_random_index(seed, tier_idx, slot_in_tier, cycle_id, locked_tickets).
 */
export async function parseWinnersWithVrf(
  payout: PayoutRegistryInfo,
  drawCycle: DrawCycleInfo
): Promise<DrawWinnerRecord[]> {
  const winners: DrawWinnerRecord[] = [];
  const tierWinnerCounts: Record<number, number> = {};

  for (let wi = 0; wi < payout.winnersCount; wi++) {
    const w = payout.winners[wi];
    const slotInTier = tierWinnerCounts[w.tierIndex] ?? 0;
    tierWinnerCounts[w.tierIndex] = slotInTier + 1;

    let winningTicketIndex: number | undefined;
    const allZero = drawCycle.randomnessSeed.every((b) => b === 0);
    if (!allZero && drawCycle.lockedTicketCount > 0) {
      try {
        winningTicketIndex = await deriveRandomIndex(
          drawCycle.randomnessSeed,
          w.tierIndex,
          slotInTier,
          drawCycle.cycleId,
          drawCycle.lockedTicketCount
        );
      } catch {
        // VRF index calculation non-fatal fallback
      }
    }

    winners.push({
      winnerIndex: wi,
      slotInTier,
      winnerAddress: w.winner ? w.winner.toString() : "Unknown",
      amountOwed: Number(w.amountOwed),
      bondsBought: w.bondsBought ?? 0,
      processed: Boolean(w.processed),
      tierIndex: w.tierIndex,
      winningTicketIndex,
    });
  }

  return winners;
}

/**
 * Resolves the effective timestamp (in seconds) and whether the date is estimated for a draw cycle.
 * Prioritizes on-chain revealedAt / completedAt, then initiatedAt, and falls back to cycle end estimation.
 */
export function resolveDrawCycleTimestamp(
  draw: {
    revealedAt?: number;
    completedAt?: number;
    initiatedAt?: number;
    cycleId?: number;
  },
  poolContext?: {
    currentCycleEndAt?: number;
    currentCycleId?: number;
    stakeCycleDurationHrs?: number;
  }
): { timestamp: number; isEstimated: boolean } {
  // 1. Authoritative completed timestamp (revealedAt or completedAt)
  if (draw.revealedAt && draw.revealedAt > 0) {
    return { timestamp: draw.revealedAt, isEstimated: false };
  }
  if (draw.completedAt && draw.completedAt > 0) {
    return { timestamp: draw.completedAt, isEstimated: false };
  }

  // 2. In-flight draw harvest/initiated timestamp
  if (draw.initiatedAt && draw.initiatedAt > 0) {
    return { timestamp: draw.initiatedAt, isEstimated: false };
  }

  // 3. Fallback to estimation based on pool cycle metadata
  const cycleDurationSeconds =
    (poolContext?.stakeCycleDurationHrs ?? 168) * 3600;
  if (
    poolContext?.currentCycleEndAt &&
    poolContext.currentCycleEndAt > 0 &&
    poolContext.currentCycleId !== undefined &&
    draw.cycleId !== undefined
  ) {
    const estimated =
      poolContext.currentCycleEndAt -
      (poolContext.currentCycleId - draw.cycleId) * cycleDurationSeconds;
    return { timestamp: Math.max(0, estimated), isEstimated: true };
  }

  return { timestamp: Math.floor(Date.now() / 1000), isEstimated: true };
}

/**
 * Formats a draw cycle's display date string with optional estimation prefix, UTC formatting,
 * and optional time inclusion.
 */
export function formatDrawDisplayDate(
  draw: {
    revealedAt?: number;
    completedAt?: number;
    initiatedAt?: number;
    cycleId?: number;
  },
  poolContext?: {
    currentCycleEndAt?: number;
    currentCycleId?: number;
    stakeCycleDurationHrs?: number;
  },
  options?: {
    estimatedPrefix?: string;
    includeTime?: boolean;
    locale?: string;
  }
): string {
  const { timestamp, isEstimated } = resolveDrawCycleTimestamp(
    draw,
    poolContext
  );
  const locale = options?.locale ?? "en-US";
  const dateObj = new Date(timestamp * 1000);

  const formatOptions: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
    ...(options?.includeTime
      ? {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }
      : {}),
  };

  const formattedDate = dateObj.toLocaleDateString(locale, formatOptions);
  const prefix =
    isEstimated && options?.estimatedPrefix
      ? `${options.estimatedPrefix} `
      : "";
  return `${prefix}${formattedDate}`;
}

/**
 * Backward compatibility wrapper for getDrawDateTimestamp.
 */
export function getDrawDateTimestamp(
  revealedAt?: number,
  currentCycleEndAt?: number,
  currentCycleId?: number,
  cycleId?: number,
  cycleDurationSeconds: number = 604800
): number {
  return resolveDrawCycleTimestamp(
    { revealedAt, cycleId },
    {
      currentCycleEndAt,
      currentCycleId,
      stakeCycleDurationHrs: cycleDurationSeconds / 3600,
    }
  ).timestamp;
}
