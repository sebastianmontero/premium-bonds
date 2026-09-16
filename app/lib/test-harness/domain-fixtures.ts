import type {
  PoolInfo,
  PrizeHistoryEntry,
  PendingRedemption,
} from "@/app/types";
import { TEST_ADDRESSES } from "./addresses";

export function buildMockPoolInfo(overrides: Partial<PoolInfo> = {}): PoolInfo {
  return {
    poolId: 1,
    tokenMint: TEST_ADDRESSES.MINT.toString(),
    tokenSymbol: "USDC",
    tokenDecimals: 6,
    bondPrice: 1_000_000,
    stakeCycleDurationHrs: 24,
    feeBasisPoints: 250,
    status: "Active",
    totalDepositedPrincipal: 50_000_000,
    currentCycleEndAt: 1700086400,
    isFrozenForDraw: false,
    currentDrawCycleId: 1,
    prizeTiers: [],
    estimatedPrizePot: 500_000,
    minYieldThreshold: 5_000_000,
    underlyingApy: 0.085,
    lastSyncedAt: 1700000000,
    totalUsers: 10,
    totalPrizesDistributed: undefined,
    ...overrides,
  };
}

export function buildMockPrizeHistoryEntry(
  overrides: Partial<PrizeHistoryEntry> = {}
): PrizeHistoryEntry {
  return {
    drawCycleId: 1,
    winnerIndex: 0,
    tierIndex: 0,
    amount: 100_000_000,
    status: "processing",
    date: "2026-09-01T12:00:00.000Z",
    bondsBought: 0,
    ...overrides,
  };
}

export function buildMockPendingRedemption(
  overrides: Partial<PendingRedemption> = {}
): PendingRedemption {
  return {
    redemptionId: "100",
    amount: 1_000_000,
    status: "ready",
    requestedAt: "2026-09-01T12:00:00.000Z",
    type: "bond_sale",
    pstSharesLocked: "500000",
    humaRequestId: "1180591620717411303424",
    ...overrides,
  };
}
