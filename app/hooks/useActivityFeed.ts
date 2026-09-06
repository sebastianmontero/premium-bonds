"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "../lib/query-keys";
import type { ActivityEntry } from "../types";
import { useCallback, useEffect, useMemo } from "react";
import {
  addOptimisticActivity,
  reconcileOptimisticActivities,
  useLocalActivity,
} from "../lib/optimistic-activity-store";
import {
  filterActivityEntries,
  mergeActivityEntries,
} from "../lib/activity-helpers";
import type { KeysetActivityResponse } from "../types/indexer-contracts";

export interface ScanProgress {
  currentBatch: number;
  maxBatches: number;
}

export interface UseActivityFeedOptions {
  type?: string;
  search?: string;
  enabled?: boolean;
}

export interface ActivityFeedResult {
  entries: ActivityEntry[];
  isLoading: boolean;
  isFetchingMore: boolean;
  hasMore: boolean;
  scanProgress: ScanProgress | null;
  totalLoaded: number;
  refetch: () => void;
  loadMore: (limit?: number) => Promise<boolean>;
  fetchUntilMatches?: (
    filterFn: (entry: ActivityEntry) => boolean,
    targetCount: number
  ) => Promise<void>;
  prependLocal: (entry: ActivityEntry, targetAddress?: string) => void;
}

export function useActivityFeed(
  userAddress: string | undefined,
  poolId: PoolId = 1,
  options?: UseActivityFeedOptions
): ActivityFeedResult {
  const localEntries = useLocalActivity(userAddress);
  const filterType = options?.type ?? "all";
  const search = options?.search?.trim() ?? "";
  const isEnabled = options?.enabled !== false && Boolean(userAddress);

  const query = useInfiniteQuery<KeysetActivityResponse>({
    queryKey: bondsKeys.activityFeed(poolId, userAddress, {
      type: filterType,
      search,
    }),
    queryFn: async ({ pageParam }) => {
      if (!userAddress) {
        return {
          success: false,
          fallbackRequired: true,
          error: "Wallet not connected",
        };
      }
      const url = new URL("/api/indexer/activity", window.location.origin);
      url.searchParams.set("user", userAddress);
      url.searchParams.set("poolId", String(poolId));
      url.searchParams.set("limit", "20");
      if (filterType && filterType !== "all") {
        url.searchParams.set("type", filterType);
      }
      if (search) {
        url.searchParams.set("search", search);
      }
      if (pageParam) {
        url.searchParams.set("cursor", String(pageParam));
      }

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch activity feed");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.success && lastPage.meta?.nextCursor
        ? lastPage.meta.nextCursor
        : undefined,
    enabled: isEnabled,
    staleTime: 10_000,
  });

  const apiEntries = useMemo(() => {
    return (
      query.data?.pages.flatMap((page) =>
        page.success && page.data ? page.data : []
      ) ?? []
    );
  }, [query.data]);

  useEffect(() => {
    if (!userAddress || localEntries.length === 0 || apiEntries.length === 0) {
      return;
    }
    const onChainSignatures = new Set(
      apiEntries
        .map((e) => e.txSignature)
        .filter((s): s is string => Boolean(s))
    );
    reconcileOptimisticActivities(userAddress, onChainSignatures);
  }, [localEntries, apiEntries, userAddress]);

  const filteredLocalEntries = useMemo(() => {
    return filterActivityEntries(localEntries, {
      type: filterType,
      search,
    });
  }, [localEntries, filterType, search]);

  const entries = useMemo(() => {
    return mergeActivityEntries(filteredLocalEntries, apiEntries);
  }, [filteredLocalEntries, apiEntries]);

  const loadMore = useCallback(
    async (_limit?: number): Promise<boolean> => {
      void _limit;
      if (!query.hasNextPage || query.isFetchingNextPage) return false;
      const res = await query.fetchNextPage();
      const lastPage = res.data?.pages[res.data.pages.length - 1];
      return Boolean(lastPage?.success && lastPage.meta?.nextCursor);
    },
    [query]
  );

  const fetchUntilMatches = useCallback(
    async (
      _filterFn?: (entry: ActivityEntry) => boolean,
      _targetCount?: number
    ): Promise<void> => {
      void _filterFn;
      void _targetCount;
      // Server-side filtered query handles matching directly
      if (query.hasNextPage && !query.isFetchingNextPage) {
        await query.fetchNextPage();
      }
    },
    [query]
  );

  const prependLocal = useCallback(
    (entry: ActivityEntry, targetAddress?: string) => {
      const addressKey = targetAddress || userAddress;
      if (!addressKey) return;
      addOptimisticActivity(addressKey, entry);
    },
    [userAddress]
  );

  const refetch = useCallback(() => {
    query.refetch();
  }, [query]);

  return {
    entries,
    isLoading: query.isLoading,
    isFetchingMore: query.isFetchingNextPage,
    hasMore: Boolean(query.hasNextPage),
    scanProgress: null,
    totalLoaded: entries.length,
    refetch,
    loadMore,
    fetchUntilMatches,
    prependLocal,
  };
}
