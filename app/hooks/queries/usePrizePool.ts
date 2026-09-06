"use client";

import { useQuery } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import type { PoolInfo } from "@/app/types";

export function usePrizePool(poolId: PoolId = 1) {
  return useQuery({
    queryKey: bondsKeys.poolState(poolId),
    queryFn: async (): Promise<PoolInfo | null> => {
      const res = await fetch(`/api/indexer/pool?poolId=${poolId}`, {
        cache: "no-store",
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
}
