"use client";

import { useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import type { PoolInfo } from "@/app/types";

export function usePrizePool(poolId: PoolId = 1) {
  const bypassCacheRef = useRef<boolean>(false);

  const query = useQuery({
    queryKey: bondsKeys.poolState(poolId),
    queryFn: async (context): Promise<PoolInfo | null> => {
      const url = new URL("/api/indexer/pool", window.location.origin);
      url.searchParams.set("poolId", String(poolId));
      if (bypassCacheRef.current) {
        url.searchParams.set("bypassCache", "true");
      }

      const res = await fetch(url.toString(), {
        cache: "no-store",
        signal: context.signal,
      });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch pool state");
      return res.json();
    },
    staleTime: 5_000,
    refetchOnMount: "always",
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
  });

  const refetch = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      if (options?.bypassCache) {
        bypassCacheRef.current = true;
      }
      try {
        return await query.refetch();
      } finally {
        bypassCacheRef.current = false;
      }
    },
    [query]
  );

  return {
    ...query,
    refetch,
  };
}
