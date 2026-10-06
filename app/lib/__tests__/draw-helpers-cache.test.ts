import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { QueryClient } from "@tanstack/react-query";
import {
  resolveActivePrizeEntry,
  patchOptimisticPrizeInCache,
  calculateReinvestmentBreakdown,
  buildDrawStatusOptions,
  resolveEffectiveDrawStats,
  type UserPrizeLedgerCacheData,
} from "../draw-helpers";
import { bondsKeys } from "../query-keys";
import type { PrizeHistoryEntry, DrawHistoryStats } from "../../types";

const mockEntryProcessing: PrizeHistoryEntry = {
  drawCycleId: 10,
  winnerIndex: 0,
  date: "2026-10-01T12:00:00Z",
  tierIndex: 0,
  amount: 5_000_000,
  winningTicket: "1001",
  status: "processing",
  bondsBought: 0,
  usedPriorDust: 0,
  dustAccumulated: 0,
};

const mockEntryReinvested: PrizeHistoryEntry = {
  ...mockEntryProcessing,
  status: "reinvested",
  bondsBought: 1,
  reinvestedTickets: 1,
  txSignature: "5abc123ConfirmedSignature",
};

describe("resolveActivePrizeEntry SSoT Helper Suite", () => {
  const poolId = 1;
  const userAddress = "7Xb123UserAddress";

  it("returns null when userAddress is undefined or coordinates are missing", () => {
    const queryClient = new QueryClient();

    const resultNoUser = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress: undefined,
      entry: mockEntryProcessing,
    });
    assert.strictEqual(resultNoUser, null);

    const resultNoEntryNoCoords = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      entry: null,
    });
    assert.strictEqual(resultNoEntryNoCoords, null);

    const resultPartialCoords = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      drawCycleId: 10,
      // winnerIndex missing
    });
    assert.strictEqual(resultPartialCoords, null);
  });

  it("resolves active prize entry with drawCycleId: 0 and winnerIndex: 0 correctly (index 0 truthiness)", () => {
    const queryClient = new QueryClient();
    const zeroZeroEntry: PrizeHistoryEntry = {
      ...mockEntryProcessing,
      drawCycleId: 0,
      winnerIndex: 0,
    };
    const activeHistory: PrizeHistoryEntry[] = [zeroZeroEntry];

    const result = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      drawCycleId: 0,
      winnerIndex: 0,
      activeHistory,
    });

    assert.deepEqual(result, zeroZeroEntry);
    assert.strictEqual(result?.drawCycleId, 0);
    assert.strictEqual(result?.winnerIndex, 0);
  });

  it("returns live entry from activeHistory when matching entry is found", () => {
    const queryClient = new QueryClient();
    const activeHistory: PrizeHistoryEntry[] = [mockEntryReinvested];

    const result = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      entry: mockEntryProcessing,
      activeHistory,
    });

    assert.deepEqual(result, mockEntryReinvested);
    assert.strictEqual(result?.status, "reinvested");
    assert.strictEqual(result?.bondsBought, 1);
  });

  it("resolves via explicit coordinates against paginated query cache when entry is null", () => {
    const queryClient = new QueryClient();
    const paginatedLedgerData: UserPrizeLedgerCacheData = {
      entries: [mockEntryReinvested],
      pagination: {
        page: 2,
        pageSize: 10,
        totalCount: 20,
        totalPages: 2,
        hasNextPage: false,
        hasPreviousPage: true,
      },
      aggregates: { totalFilteredValue: "5000000" },
    };

    // Populate paginated query cache
    queryClient.setQueryData(
      bondsKeys.userPrizeLedger(poolId, userAddress, {
        page: 2,
        pageSize: 10,
        status: "all",
        search: "",
      }),
      paginatedLedgerData
    );

    const result = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      drawCycleId: 10,
      winnerIndex: 0,
      activeHistory: [],
    });

    assert.deepEqual(result, mockEntryReinvested);
    assert.strictEqual(result?.status, "reinvested");
  });

  it("prioritizes query cache over stale entry snapshot (SSoT priority)", () => {
    const queryClient = new QueryClient();
    // Cache has reinvested state
    queryClient.setQueryData<PrizeHistoryEntry[]>(
      bondsKeys.userPrizeHistory(poolId, userAddress),
      [mockEntryReinvested]
    );

    // Caller passes stale processing snapshot
    const result = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      entry: mockEntryProcessing,
      activeHistory: [],
    });

    assert.deepEqual(result, mockEntryReinvested);
    assert.strictEqual(result?.status, "reinvested");
    assert.strictEqual(result?.bondsBought, 1);
  });

  it("falls back to entry snapshot when query cache is unpopulated and coordinates match", () => {
    const queryClient = new QueryClient();

    const result = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      entry: mockEntryProcessing,
      activeHistory: [],
    });

    assert.deepEqual(result, mockEntryProcessing);
    assert.strictEqual(result?.status, "processing");
  });

  it("rejects mismatched entry snapshot if explicit coordinates differ", () => {
    const queryClient = new QueryClient();

    // Explicit coordinates point to draw 11, winner 1; snapshot is draw 10, winner 0
    const result = resolveActivePrizeEntry({
      queryClient,
      poolId,
      userAddress,
      drawCycleId: 11,
      winnerIndex: 1,
      entry: mockEntryProcessing, // drawCycleId: 10, winnerIndex: 0
      activeHistory: [],
    });

    assert.strictEqual(result, null);
  });
});

