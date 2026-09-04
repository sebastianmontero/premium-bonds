"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "../lib/query-keys";
import type { PrizeHistoryEntry, RecentWinner } from "../types";
import { useCallback, useMemo } from "react";
import { type ReinvestmentBreakdown } from "../lib/draw-helpers";
import {
  mapDtoToPrizeHistoryEntry,
  mapDtoToRecentWinner,
  type PrizeHistoryEntryDto,
} from "../lib/indexer-mappers";

export interface OptimisticPrizeParams {
  drawCycleId: number;
  winnerIndex: number;
  breakdown: ReinvestmentBreakdown;
  txSignature?: string;
}

export interface DrawHistoryResult {
  prizeHistory: PrizeHistoryEntry[];
  recentWinners: RecentWinner[];
  isLoading: boolean;
  isRefetching: boolean;
  refetch: () => Promise<unknown>;
  markPrizeOptimisticallyProcessed: (params: OptimisticPrizeParams) => void;
  rollbackOptimisticPrize: (drawCycleId: number, winnerIndex: number) => void;
}

export interface UseDrawHistoryOptions {
  poolId?: PoolId;
  userAddress?: string;
  tokenSymbol?: string;
  maxCyclesToFetch?: number;
}

export function useDrawHistory(
  options: UseDrawHistoryOptions = {}
): DrawHistoryResult {
  const {
    poolId = 1,
    userAddress,
    tokenSymbol = "USDC",
    maxCyclesToFetch = 50,
  } = options;

  const queryClient = useQueryClient();

  // Query user-specific prize history
  const userQuery = useQuery({
    queryKey: bondsKeys.userPrizeHistory(poolId, userAddress ?? "anonymous"),
    enabled: !!userAddress,
    queryFn: async (): Promise<PrizeHistoryEntry[]> => {
      if (!userAddress) return [];
      const res = await fetch(
        `/api/indexer/winners?poolId=${poolId}&user=${encodeURIComponent(userAddress)}&limit=${maxCyclesToFetch}`
      );
      if (!res.ok) throw new Error("Failed to fetch user prizes");
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) return [];
      return (json.data as PrizeHistoryEntryDto[]).map(
        mapDtoToPrizeHistoryEntry
      );
    },
    staleTime: 30_000,
  });

  // Query global recent winners (for ticker / recent display)
  const globalQuery = useQuery({
    queryKey: bondsKeys.prizes(poolId),
    queryFn: async (): Promise<RecentWinner[]> => {
      const res = await fetch(`/api/indexer/winners?poolId=${poolId}&limit=10`);
      if (!res.ok) throw new Error("Failed to fetch recent winners");
      const json = await res.json();
      if (!json.success || !Array.isArray(json.data)) return [];
      return (json.data as PrizeHistoryEntryDto[]).map((dto) =>
        mapDtoToRecentWinner(dto, tokenSymbol)
      );
    },
    staleTime: 30_000,
  });

  const markPrizeOptimisticallyProcessed = useCallback(
    ({
      drawCycleId,
      winnerIndex,
      breakdown,
      txSignature,
    }: OptimisticPrizeParams) => {
      if (!userAddress) return;
      const queryKey = bondsKeys.userPrizeHistory(poolId, userAddress);
      queryClient.setQueryData<PrizeHistoryEntry[]>(queryKey, (old) => {
        if (!old) return old;
        return old.map((entry) => {
          if (
            entry.drawCycleId === drawCycleId &&
            entry.winnerIndex === winnerIndex
          ) {
            return {
              ...entry,
              status: "reinvested",
              bondsBought: breakdown.bondsBought,
              reinvestedTickets: breakdown.bondsBought,
              dustAccumulated:
                breakdown.dustAccumulated > 0
                  ? breakdown.dustAccumulated
                  : undefined,
              usedPriorDust:
                breakdown.usedPriorDust > 0
                  ? breakdown.usedPriorDust
                  : undefined,
              txSignature: txSignature ?? entry.txSignature,
            };
          }
          return entry;
        });
      });
    },
    [queryClient, poolId, userAddress]
  );

  const rollbackOptimisticPrize = useCallback(
    (drawCycleId: number, winnerIndex: number) => {
      void drawCycleId;
      void winnerIndex;
      if (!userAddress) return;
      const queryKey = bondsKeys.userPrizeHistory(poolId, userAddress);
      queryClient.invalidateQueries({ queryKey });
    },
    [queryClient, poolId, userAddress]
  );

  const prizeHistory = useMemo(() => userQuery.data ?? [], [userQuery.data]);

  const refetch = useCallback(async () => {
    await Promise.all([userQuery.refetch(), globalQuery.refetch()]);
  }, [userQuery, globalQuery]);

  return {
    prizeHistory,
    recentWinners: globalQuery.data || [],
    isLoading: userAddress ? userQuery.isLoading : globalQuery.isLoading,
    isRefetching: userQuery.isFetching || globalQuery.isFetching,
    refetch,
    markPrizeOptimisticallyProcessed,
    rollbackOptimisticPrize,
  };
}
