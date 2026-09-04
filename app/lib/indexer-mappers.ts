import {
  drawWinners,
  pendingRedemptions,
  drawHistory,
  poolSnapshots,
  userPortfolioStats,
} from "./db/schema";
import type { DrawHistoryStats, DrawStatusName } from "../types";

export type ApiResponse<T> =
  | { success: true; data: T; fallbackRequired: false }
  | { success: false; data?: never; fallbackRequired: true; error: string };

export interface PrizeHistoryEntryDto {
  poolId: number;
  cycleId: number;
  winnerIndex: number;
  winnerAddress: string;
  tierIndex: number;
  amountOwed: string;
  winningTicketIdx: string | null;
  processed: boolean;
  bondsBought: string;
  dustAccumulated: string;
  claimSignature: string | null;
  revealedAt: number;
  vrfSeedHex?: string | null;
}

export function toPrizeHistoryEntryDto(
  row: typeof drawWinners.$inferSelect,
  vrfSeedHex?: string | null
): PrizeHistoryEntryDto {
  return {
    poolId: row.poolId,
    cycleId: row.cycleId,
    winnerIndex: row.winnerIndex,
    winnerAddress: row.winnerAddress,
    tierIndex: row.tierIndex,
    amountOwed: row.amountOwed.toString(),
    winningTicketIdx:
      row.winningTicketIdx != null ? row.winningTicketIdx.toString() : null,
    processed: row.processed,
    bondsBought: row.bondsBought.toString(),
    dustAccumulated: row.dustAccumulated.toString(),
    claimSignature: row.claimSignature,
    revealedAt: row.revealedAt,
    vrfSeedHex: vrfSeedHex ?? null,
  };
}

/** Helper to safely parse string or numeric base units/counts to finite numbers */
export function parseNumericBaseUnits(
  val: string | number | null | undefined
): number {
  if (val === null || val === undefined || val === "") return 0;
  const num = typeof val === "number" ? val : Number(val);
  return Number.isFinite(num) && num >= 0 ? num : 0;
}

export function mapDtoToPrizeHistoryEntry(
  dto: PrizeHistoryEntryDto
): import("../types").PrizeHistoryEntry {
  const bondsBoughtNum = parseNumericBaseUnits(dto.bondsBought);
  const dustAccumulatedNum = parseNumericBaseUnits(dto.dustAccumulated);
  const amountNum = parseNumericBaseUnits(dto.amountOwed);
  const hasRevealedAt =
    typeof dto.revealedAt === "number" && dto.revealedAt > 0;

  return {
    drawCycleId: dto.cycleId,
    winnerIndex: dto.winnerIndex,
    date: hasRevealedAt
      ? new Date(dto.revealedAt * 1000).toISOString()
      : new Date(0).toISOString(),
    tierIndex: dto.tierIndex,
    amount: amountNum,
    status: dto.processed ? "reinvested" : "processing",
    bondsBought: bondsBoughtNum > 0 ? bondsBoughtNum : undefined,
    reinvestedTickets: bondsBoughtNum > 0 ? bondsBoughtNum : undefined,
    dustAccumulated: dustAccumulatedNum > 0 ? dustAccumulatedNum : undefined,
    winningTicket: dto.winningTicketIdx ?? undefined,
    txSignature: dto.claimSignature ?? undefined,
    vrfSeed: dto.vrfSeedHex ?? undefined,
    revealedAt: hasRevealedAt ? dto.revealedAt : undefined,
  };
}

export function mapDtoToRecentWinner(
  dto: PrizeHistoryEntryDto,
  tokenSymbol: string = "USDC"
): import("../types").RecentWinner {
  return {
    address: dto.winnerAddress,
    amount: parseNumericBaseUnits(dto.amountOwed),
    cycleId: dto.cycleId,
    tierIndex: dto.tierIndex,
    tokenSymbol,
  };
}

export interface PendingRedemptionDto {
  poolId: number;
  redemptionId: string;
  userAddress: string;
  redemptionType: string;
  amountUsdc: string;
  pstSharesLocked: string | null;
  humaRequestId: string | null;
  status: string;
  requestSignature: string;
  claimSignature: string | null;
  requestedAt: number;
  claimedAt: number | null;
}

