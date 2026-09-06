import { eq, and, sql } from "drizzle-orm";
import {
  db as defaultDb,
  isDatabaseConfigured as defaultIsConfigured,
} from "@/app/lib/db";
import { drawHistory } from "@/app/lib/db/schema";
import { getPoolInfo as defaultGetPoolInfo } from "@/app/lib/services/pool-state-service";
import type { PoolInfo, DrawHistoryStats } from "@/app/types";

interface CacheEntry {
  stats: DrawHistoryStats;
  expiresAt: number;
}

export const POOL_STATS_TTL_MS = 5_000;
export const STALE_ERROR_RETRY_MS = 10_000;
export const DB_QUERY_TIMEOUT_MS = 500;

export interface PoolFetchOptions {
  bypassCache?: boolean;
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Prevent unhandled promise rejection if abandoned query fails later
  promise.catch(() => {});
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export interface DbAggregationClient {
  select: (fields: Record<string, unknown>) => {
    from: (table: unknown) => {
      where: (condition: unknown) => Promise<
        Array<{
          totalDistributed: string | number | null;
          totalDrawsCompleted: number | string | null;
          totalWinningBonds: number | string | null;
        }>
      >;
    };
  };
}

export class PoolStatsAggregator {
  private readonly cache = new Map<number, CacheEntry>();
  private readonly inflight = new Map<
    number,
    Promise<DrawHistoryStats | undefined>
  >();

  constructor(
    private readonly db: typeof defaultDb | DbAggregationClient = defaultDb,
    private readonly isConfigured: boolean = defaultIsConfigured,
    private readonly getPoolInfo: (
      poolId: number,
      options?: PoolFetchOptions
    ) => Promise<PoolInfo | null> = defaultGetPoolInfo,
    private readonly ttlMs: number = POOL_STATS_TTL_MS,
    private readonly errorRetryMs: number = STALE_ERROR_RETRY_MS,
    private readonly queryTimeoutMs: number = DB_QUERY_TIMEOUT_MS
  ) {}

  async getPoolDrawStats(
    poolId: number = 1,
    options?: PoolFetchOptions
  ): Promise<DrawHistoryStats | undefined> {
    if (!Number.isSafeInteger(poolId) || poolId < 1) return undefined;

    const bypassCache = options?.bypassCache ?? false;

    if (!bypassCache) {
      const now = Date.now();
      const hit = this.cache.get(poolId);
      if (hit && hit.expiresAt > now) {
        return hit.stats;
      }

      const existingPromise = this.inflight.get(poolId);
      if (existingPromise) {
        return existingPromise;
      }
    }

    const fetchPromise = (async (): Promise<DrawHistoryStats | undefined> => {
      if (!this.isConfigured) {
        return undefined;
      }

      try {
        const queryPromise = this.db
          .select({
            totalDistributed: sql<string>`COALESCE(SUM(${drawHistory.totalDistributed}), 0)::text`,
            totalDrawsCompleted: sql<number>`COUNT(*)::int`,
            totalWinningBonds: sql<number>`COALESCE(SUM(${drawHistory.winnersCount}), 0)::int`,
          })
          .from(drawHistory)
          .where(
            and(
              eq(drawHistory.poolId, poolId),
              eq(drawHistory.status, "Complete")
            )
          ) as unknown as Promise<
            Array<{
              totalDistributed: string | number | null;
              totalDrawsCompleted: number | string | null;
              totalWinningBonds: number | string | null;
            }>
          >;

        const result = await withTimeout<
          Array<{
            totalDistributed: string | number | null;
            totalDrawsCompleted: number | string | null;
            totalWinningBonds: number | string | null;
          }>
        >(
          queryPromise,
          this.queryTimeoutMs,
          "Database aggregation timeout"
        );

        const row = result[0];
        const rawSumText = row?.totalDistributed;
        const parsedTotal = rawSumText != null ? Number(rawSumText) : 0;
        const totalDistributed =
          Number.isFinite(parsedTotal) && parsedTotal >= 0 ? parsedTotal : 0;

        const rawDraws = row?.totalDrawsCompleted;
        const parsedDraws = rawDraws != null ? Number(rawDraws) : 0;
        const totalDrawsCompleted =
          Number.isFinite(parsedDraws) && parsedDraws >= 0 ? parsedDraws : 0;

        const rawBonds = row?.totalWinningBonds;
        const parsedBonds = rawBonds != null ? Number(rawBonds) : 0;
        const totalWinningBonds =
          Number.isFinite(parsedBonds) && parsedBonds >= 0 ? parsedBonds : 0;

        const averagePrizePot =
          totalDrawsCompleted > 0
            ? totalDistributed / totalDrawsCompleted
            : 0;

        const stats: DrawHistoryStats = {
          totalYieldDistributed: totalDistributed,
          totalDrawsCompleted,
          totalWinningBonds,
          averagePrizePot,
        };

        this.cache.set(poolId, {
          stats,
          expiresAt: Date.now() + this.ttlMs,
        });

        return stats;
      } catch {
        const staleEntry = this.cache.get(poolId);
        if (staleEntry) {
          // Extend stale cache expiration to avoid hammering failing DB on consecutive requests
          staleEntry.expiresAt = Date.now() + this.errorRetryMs;
          return staleEntry.stats;
        }
        return undefined;
      } finally {
        this.inflight.delete(poolId);
      }
    })();

    if (!bypassCache) {
      this.inflight.set(poolId, fetchPromise);
    }
    return fetchPromise;
  }

  async getCumulativePrizes(
    poolId: number = 1,
    options?: PoolFetchOptions
  ): Promise<number | undefined> {
    const stats = await this.getPoolDrawStats(poolId, options);
    return stats?.totalYieldDistributed;
  }

  invalidatePoolStats(poolId?: number): void {
    if (poolId !== undefined) {
      this.cache.delete(poolId);
      this.inflight.delete(poolId);
    } else {
      this.cache.clear();
      this.inflight.clear();
    }
  }

  async getEnrichedPoolInfo(
    poolId: number = 1,
    options?: PoolFetchOptions
  ): Promise<PoolInfo | null> {
    const [pool, stats] = await Promise.all([
      this.getPoolInfo(poolId, options),
      this.getPoolDrawStats(poolId, options),
    ]);

    if (!pool) return null;

    return {
      ...pool,
      totalPrizesDistributed: stats?.totalYieldDistributed,
    };
  }
}

export const defaultPoolStatsAggregator = new PoolStatsAggregator();
export const getPoolDrawStats = (
  poolId?: number,
  options?: PoolFetchOptions
) => defaultPoolStatsAggregator.getPoolDrawStats(poolId, options);
export const getCumulativePrizes = (
  poolId?: number,
  options?: PoolFetchOptions
) => defaultPoolStatsAggregator.getCumulativePrizes(poolId, options);
export const invalidatePoolStats = (poolId?: number) =>
  defaultPoolStatsAggregator.invalidatePoolStats(poolId);
export const getEnrichedPoolInfo = (
  poolId?: number,
  options?: PoolFetchOptions
) => defaultPoolStatsAggregator.getEnrichedPoolInfo(poolId, options);
