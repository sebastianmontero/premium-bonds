"use client";

import { useQuery } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "../lib/query-keys";
import type { DrawCycleSummary, DrawHistoryStats } from "../types";

interface DrawExplorerResult {
  drawSummaries: DrawCycleSummary[];
  stats: DrawHistoryStats;
  isLoading: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
}

export function useDrawExplorer(
  poolId: PoolId = 1,
  maxCyclesToFetch: number = 100,
  poolTotalPrizesDistributed?: number
): DrawExplorerResult {
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: bondsKeys.draws(poolId),
    queryFn: async () => {
      const res = await fetch(
        `/api/indexer/draws?poolId=${poolId}&limit=${maxCyclesToFetch}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Failed to fetch draws");
      const json = await res.json();
      return {
        drawSummaries: (json.draws || []) as DrawCycleSummary[],
        stats: (json.stats || {
          totalYieldDistributed: poolTotalPrizesDistributed ?? 0,
          totalDrawsCompleted: 0,
          totalWinningBonds: 0,
          averagePrizePot: 0,
        }) as DrawHistoryStats,
      };
    },
    staleTime: 5_000,
    refetchOnMount: true,
  });

  return {
    drawSummaries: data?.drawSummaries || [],
    stats: data?.stats || {
      totalYieldDistributed: poolTotalPrizesDistributed ?? 0,
      totalDrawsCompleted: 0,
      totalWinningBonds: 0,
      averagePrizePot: 0,
    },
    isLoading,
    isRefetching: isFetching,
    refetch,
  };
}