describe("patchOptimisticPrizeInCache with txSignature Suite", () => {
  const poolId = 1;
  const userAddress = "7Xb123UserAddress";

  it("patches both userPrizeHistory and userPrizeLedgerRoot with status, bondsBought, and confirmed txSignature", () => {
    const queryClient = new QueryClient();

    // 1. Seed unpaginated top-50 cache
    queryClient.setQueryData<PrizeHistoryEntry[]>(
      bondsKeys.userPrizeHistory(poolId, userAddress),
      [mockEntryProcessing]
    );

    // 2. Seed paginated ledger root query
    const paginatedLedgerData: UserPrizeLedgerCacheData = {
      entries: [mockEntryProcessing],
      pagination: {
        page: 1,
        pageSize: 10,
        totalCount: 1,
        totalPages: 1,
        hasNextPage: false,
        hasPreviousPage: false,
      },
      aggregates: { totalFilteredValue: "5000000" },
    };
    queryClient.setQueryData(
      bondsKeys.userPrizeLedger(poolId, userAddress, {
        page: 1,
        pageSize: 10,
        status: "all",
        search: "",
      }),
      paginatedLedgerData
    );

    // 3. Apply patch with confirmed transaction signature
    const breakdown = calculateReinvestmentBreakdown(5_000_000, 0, 5_000_000);
    const confirmedTxSignature = "4ConfirmedTxSignatureXYZ789";

    patchOptimisticPrizeInCache({
      queryClient,
      poolId,
      userAddress,
      drawCycleId: 10,
      winnerIndex: 0,
      breakdown,
      txSignature: confirmedTxSignature,
    });

    // 4. Assert unpaginated history cache is updated
    const updatedHistory = queryClient.getQueryData<PrizeHistoryEntry[]>(
      bondsKeys.userPrizeHistory(poolId, userAddress)
    );
    assert.ok(updatedHistory);
    assert.strictEqual(updatedHistory.length, 1);
    assert.strictEqual(updatedHistory[0].status, "reinvested");
    assert.strictEqual(updatedHistory[0].bondsBought, 1);
    assert.strictEqual(updatedHistory[0].txSignature, confirmedTxSignature);

    // 5. Assert paginated ledger cache is updated
    const updatedLedger = queryClient.getQueryData<UserPrizeLedgerCacheData>(
      bondsKeys.userPrizeLedger(poolId, userAddress, {
        page: 1,
        pageSize: 10,
        status: "all",
        search: "",
      })
    );
    assert.ok(updatedLedger);
    assert.strictEqual(updatedLedger.entries.length, 1);
    assert.strictEqual(updatedLedger.entries[0].status, "reinvested");
    assert.strictEqual(updatedLedger.entries[0].bondsBought, 1);
    assert.strictEqual(
      updatedLedger.entries[0].txSignature,
      confirmedTxSignature
    );
  });
});

describe("buildDrawStatusOptions Suite", () => {
  const mockT = (key: string) => key;

  it("returns fallback 'all' option without count when statusCounts is undefined (loading / unavailable)", () => {
    const options = buildDrawStatusOptions({
      statusCounts: undefined,
      currentFilter: "all",
      t: mockT,
    });

    assert.strictEqual(options.length, 1);
    assert.strictEqual(options[0].value, "all");
    assert.strictEqual(options[0].label, "allStatuses");
  });

  it("preserves deep-linked active filter without count badge when statusCounts is undefined", () => {
    const options = buildDrawStatusOptions({
      statusCounts: undefined,
      currentFilter: "Skipped",
      t: mockT,
    });

    assert.strictEqual(options.length, 2);
    assert.strictEqual(options[0].value, "all");
    assert.strictEqual(options[0].label, "allStatuses");
    assert.strictEqual(options[1].value, "Skipped");
    assert.strictEqual(options[1].label, "statusSkipped");
  });

  it("formats count badges when statusCounts is provided and filters out zero-count non-selected statuses", () => {
    const options = buildDrawStatusOptions({
      statusCounts: {
        Complete: 5,
        Skipped: 2,
      },
      currentFilter: "all",
      t: mockT,
    });

    assert.strictEqual(options[0].value, "all");
    assert.strictEqual(options[0].label, "allStatuses\u00A0(7)");

    const completeOpt = options.find((o) => o.value === "Complete");
    assert.ok(completeOpt);
    assert.strictEqual(completeOpt.label, "statusComplete\u00A0(5)");

    const skippedOpt = options.find((o) => o.value === "Skipped");
    assert.ok(skippedOpt);
    assert.strictEqual(skippedOpt.label, "statusSkipped\u00A0(2)");

    // Statuses with 0 count that are not selected should be omitted
    const awaitingVrfOpt = options.find((o) => o.value === "AwaitingVRF");
    assert.strictEqual(awaitingVrfOpt, undefined);
  });

  it("preserves active filter option even if count is 0", () => {
    const options = buildDrawStatusOptions({
      statusCounts: {
        Complete: 5,
      },
      currentFilter: "Skipped",
      t: mockT,
    });

    const skippedOpt = options.find((o) => o.value === "Skipped");
    assert.ok(skippedOpt);
    assert.strictEqual(skippedOpt.label, "statusSkipped\u00A0(0)");
  });
});

