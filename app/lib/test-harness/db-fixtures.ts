import type {
  drawHistory,
  pendingRedemptions,
  bondsActivity,
  drawWinners,
} from "@/app/lib/db/schema";
import { TEST_ADDRESSES } from "./addresses";

export function buildMockDrawHistoryRow(
  overrides: Partial<typeof drawHistory.$inferSelect> = {}
): typeof drawHistory.$inferSelect {
  return {
    poolId: 1,
    cycleId: 1,
    status: "Complete",
    prizePot: 100_000_000n,
    cycleFeeCollected: 5_000_000n,
    lockedTicketCount: 500n,
    harvestSlot: 123456,
    randomnessAccount: TEST_ADDRESSES.USER.toString(),
    vrfSeedHex:
      "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
    winnersCount: 8,
    totalDistributed: 0n,
    winnersSynced: true,
    initiatedAt: 1772500000,
    revealedAt: 1772500300,
    completedAt: 1772500600,
    signature:
      "Sig1111111111111111111111111111111111111111111111111111111111111111",
    blockTime: 1772500000,
    createdAt: new Date(1772500000000),
    ...overrides,
  };
}

export function buildMockDrawPayoutProgressRow(
  overrides: Partial<
    typeof drawHistory.$inferSelect & { payoutsCompleted?: number }
  > = {}
): typeof drawHistory.$inferSelect & { payoutsCompleted: number } {
  return {
    ...buildMockDrawHistoryRow(overrides),
    payoutsCompleted: overrides.payoutsCompleted ?? 0,
  };
}

export function buildMockPendingRedemptionRow(
  overrides: Partial<typeof pendingRedemptions.$inferSelect> = {}
): typeof pendingRedemptions.$inferSelect {
  return {
    poolId: 1,
    redemptionId: 100n,
    userAddress: TEST_ADDRESSES.USER.toString(),
    redemptionType: "bond_sale",
    amountUsdc: 1_000_000n,
    pstSharesLocked: 500_000n,
    humaRequestId: "1180591620717411303424",
    status: "ready",
    requestSignature: "sig1",
    claimSignature: null,
    requestedAt: 1700000000,
    claimedAt: null,
    createdAt: new Date(1700000000000),
    ...overrides,
  };
}

export function buildMockBondsActivityRow(
  overrides: Partial<typeof bondsActivity.$inferSelect> = {}
): typeof bondsActivity.$inferSelect {
  return {
    id: 1,
    signature:
      "Sig1111111111111111111111111111111111111111111111111111111111111111",
    eventIndex: 0,
    userAddress: TEST_ADDRESSES.USER.toString(),
    poolId: 1,
    activityType: "deposit",
    bonds: 10,
    amountUsdc: 10_000_000n,
    redemptionId: null,
    cycleId: 1,
    blockTime: 1700000000,
    createdAt: new Date(1700000000000),
    ...overrides,
  };
}

export function buildMockDrawWinnersRow(
  overrides: Partial<typeof drawWinners.$inferSelect> = {}
): typeof drawWinners.$inferSelect {
  return {
    poolId: 1,
    cycleId: 1,
    winnerIndex: 0,
    winnerAddress: TEST_ADDRESSES.USER.toString(),
    tierIndex: 0,
    amountOwed: 50_000_000n,
    winningTicketIdx: 123n,
    processed: false,
    bondsBought: 0n,
    dustAccumulated: 0n,
    claimSignature: null,
    revealedAt: 1700000000,
    createdAt: new Date(1700000000000),
    ...overrides,
  };
}
