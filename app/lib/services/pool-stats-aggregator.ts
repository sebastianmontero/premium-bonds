import { eq, sql } from "drizzle-orm";
import {
  db as defaultDb,
  isDatabaseConfigured as defaultIsConfigured,
} from "@/app/lib/db";
import { drawHistory } from "@/app/lib/db/schema";
import { getPoolInfo as defaultGetPoolInfo } from "@/app/lib/services/pool-state-service";
import type {
  PoolInfo,
  DrawHistoryStats,
  DrawStatusCountMap,
} from "@/app/types";

interface CacheEntry {
  stats: DrawHistoryStats;
  expiresAt: number;
}

export const POOL_STATS_TTL_MS = 3_600_000;
export const STALE_ERROR_RETRY_MS = 30_000;
export const DB_QUERY_TIMEOUT_MS = 5_000;

import type { createSolanaRpc } from "@solana/kit";

export interface PoolFetchOptions {
  bypassCache?: boolean;
  rpc?: ReturnType<typeof createSolanaRpc>;
}

export interface PoolStatsAggregatorOptions {
  db?: typeof defaultDb | DbAggregationClient;
  isConfigured?: boolean;
  getPoolInfo?: (
    poolId: number,
    options?: PoolFetchOptions
  ) => Promise<PoolInfo | null>;
  ttlMs?: number;
  errorRetryMs?: number;
  queryTimeoutMs?: number;
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
      where: (condition: unknown) => {
        groupBy: (field: unknown) => Promise<
          Array<{
            status: string;
            count: number | string;
            totalDistributed: string | number | null;
            totalWinningBonds: number | string | null;
          }>
        >;
      };
    };
  };
}

export class PoolStatsAggregator {
  private readonly cache = new Map<number, CacheEntry>();
  private readonly inflight = new Map<
    number,
    Promise<DrawHistoryStats | undefined>
  >();
  private readonly db: typeof defaultDb | DbAggregationClient;
  private readonly isConfigured: boolean;
  private readonly getPoolInfo: (
    poolId: number,
    options?: PoolFetchOptions
  ) => Promise<PoolInfo | null>;
  private readonly ttlMs: number;
  private readonly errorRetryMs: number;
  private readonly queryTimeoutMs: number;

  constructor(options: PoolStatsAggregatorOptions = {}) {
    this.db = options.db ?? defaultDb;
    this.isConfigured = options.isConfigured ?? defaultIsConfigured;
    this.getPoolInfo = options.getPoolInfo ?? defaultGetPoolInfo;
    this.ttlMs = options.ttlMs ?? POOL_STATS_TTL_MS;
    this.errorRetryMs = options.errorRetryMs ?? STALE_ERROR_RETRY_MS;
    this.queryTimeoutMs = options.queryTimeoutMs ?? DB_QUERY_TIMEOUT_MS;
  }

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
        const queryPromise = (this.db as DbAggregationClient)
          .select({
            status: drawHistory.status,
            count: sql<number>`COUNT(*)::int`,
            totalDistributed: sql<string>`COALESCE(SUM(${drawHistory.totalDistributed}), 0)::text`,
            totalWinningBonds: sql<number>`COALESCE(SUM(${drawHistory.winnersCount}), 0)::int`,
          })
          .from(drawHistory)
          .where(eq(drawHistory.poolId, poolId))
          .groupBy(drawHistory.status);

        const rows = await withTimeout<
          Array<{
            status: string;
            count: number | string;
            totalDistributed: string | number | null;
            totalWinningBonds: number | string | null;
          }>
        >(queryPromise, this.queryTimeoutMs, "Database aggregation timeout");

        const statusCounts: DrawStatusCountMap = {};
        let totalDistributed = 0;
        let totalDrawsCompleted = 0;
        let totalWinningBonds = 0;

        for (const row of rows ?? []) {
          const count = Number(row.count ?? 0);
          statusCounts[row.status as string] = count;

          if (row.status === "Complete") {
            totalDrawsCompleted = count;
            const rawSum = Number(row.totalDistributed ?? 0);
            totalDistributed =
              Number.isFinite(rawSum) && rawSum >= 0 ? rawSum : 0;
            const rawBonds = Number(row.totalWinningBonds ?? 0);
            totalWinningBonds =
              Number.isFinite(rawBonds) && rawBonds >= 0 ? rawBonds : 0;
          }
        }

        const averagePrizePot =
          totalDrawsCompleted > 0
            ? Math.round(totalDistributed / totalDrawsCompleted)
            : 0;

        const stats: DrawHistoryStats = {
          totalYieldDistributed: totalDistributed,
          totalDrawsCompleted,
          totalWinningBonds,
          averagePrizePot,
          statusCounts,
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
      const entry = this.cache.get(poolId);
      if (entry) {
        entry.expiresAt = 0;
      }
      this.inflight.delete(poolId);
    } else {
      for (const entry of this.cache.values()) {
        entry.expiresAt = 0;
      }
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
export const getPoolDrawStats = (poolId?: number, options?: PoolFetchOptions) =>
  defaultPoolStatsAggregator.getPoolDrawStats(poolId, options);
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
