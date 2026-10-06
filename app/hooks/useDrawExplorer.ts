"use client";

import { useRef, useCallback } from "react";
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
  stats: DrawHistoryStats | null;
  pagination: PaginationMeta;
  isLoading: boolean;
  isRefetching: boolean;
  isError: boolean;
  error: Error | null;
  isPlaceholderData: boolean;
  refetch: (options?: { bypassCache?: boolean }) => Promise<unknown>;
}

const DEFAULT_PAGINATION: PaginationMeta = {
  page: 1,
  pageSize: 10,
  totalCount: 0,
  totalPages: 1,
  hasNextPage: false,
  hasPreviousPage: false,
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

  const bypassCacheRef = useRef<boolean>(false);

  const {
    data,
    isLoading,
    isFetching,
    isError,
    error,
    isPlaceholderData,
    refetch: queryRefetch,
  } = useQuery({
    queryKey: bondsKeys.drawsList(poolId, queryFilters),
    queryFn: async (
      context
    ): Promise<{
      drawSummaries: DrawCycleSummary[];
      stats: DrawHistoryStats | null;
      pagination: PaginationMeta;
    }> => {
      const url = new URL("/api/indexer/draws", window.location.origin);
      url.searchParams.set("poolId", String(poolId));
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (status && status !== "all") url.searchParams.set("status", status);
      if (search) url.searchParams.set("search", search);
      if (bypassCacheRef.current) url.searchParams.set("bypassCache", "true");

      const res = await fetch(url.toString(), {
        cache: "no-store",
        signal: context.signal,
      });
      if (!res.ok) throw new Error("Failed to fetch draws");
      const json: PaginatedDrawsResponse = await res.json();

      if (!json.success || json.fallbackRequired) {
        throw new Error(json.error || "Failed to fetch draws");
      }

      const drawSummaries: DrawCycleSummary[] = (json.data || []).map((d) => ({
        ...d,
        randomnessSeed: new Uint8Array(),
      }));

      const stats: DrawHistoryStats | null = json.aggregates ?? null;

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
      if (bondsKeys.isSamePool(previousQuery?.queryKey, poolId)) {
        return previousData;
      }
      return undefined;
    },
    staleTime: 5_000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 3000),
    refetchOnMount: true,
  });

  const refetch = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      if (options?.bypassCache) {
        bypassCacheRef.current = true;
      }
      try {
        return await queryRefetch();
      } finally {
        bypassCacheRef.current = false;
      }
    },
    [queryRefetch]
  );

  return {
    drawSummaries: data?.drawSummaries ?? [],
    stats: data?.stats ?? null,
    pagination: data?.pagination ?? {
      ...DEFAULT_PAGINATION,
      page,
      pageSize,
    },
    isLoading,
    isRefetching: isFetching,
    isError,
    error: (error as Error) ?? null,
    isPlaceholderData,
    refetch,
  };
}
