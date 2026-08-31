import {
  drawWinners,
  pendingRedemptions,
  drawHistory,
  poolSnapshots,
  userPortfolioStats,
} from "./db/schema";

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
}

export function toPrizeHistoryEntryDto(
  row: typeof drawWinners.$inferSelect
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
  initiatedAt: number | null;
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
    initiatedAt: row.initiatedAt,
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
