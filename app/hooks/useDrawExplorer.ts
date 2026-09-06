"use client";

import { useQuery } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "../lib/query-keys";
import type { DrawCycleSummary, DrawHistoryStats } from "../types";
import type {
  PaginatedDrawsResponse,
  PaginationMeta,
} from "../types/indexer-contracts";

export interface UseDrawExplorerOptions {
  poolId?: PoolId;
  page?: number;
  pageSize?: number;
  status?: string;
  search?: string;
  enabled?: boolean;
}

export interface DrawExplorerResult {
  drawSummaries: DrawCycleSummary[];
  stats: DrawHistoryStats;
  pagination: PaginationMeta;
  isLoading: boolean;
  isRefetching: boolean;
  isPlaceholderData: boolean;
  refetch: () => Promise<unknown>;
}

const DEFAULT_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: 10,
  totalCount: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
};

const DEFAULT_STATS: DrawHistoryStats = {
  totalYieldDistributed: 0,
  totalDrawsCompleted: 0,
  totalWinningBonds: 0,
  averagePrizePot: 0,
};

export function useDrawExplorer(
  optionsOrPoolId: PoolId | UseDrawExplorerOptions = 1,
  legacyMaxCycles?: number
): DrawExplorerResult {
  const options: UseDrawExplorerOptions =
    typeof optionsOrPoolId === "number"
      ? {
          poolId: optionsOrPoolId,
          pageSize: legacyMaxCycles ?? 10,
        }
      : optionsOrPoolId;

  const poolId = options.poolId ?? 1;
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.min(Math.max(1, options.pageSize ?? 10), 100);
  const status = options.status ?? "all";
  const search = options.search?.trim() ?? "";
  const enabled = options.enabled !== false;

  const queryFilters = {
    page,
    pageSize,
    status,
    search,
  };

  const { data, isLoading, isFetching, isPlaceholderData, refetch } = useQuery({
    queryKey: bondsKeys.drawsList(poolId, queryFilters),
    queryFn: async (): Promise<{
      drawSummaries: DrawCycleSummary[];
      stats: DrawHistoryStats;
      pagination: PaginationMeta;
    }> => {
      const url = new URL("/api/indexer/draws", window.location.origin);
      url.searchParams.set("poolId", String(poolId));
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (status && status !== "all") url.searchParams.set("status", status);
      if (search) url.searchParams.set("search", search);

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch draws");
      const json: PaginatedDrawsResponse & {
        draws?: DrawCycleSummary[];
        stats?: DrawHistoryStats;
      } = await res.json();

      const drawSummaries: DrawCycleSummary[] = (
        json.data ||
        json.draws ||
        []
      ).map((d) => ({
        ...d,
        randomnessSeed: new Uint8Array(),
      }));

      const stats: DrawHistoryStats = json.aggregates ||
        json.stats || { ...DEFAULT_STATS };

      const pagination: PaginationMeta = json.meta ?? {
        page,
        pageSize,
        totalCount: drawSummaries.length,
        totalPages: Math.max(1, Math.ceil(drawSummaries.length / pageSize)),
        hasNextPage: false,
        hasPreviousPage: page > 1,
      };

      return {
        drawSummaries,
        stats,
        pagination,
      };
    },
    enabled,
    placeholderData: (previousData, previousQuery) => {
      if (!previousData || !previousQuery) return undefined;
      const prevKey = previousQuery.queryKey;
      const prevFilters = prevKey?.[prevKey.length - 1] as
        | Record<string, unknown>
        | undefined;
      const filtersUnchanged =
        prevFilters?.status === status && prevFilters?.search === search;

      return filtersUnchanged ? previousData : undefined;
    },
    staleTime: 5_000,
    refetchOnMount: true,
  });

  return {
    drawSummaries: data?.drawSummaries ?? [],
    stats: data?.stats ?? DEFAULT_STATS,
    pagination: data?.pagination ?? {
      ...DEFAULT_PAGINATION,
      page,
      pageSize,
    },
    isLoading,
    isRefetching: isFetching,
    isPlaceholderData,
    refetch,
  };
}