export function toPendingRedemptionDto(
  row: typeof pendingRedemptions.$inferSelect
): PendingRedemptionDto {
  return {
    poolId: row.poolId,
    redemptionId: row.redemptionId.toString(),
    userAddress: row.userAddress,
    redemptionType: row.redemptionType,
    amountUsdc: row.amountUsdc.toString(),
    pstSharesLocked:
      row.pstSharesLocked != null ? row.pstSharesLocked.toString() : null,
    humaRequestId: row.humaRequestId != null ? row.humaRequestId : null,
    status: row.status,
    requestSignature: row.requestSignature,
    claimSignature: row.claimSignature,
    requestedAt: row.requestedAt,
    claimedAt: row.claimedAt,
  };
}

export function mapDtoToPendingRedemption(
  dto: PendingRedemptionDto
): import("../types").PendingRedemption {
  return {
    redemptionId: dto.redemptionId,
    amount: Number(dto.amountUsdc),
    status: dto.status === "ready" ? "ready" : "settling",
    requestedAt: new Date(dto.requestedAt * 1000).toISOString(),
    type:
      (dto.redemptionType as import("../types").PendingRedemption["type"]) ||
      "bond_sale",
    pstSharesLocked: dto.pstSharesLocked ?? undefined,
    humaRequestId: dto.humaRequestId ?? undefined,
  };
}

export interface DrawHistoryDto {
  poolId: number;
  cycleId: number;
  status: string;
  prizePot: string;
  cycleFeeCollected: string;
  lockedTicketCount: string;
  harvestSlot: number;
  randomnessAccount: string;
  vrfSeedHex: string;
  winnersCount: number;
  totalDistributed: string;
  winnersSynced: boolean;
  initiatedAt: number;
  revealedAt: number | null;
  completedAt: number | null;
  signature: string;
  blockTime: number;
}

export function toDrawHistoryDto(
  row: typeof drawHistory.$inferSelect
): DrawHistoryDto {
  return {
    poolId: row.poolId,
    cycleId: row.cycleId,
    status: row.status,
    prizePot: row.prizePot.toString(),
    cycleFeeCollected: row.cycleFeeCollected.toString(),
    lockedTicketCount: row.lockedTicketCount.toString(),
    harvestSlot: row.harvestSlot,
    randomnessAccount: row.randomnessAccount,
    vrfSeedHex: row.vrfSeedHex,
    winnersCount: row.winnersCount,
    totalDistributed: row.totalDistributed.toString(),
    winnersSynced: row.winnersSynced,
    initiatedAt:
      row.initiatedAt && row.initiatedAt > 0 ? row.initiatedAt : row.blockTime,
    revealedAt: row.revealedAt,
    completedAt: row.completedAt,
    signature: row.signature,
    blockTime: row.blockTime,
  };
}

export interface PoolSnapshotDto {
  poolId: number;
  cycleId: number;
  snapshotTime: number;
  totalDepositedPrincipal: string;
  totalFeesAccrued: string;
  totalFeesWithdrawn: string;
  totalPrizesDistributed: string;
  rawYield: string;
  prizePot: string;
  feeCollected: string;
  lockedTicketCount: string;
  effectiveApy: string | null;
}

export function toPoolSnapshotDto(
  row: typeof poolSnapshots.$inferSelect
): PoolSnapshotDto {
  return {
    poolId: row.poolId,
    cycleId: row.cycleId,
    snapshotTime: Number(row.snapshotTime),
    totalDepositedPrincipal: row.totalDepositedPrincipal.toString(),
    totalFeesAccrued: row.totalFeesAccrued.toString(),
    totalFeesWithdrawn: row.totalFeesWithdrawn.toString(),
    totalPrizesDistributed: row.totalPrizesDistributed.toString(),
    rawYield: row.rawYield.toString(),
    prizePot: row.prizePot.toString(),
    feeCollected: row.feeCollected.toString(),
    lockedTicketCount: row.lockedTicketCount.toString(),
    effectiveApy: row.effectiveApy,
  };
}

