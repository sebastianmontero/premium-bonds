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
 * Computes draw date timestamp in seconds, prioritizing on-chain revealedAt,
 * falling back to cycle duration calculation.
 */
export function getDrawDateTimestamp(
  revealedAt?: number,
  currentCycleEndAt?: number,
  currentCycleId?: number,
  cycleId?: number,
  cycleDurationSeconds: number = 604800
): number {
  if (revealedAt && revealedAt > 0) {
    return revealedAt;
  }

  if (
    currentCycleEndAt &&
    currentCycleId !== undefined &&
    cycleId !== undefined
  ) {
    return (
      currentCycleEndAt - (currentCycleId - cycleId) * cycleDurationSeconds
    );
  }

  return Math.floor(Date.now() / 1000);
}
