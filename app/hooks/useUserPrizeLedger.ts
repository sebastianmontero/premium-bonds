"use client";

import { useQuery } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "../lib/query-keys";
import { mapDtoToPrizeHistoryEntry } from "../lib/indexer-mappers";
import type { PrizeHistoryEntry } from "../types";
import type {
  PaginatedWinnersResponse,
  PaginationMeta,
  PrizeLedgerAggregates,
  PrizeLedgerFilters,
} from "../types/indexer-contracts";

export interface UseUserPrizeLedgerOptions {
  userAddress?: string;
  poolId?: PoolId;
  page?: number;
  pageSize?: number;
  status?: string;
  tier?: string;
  search?: string;
  enabled?: boolean;
}

export interface UserPrizeLedgerResult {
  entries: PrizeHistoryEntry[];
  pagination: PaginationMeta;
  aggregates: PrizeLedgerAggregates;
  isLoading: boolean;
  isFetching: boolean;
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

const DEFAULT_AGGREGATES: PrizeLedgerAggregates = {
  totalFilteredValue: "0",
};

export function useUserPrizeLedger({
  userAddress,
  poolId = 1,
  page = 1,
  pageSize = 10,
  status = "all",
  tier = "all",
  search = "",
  enabled = true,
}: UseUserPrizeLedgerOptions): UserPrizeLedgerResult {
  const currentFilters: Partial<PrizeLedgerFilters> = {
    page,
    pageSize,
    status: status as PrizeLedgerFilters["status"],
    tier: tier as PrizeLedgerFilters["tier"],
    search: search.trim() || undefined,
  };

  const queryKey = bondsKeys.userPrizeLedger(
    poolId,
    userAddress ?? "anonymous",
    currentFilters
  );

  const query = useQuery({
    queryKey,
    queryFn: async (): Promise<{
      entries: PrizeHistoryEntry[];
      pagination: PaginationMeta;
      aggregates: PrizeLedgerAggregates;
    }> => {
      if (!userAddress) {
        return {
          entries: [],
          pagination: { ...DEFAULT_PAGINATION, page, pageSize },
          aggregates: DEFAULT_AGGREGATES,
        };
      }

      const url = new URL("/api/indexer/winners", window.location.origin);
      url.searchParams.set("user", userAddress);
      url.searchParams.set("poolId", String(poolId));
      url.searchParams.set("page", String(page));
      url.searchParams.set("pageSize", String(pageSize));
      if (status && status !== "all") url.searchParams.set("status", status);
      if (tier && tier !== "all") url.searchParams.set("tier", tier);
      if (search.trim()) url.searchParams.set("search", search.trim());

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (!res.ok) {
        throw new Error(`Failed to fetch user prize ledger: ${res.statusText}`);
      }

      const json: PaginatedWinnersResponse = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || "Failed to load prizes");
      }

      const entries = json.data.map(mapDtoToPrizeHistoryEntry);
      const pagination = json.meta ?? {
        page,
        pageSize,
        totalCount: entries.length,
        totalPages: Math.max(1, Math.ceil(entries.length / pageSize)),
        hasNextPage: false,
        hasPreviousPage: page > 1,
      };

      const aggregates = json.aggregates ?? DEFAULT_AGGREGATES;

      return { entries, pagination, aggregates };
    },
    enabled: Boolean(enabled && userAddress),
    placeholderData: (previousData, previousQuery) => {
      if (!previousData || !previousQuery) return undefined;
      const prevKey = previousQuery.queryKey;
      const prevFilters = prevKey?.[prevKey.length - 1] as
        | Partial<PrizeLedgerFilters>
        | undefined;
      const filtersUnchanged =
        prevFilters?.tier === currentFilters.tier &&
        prevFilters?.status === currentFilters.status &&
        prevFilters?.search === currentFilters.search;

      return filtersUnchanged ? previousData : undefined;
    },
    staleTime: 10_000,
  });

  return {
    entries: query.data?.entries ?? [],
    pagination: query.data?.pagination ?? {
      ...DEFAULT_PAGINATION,
      page,
      pageSize,
    },
    aggregates: query.data?.aggregates ?? DEFAULT_AGGREGATES,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isPlaceholderData: query.isPlaceholderData,
    refetch: query.refetch,
  };
}