export interface UserPortfolioStatsDto {
  poolId: number;
  userAddress: string;
  activeBonds: string;
  totalDepositedUsdc: string;
  totalWithdrawnUsdc: string;
  totalWonUsdc: string;
  totalClaimedUsdc: string;
  totalReinvestedUsdc: string;
  winCount: number;
  depositCount: number;
  withdrawCount: number;
  firstActivityAt: number;
  lastActivityAt: number;
}

export function toUserPortfolioStatsDto(
  row: typeof userPortfolioStats.$inferSelect
): UserPortfolioStatsDto {
  return {
    poolId: row.poolId,
    userAddress: row.userAddress,
    activeBonds: row.activeBonds.toString(),
    totalDepositedUsdc: row.totalDepositedUsdc.toString(),
    totalWithdrawnUsdc: row.totalWithdrawnUsdc.toString(),
    totalWonUsdc: row.totalWonUsdc.toString(),
    totalClaimedUsdc: row.totalClaimedUsdc.toString(),
    totalReinvestedUsdc: row.totalReinvestedUsdc.toString(),
    winCount: row.winCount,
    depositCount: row.depositCount,
    withdrawCount: row.withdrawCount,
    firstActivityAt: row.firstActivityAt,
    lastActivityAt: row.lastActivityAt,
  };
}

export interface DrawCycleSummaryDto {
  poolId: number;
  cycleId: number;
  status: DrawStatusName;
  prizePot: number;
  cycleFeeCollected: number;
  lockedTicketCount: number;
  harvestSlot: number;
  randomnessAccount: string;
  vrfSeedHex: string;
  winnersCount: number;
  payoutsCompleted: number;
  hasPayoutRegistry: boolean;
  completedAt?: number;
  initiatedAt: number;
  revealedAt?: number;
}

export function isTerminalDrawStatus(status: string): boolean {
  return (
    status === "Complete" ||
    status === "Skipped" ||
    status === "Voided" ||
    status === "ForceUnlocked"
  );
}

export function mapDrawHistoryRowsToSummaries(
  rows: (typeof drawHistory.$inferSelect & {
    payoutsCompleted?: number | null;
  })[]
): DrawCycleSummaryDto[] {
  return rows.map((r) => {
    const rawPayouts = Number(r.payoutsCompleted ?? 0);
    const payoutsCompleted = Math.min(Math.max(0, rawPayouts), r.winnersCount);

    return {
      poolId: r.poolId,
      cycleId: r.cycleId,
      status: r.status as DrawStatusName,
      prizePot: Number(r.prizePot),
      cycleFeeCollected: Number(r.cycleFeeCollected ?? 0n),
      lockedTicketCount: Number(r.lockedTicketCount ?? 0n),
      harvestSlot: Number(r.harvestSlot ?? 0),
      randomnessAccount: r.randomnessAccount || "",
      vrfSeedHex: r.vrfSeedHex || "",
      winnersCount: r.winnersCount,
      payoutsCompleted,
      hasPayoutRegistry: r.winnersCount > 0,
      completedAt: isTerminalDrawStatus(r.status)
        ? (r.completedAt ?? r.blockTime)
        : undefined,
      initiatedAt:
        r.initiatedAt && r.initiatedAt > 0 ? r.initiatedAt : r.blockTime,
      revealedAt: r.revealedAt ?? undefined,
    };
  });
}

export function calculateDrawHistoryStats(
  summaries: DrawCycleSummaryDto[]
): DrawHistoryStats {
  let totalYield = 0;
  let completedDraws = 0;
  let totalWinningBonds = 0;

  for (const s of summaries) {
    if (s.status === "Complete") {
      completedDraws++;
      totalYield += s.prizePot;
      totalWinningBonds += s.winnersCount;
    }
  }

  return {
    totalYieldDistributed: totalYield,
    totalDrawsCompleted: completedDraws,
    totalWinningBonds,
    averagePrizePot: completedDraws > 0 ? totalYield / completedDraws : 0,
  };
}
