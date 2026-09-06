import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PoolStatsAggregator,
  type DbAggregationClient,
  type PoolFetchOptions,
} from "@/app/lib/services/pool-stats-aggregator";
import type { PoolInfo } from "@/app/types";

function createMockPoolInfo(poolId: number = 1): PoolInfo {
  return {
    poolId,
    tokenMint: "TokenMint1111111111111111111111111111111111",
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
  };
}

describe("PoolStatsAggregator Unit Tests", () => {
  it("should return undefined immediately when isConfigured is false", async () => {
    let dbCalls = 0;
    const mockDb: DbAggregationClient = {
      select: () => {
        dbCalls++;
        return {
          from: () => ({
            where: () => Promise.resolve([]),
          }),
        };
      },
    };

    const aggregator = new PoolStatsAggregator(mockDb, false);
    const result = await aggregator.getPoolDrawStats(1);

    assert.strictEqual(result, undefined);
    assert.strictEqual(
      dbCalls,
      0,
      "Database should not be called when unconfigured"
    );
  });

  it("should return undefined for invalid poolId inputs", async () => {
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([]),
        }),
      }),
    };
    const aggregator = new PoolStatsAggregator(mockDb, true);
    assert.strictEqual(await aggregator.getPoolDrawStats(0), undefined);
    assert.strictEqual(await aggregator.getPoolDrawStats(-1), undefined);
    assert.strictEqual(await aggregator.getPoolDrawStats(1.5), undefined);
    assert.strictEqual(await aggregator.getPoolDrawStats(NaN), undefined);
  });

  it("should query database, parse all aggregate fields, and cache result on success", async () => {
    let queryCount = 0;
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => {
            queryCount++;
            return [
              {
                totalDistributed: "15500000",
                totalDrawsCompleted: 2,
                totalWinningBonds: 10,
              },
            ];
          },
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);

    // Initial query
    const res1 = await aggregator.getPoolDrawStats(1);
    assert.deepStrictEqual(res1, {
      totalYieldDistributed: 15_500_000,
      totalDrawsCompleted: 2,
      totalWinningBonds: 10,
      averagePrizePot: 7_750_000,
    });
    assert.strictEqual(queryCount, 1);

    // Subsequent query within TTL should serve from cache
    const res2 = await aggregator.getPoolDrawStats(1);
    assert.deepStrictEqual(res2, res1);
    assert.strictEqual(
      queryCount,
      1,
      "Should serve from cache without re-querying"
    );

    // Cumulative prizes projection should return totalYieldDistributed
    const cumulative = await aggregator.getCumulativePrizes(1);
    assert.strictEqual(cumulative, 15_500_000);
    assert.strictEqual(queryCount, 1, "Cumulative helper should also use cache");
  });

  it("should bypass cache and re-query database when bypassCache: true is passed", async () => {
    let queryCount = 0;
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => {
            queryCount++;
            return [
              {
                totalDistributed: (queryCount * 10_000_000).toString(),
                totalDrawsCompleted: queryCount,
                totalWinningBonds: queryCount * 5,
              },
            ];
          },
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);

    // First call populates cache with 10_000_000
    const res1 = await aggregator.getPoolDrawStats(1);
    assert.strictEqual(res1?.totalYieldDistributed, 10_000_000);
    assert.strictEqual(queryCount, 1);

    // Normal call uses cache
    const cachedRes = await aggregator.getPoolDrawStats(1);
    assert.strictEqual(cachedRes?.totalYieldDistributed, 10_000_000);
    assert.strictEqual(queryCount, 1);

    // Call with bypassCache: true forces DB query and returns updated total
    const bypassedRes = await aggregator.getPoolDrawStats(1, {
      bypassCache: true,
    });
    assert.strictEqual(bypassedRes?.totalYieldDistributed, 20_000_000);
    assert.strictEqual(bypassedRes?.totalDrawsCompleted, 2);
    assert.strictEqual(bypassedRes?.averagePrizePot, 10_000_000);
    assert.strictEqual(queryCount, 2);
  });

  it("should handle null or non-numeric totals by defaulting to 0", async () => {
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              totalDistributed: null,
              totalDrawsCompleted: null,
              totalWinningBonds: null,
            },
          ],
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);
    const res = await aggregator.getPoolDrawStats(1);
    assert.deepStrictEqual(res, {
      totalYieldDistributed: 0,
      totalDrawsCompleted: 0,
      totalWinningBonds: 0,
      averagePrizePot: 0,
    });
  });

  it("should deduplicate concurrent in-flight database requests", async () => {
    let queryCount = 0;
    let resolveQuery: (
      val: Array<{
        totalDistributed: string | null;
        totalDrawsCompleted: number | null;
        totalWinningBonds: number | null;
      }>
    ) => void;
    const queryPromise = new Promise<
      Array<{
        totalDistributed: string | null;
        totalDrawsCompleted: number | null;
        totalWinningBonds: number | null;
      }>
    >((resolve) => {
      resolveQuery = resolve;
    });

    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: () => {
            queryCount++;
            return queryPromise;
          },
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);

    const call1 = aggregator.getPoolDrawStats(1);
    const call2 = aggregator.getPoolDrawStats(1);
    const call3 = aggregator.getPoolDrawStats(1);

    assert.strictEqual(
      queryCount,
      1,
      "Only 1 in-flight query should be dispatched"
    );

    resolveQuery!([
      {
        totalDistributed: "42000000",
        totalDrawsCompleted: 4,
        totalWinningBonds: 20,
      },
    ]);
    const [r1, r2, r3] = await Promise.all([call1, call2, call3]);

    assert.strictEqual(r1?.totalYieldDistributed, 42_000_000);
    assert.strictEqual(r2?.totalYieldDistributed, 42_000_000);
    assert.strictEqual(r3?.totalYieldDistributed, 42_000_000);
    assert.strictEqual(queryCount, 1);
  });

  it("should fallback to stale cache and extend cooldown when query fails", async () => {
    let shouldFail = false;
    let queryCount = 0;

    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => {
            queryCount++;
            if (shouldFail) {
              throw new Error("PostgreSQL connection lost");
            }
            return [
              {
                totalDistributed: "10000000",
                totalDrawsCompleted: 1,
                totalWinningBonds: 5,
              },
            ];
          },
        }),
      }),
    };

    // Use short TTL (10ms) and short retry backoff (100ms) for testing
    const aggregator = new PoolStatsAggregator(
      mockDb,
      true,
      undefined,
      10, // ttlMs
      100 // errorRetryMs
    );

    // 1. Initial success
    const res1 = await aggregator.getPoolDrawStats(1);
    assert.strictEqual(res1?.totalYieldDistributed, 10_000_000);
    assert.strictEqual(queryCount, 1);

    // Wait for TTL to expire
    await new Promise((r) => setTimeout(r, 15));

    // 2. Make query fail
    shouldFail = true;
    const res2 = await aggregator.getPoolDrawStats(1);
    assert.strictEqual(
      res2?.totalYieldDistributed,
      10_000_000,
      "Should return stale cached value on failure"
    );
    assert.strictEqual(queryCount, 2);

    // 3. Subsequent request during error cooldown should NOT hit DB again
    const res3 = await aggregator.getPoolDrawStats(1);
    assert.strictEqual(
      res3?.totalYieldDistributed,
      10_000_000,
      "Should serve stale cache during error cooldown"
    );
    assert.strictEqual(
      queryCount,
      2,
      "DB should not be queried during cooldown"
    );
  });

  it("should return undefined when query fails and no prior cache exists", async () => {
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => {
            throw new Error("DB timeout");
          },
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);
    const res = await aggregator.getPoolDrawStats(1);
    assert.strictEqual(res, undefined);
  });

  it("should properly invalidate cache for specific pool and all pools", async () => {
    let queryCount = 0;
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => {
            queryCount++;
            return [
              {
                totalDistributed: "5000000",
                totalDrawsCompleted: 1,
                totalWinningBonds: 2,
              },
            ];
          },
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);

    await aggregator.getPoolDrawStats(1);
    await aggregator.getPoolDrawStats(2);
    assert.strictEqual(queryCount, 2);

    // Invalidate pool 1 only
    aggregator.invalidatePoolStats(1);
    await aggregator.getPoolDrawStats(1);
    assert.strictEqual(queryCount, 3, "Pool 1 should be re-queried");

    await aggregator.getPoolDrawStats(2);
    assert.strictEqual(queryCount, 3, "Pool 2 should still be cached");

    // Invalidate all
    aggregator.invalidatePoolStats();
    await aggregator.getPoolDrawStats(2);
    assert.strictEqual(
      queryCount,
      4,
      "Pool 2 should be re-queried after full cache clear"
    );
  });

  it("should compose getEnrichedPoolInfo immutably with cumulative prizes", async () => {
    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => [
            {
              totalDistributed: "25000000",
              totalDrawsCompleted: 5,
              totalWinningBonds: 20,
            },
          ],
        }),
      }),
    };

    const basePool = createMockPoolInfo(1);
    const mockGetPoolInfo = async (poolId: number) => {
      return poolId === 1 ? { ...basePool } : null;
    };

    const aggregator = new PoolStatsAggregator(mockDb, true, mockGetPoolInfo);

    const enriched = await aggregator.getEnrichedPoolInfo(1);
    assert.ok(enriched);
    assert.strictEqual(enriched.poolId, 1);
    assert.strictEqual(enriched.totalPrizesDistributed, 25_000_000);
    assert.strictEqual(enriched.totalDepositedPrincipal, 50_000_000);
    assert.strictEqual(
      basePool.totalPrizesDistributed,
      undefined,
      "Base pool should remain unmodified"
    );

    // Non-existent pool returns null
    const nonExistent = await aggregator.getEnrichedPoolInfo(999);
    assert.strictEqual(nonExistent, null);
  });

  it("should forward bypassCache to getPoolInfo and getPoolDrawStats in getEnrichedPoolInfo", async () => {
    const receivedPoolInfoOptions: (PoolFetchOptions | undefined)[] = [];
    let dbQueryCount = 0;

    const mockDb: DbAggregationClient = {
      select: () => ({
        from: () => ({
          where: async () => {
            dbQueryCount++;
            return [
              {
                totalDistributed: "30000000",
                totalDrawsCompleted: 3,
                totalWinningBonds: 15,
              },
            ];
          },
        }),
      }),
    };

    const mockGetPoolInfo = async (
      poolId: number,
      options?: PoolFetchOptions
    ) => {
      receivedPoolInfoOptions.push(options);
      return poolId === 1 ? createMockPoolInfo(1) : null;
    };

    const aggregator = new PoolStatsAggregator(mockDb, true, mockGetPoolInfo);

    // Initial enriched call with bypassCache: true
    const res = await aggregator.getEnrichedPoolInfo(1, { bypassCache: true });
    assert.ok(res);
    assert.strictEqual(res.totalPrizesDistributed, 30_000_000);
    assert.strictEqual(receivedPoolInfoOptions.length, 1);
    assert.deepStrictEqual(receivedPoolInfoOptions[0], { bypassCache: true });
    assert.strictEqual(dbQueryCount, 1);
  });
});

