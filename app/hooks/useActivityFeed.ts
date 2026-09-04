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
import { mergeActivityEntries } from "../lib/activity-helpers";

export interface ScanProgress {
  currentBatch: number;
  maxBatches: number;
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
  fetchUntilMatches: (
    filterFn: (entry: ActivityEntry) => boolean,
    targetCount: number
  ) => Promise<void>;
  prependLocal: (entry: ActivityEntry, targetAddress?: string) => void;
}

interface ActivityApiResponse {
  entries: ActivityEntry[];
  fallback: boolean;
  nextCursor: string | null;
}

export function useActivityFeed(
  userAddress: string | undefined,
  poolId: PoolId = 1
): ActivityFeedResult {
  const localEntries = useLocalActivity(userAddress);

  const query = useInfiniteQuery<ActivityApiResponse>({
    queryKey: bondsKeys.activityFeed(poolId, userAddress),
    queryFn: async ({ pageParam }) => {
      if (!userAddress) {
        return { entries: [], fallback: false, nextCursor: null };
      }
      const url = new URL("/api/indexer/activity", window.location.origin);
      url.searchParams.set("user", userAddress);
      url.searchParams.set("poolId", String(poolId));
      url.searchParams.set("limit", "20");
      if (pageParam) {
        url.searchParams.set("cursor", String(pageParam));
      }

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) throw new Error("Failed to fetch activity feed");
      return res.json();
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!userAddress,
    staleTime: 10_000,
  });

  const apiEntries = useMemo(() => {
    return query.data?.pages.flatMap((page) => page.entries) ?? [];
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

  const entries = useMemo(() => {
    return mergeActivityEntries(localEntries, apiEntries);
  }, [localEntries, apiEntries]);

  const loadMore = useCallback(
    async (_limit?: number): Promise<boolean> => {
      void _limit;
      if (!query.hasNextPage || query.isFetchingNextPage) return false;
      const res = await query.fetchNextPage();
      return Boolean(res.data?.pages[res.data.pages.length - 1]?.nextCursor);
    },
    [query]
  );

  const fetchUntilMatches = useCallback(
    async (
      filterFn: (entry: ActivityEntry) => boolean,
      targetCount: number
    ): Promise<void> => {
      let currentMatches = entries.filter(filterFn).length;
      let hasNext = query.hasNextPage;

      while (
        currentMatches < targetCount &&
        hasNext &&
        !query.isFetchingNextPage
      ) {
        const res = await query.fetchNextPage();
        const latestPage = res.data?.pages[res.data.pages.length - 1];
        if (!latestPage || !latestPage.nextCursor) {
          break;
        }
        hasNext = Boolean(latestPage.nextCursor);
        const allItems = res.data?.pages.flatMap((p) => p.entries) ?? [];
        currentMatches = allItems.filter(filterFn).length;
      }
    },
    [entries, query]
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