describe("resolveEffectiveDrawStats Suite", () => {
  it("returns null when stats is null/undefined and onChainTotalPrizes is 0 or missing", () => {
    assert.strictEqual(resolveEffectiveDrawStats(null, undefined), null);
    assert.strictEqual(resolveEffectiveDrawStats(undefined, undefined), null);
    assert.strictEqual(resolveEffectiveDrawStats(null, 0), null);
    assert.strictEqual(resolveEffectiveDrawStats(null, 0n), null);
  });

  it("returns on-chain total prizes with undefined for missing metrics (never zero) when stats is null and onChainTotalPrizes is positive", () => {
    const result = resolveEffectiveDrawStats(null, 10_000_000);
    assert.ok(result);
    assert.strictEqual(result.totalYieldDistributed, 10_000_000);
    assert.strictEqual(result.totalDrawsCompleted, undefined);
    assert.strictEqual(result.totalWinningBonds, undefined);
    assert.strictEqual(result.averagePrizePot, undefined);
    assert.strictEqual(result.statusCounts, undefined);
  });

  it("handles bigint onChainTotalPrizes correctly", () => {
    const result = resolveEffectiveDrawStats(null, 25_000_000n);
    assert.ok(result);
    assert.strictEqual(result.totalYieldDistributed, 25_000_000);
    assert.strictEqual(result.totalDrawsCompleted, undefined);
  });

  it("prioritizes indexer stats when available and retains complete metrics", () => {
    const indexerStats: DrawHistoryStats = {
      totalYieldDistributed: 50_000_000,
      totalDrawsCompleted: 5,
      totalWinningBonds: 12,
      averagePrizePot: 10_000_000,
      statusCounts: { Complete: 5 },
    };

    const result = resolveEffectiveDrawStats(indexerStats, 45_000_000);
    assert.ok(result);
    assert.strictEqual(result.totalYieldDistributed, 50_000_000);
    assert.strictEqual(result.totalDrawsCompleted, 5);
    assert.strictEqual(result.totalWinningBonds, 12);
    assert.strictEqual(result.averagePrizePot, 10_000_000);
    assert.deepStrictEqual(result.statusCounts, { Complete: 5 });
  });

  it("preserves confirmed genuine 0 values when indexer stats return 0 completed draws", () => {
    const freshStats: DrawHistoryStats = {
      totalYieldDistributed: 0,
      totalDrawsCompleted: 0,
      totalWinningBonds: 0,
      averagePrizePot: 0,
      statusCounts: {},
    };

    const result = resolveEffectiveDrawStats(freshStats, 0);
    assert.ok(result);
    assert.strictEqual(result.totalYieldDistributed, 0);
    assert.strictEqual(result.totalDrawsCompleted, 0);
    assert.strictEqual(result.totalWinningBonds, 0);
    assert.strictEqual(result.averagePrizePot, 0);
  });
});

describe("bondsKeys.isSamePool Suite", () => {
  it("returns true when queryKey belongs to the specified pool", () => {
    const listKey = bondsKeys.drawsList(1, { page: 1 });
    assert.strictEqual(bondsKeys.isSamePool(listKey, 1), true);

    const stateKey = bondsKeys.poolState(1);
    assert.strictEqual(bondsKeys.isSamePool(stateKey, 1), true);
  });

  it("returns false when queryKey belongs to a different pool", () => {
    const listKey = bondsKeys.drawsList(2, { page: 1 });
    assert.strictEqual(bondsKeys.isSamePool(listKey, 1), false);
  });

  it("returns false when queryKey is undefined or invalid", () => {
    assert.strictEqual(bondsKeys.isSamePool(undefined, 1), false);
    assert.strictEqual(bondsKeys.isSamePool([], 1), false);
    assert.strictEqual(bondsKeys.isSamePool(["yield-bonds"], 1), false);
  });
});
