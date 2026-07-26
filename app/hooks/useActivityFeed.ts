"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { Address } from "@solana/kit";
import {
  fetchProgramEvents,
  ProgramEvent,
  getCachedEvents,
  setCachedEvents,
} from "../lib/anchor-events";
import type { ActivityEntry, ActivityType } from "../types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ScanProgress {
  currentBatch: number;
  maxBatches: number;
}

interface ActivityFeedResult {
  /** Activity feed entries sorted by date descending. */
  entries: ActivityEntry[];
  /** Whether initial data is currently loading. */
  isLoading: boolean;
  /** Whether historical data is currently being fetched via lazy loading. */
  isFetchingMore: boolean;
  /** Whether more historical transactions exist on-chain. */
  hasMore: boolean;
  /** Current background batch scan progress (or null if idle). */
  scanProgress: ScanProgress | null;
  /** Total number of transactions loaded so far. */
  totalLoaded: number;
  /** Refetch all data from scratch. */
  refetch: () => void;
  /** Lazily fetch the next batch of historical transactions. */
  loadMore: (limit?: number) => Promise<boolean>;
  /** Automatically fetch historical transactions in batches until matching count is met or history ends. */
  fetchUntilMatches: (
    filterFn: (entry: ActivityEntry) => boolean,
    targetCount: number
  ) => Promise<void>;
  /** Prepend a local-only activity entry (for optimistic UI after tx). */
  prependLocal: (entry: ActivityEntry) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatAmount(
  baseUnits: bigint | number,
  decimals: number = 6
): string {
  const val = Number(baseUnits) / Math.pow(10, decimals);
  return val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function eventToActivity(
  event: ProgramEvent,
  decimals: number = 6
): ActivityEntry | null {
  const date = event.blockTime
    ? new Date(Number(event.blockTime) * 1000).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  const signature = event.signature;

  switch (event.type) {
    case "BondsPurchased": {
      const d = event.data;
      return {
        id: `evt-buy-${signature.slice(0, 8)}`,
        date,
        type: "deposit" as ActivityType,
        description: `Deposited ${formatAmount(d.amount, decimals)} USDC → +${d.bonds} tickets`,
        amount: Number(d.amount),
        txSignature: signature,
      };
    }
    case "BondsSold": {
      const d = event.data;
      return {
        id: `evt-sell-${signature.slice(0, 8)}`,
        date,
        type: "withdraw" as ActivityType,
        description: `Sold ${d.bonds} bonds (${formatAmount(d.principal, decimals)} USDC) · Pending settle`,
        amount: Number(d.principal),
        txSignature: signature,
      };
    }
    case "WinningsReinvested": {
      const d = event.data;
      if (d.bondsBought === 0) return null; // Skip zero-bond batches
      return {
        id: `evt-reinvest-${signature.slice(0, 8)}`,
        date,
        type: "auto-reinvest" as ActivityType,
        description: d.isFinalBatch
          ? `Draw #${d.cycleId} reinvestment finalized: +${d.bondsBought} tickets from ${formatAmount(d.amountReinvested, decimals)} USDC`
          : `Draw #${d.cycleId} batch reinvest: +${d.bondsBought} tickets (${formatAmount(d.amountReinvested, decimals)} USDC)`,
        amount: Number(d.amountReinvested),
        txSignature: signature,
      };
    }
    case "WinningsClaimed": {
      const d = event.data;
      return {
        id: `evt-claim-win-${signature.slice(0, 8)}`,
        date,
        type: "win" as ActivityType,
        description: `Claimed accumulated winnings of ${formatAmount(d.amount, decimals)} USDC · Pending settle`,
        amount: Number(d.amount),
        txSignature: signature,
      };
    }
    case "RedemptionClaimed": {
      const d = event.data;
      return {
        id: `evt-redeem-${signature.slice(0, 8)}`,
        date,
        type: "claim-redemption" as ActivityType,
        description: `Claimed settled redemption of ${formatAmount(d.amount, decimals)} USDC to wallet`,
        amount: Number(d.amount),
        txSignature: signature,
      };
    }
    case "DrawCompleted":
      // Draw completion events are global, not user-specific activity
      return null;
    default:
      return null;
  }
}

/**
 * Deduplicate entries and replace optimistic local entries if matching on-chain event arrives.
 */
function mergeAndDeduplicate(
  existing: ActivityEntry[],
  incoming: ActivityEntry[],
  maxLimit: number = Infinity
): ActivityEntry[] {
  const map = new Map<string, ActivityEntry>();
  const incomingOnChainSigs = new Set<string>();

  for (const item of incoming) {
    if (item.id.startsWith("evt-")) {
      incomingOnChainSigs.add(item.id);
    }
    map.set(item.id, item);
  }

  for (const item of existing) {
    // Deduplicate against exact ID
    if (map.has(item.id)) continue;

    // Check if item is optimistic act-* and is matched by an incoming evt-*
    if (item.id.startsWith("act-")) {
      const matched = incoming.some(
        (inc) =>
          (item.txSignature && inc.txSignature === item.txSignature) ||
          (inc.type === item.type &&
            inc.amount === item.amount &&
            inc.date === item.date)
      );
      if (matched) continue; // Skip optimistic item as on-chain event is present
    }

    map.set(item.id, item);
  }

  const merged = Array.from(map.values());
  merged.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  return isFinite(maxLimit) ? merged.slice(0, maxLimit) : merged;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetches and parses Anchor program events for the connected user to build
 * a real-time activity feed with cursor-based lazy loading.
 *
 * Strategy:
 * 1. Initial load fetches a light batch (limit: 15) to keep page load fast.
 * 2. `loadMore()` uses the `oldestSignature` cursor pointer from raw RPC response
 *    to lazily fetch historical transaction batches without re-fetching non-program transactions.
 * 3. `fetchUntilMatches()` runs up to 5 background scan iterations when filtering to ensure page size is satisfied.
 * 4. Caches top 20 items in localStorage for fast subsequent mounts.
 *
 * @param userAddress - The base58 user wallet address.
 * @param tokenDecimals - Number of decimals for formatting USDC (defaults to 6).
 * @returns ActivityFeedResult containing entries, status flags, cursors, and fetch handlers.
 */
export function useActivityFeed(
  userAddress: string | undefined,
  tokenDecimals: number = 6
): ActivityFeedResult {
  const client = useSolanaClient();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isFetchingMore, setIsFetchingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);

  const fetchIdRef = useRef(0);
  const oldestSignatureRef = useRef<string | null>(null);
  const hasMoreRef = useRef(true);
  const isFetchingMoreRef = useRef(false);
  const entriesRef = useRef<ActivityEntry[]>([]);

  // Keep entriesRef in sync with state
  const updateEntriesState = useCallback((newEntries: ActivityEntry[]) => {
    entriesRef.current = newEntries;
    setEntries(newEntries);
  }, []);

  const fetchFeed = useCallback(async () => {
    if (!userAddress) {
      updateEntriesState([]);
      setHasMore(false);
      hasMoreRef.current = false;
      oldestSignatureRef.current = null;
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);

    try {
      const rpc = client.runtime.rpc;
      const walletAddr = userAddress as unknown as Address;
      const cacheKey = `activity:${userAddress}`;

      // Check localStorage cache for incremental fetching
      const cached = getCachedEvents(cacheKey);

      if (cached) {
        if (cached.oldestSignature !== undefined) {
          oldestSignatureRef.current = cached.oldestSignature;
        }
        if (cached.hasMore !== undefined) {
          hasMoreRef.current = cached.hasMore;
          setHasMore(cached.hasMore);
        }
      }

      const fetchOpts = cached?.lastSignature
        ? { limit: 15, until: cached.lastSignature }
        : { limit: 15 };

      // Fetch initial batch from RPC
      const result = await fetchProgramEvents(rpc, walletAddr, fetchOpts);

      if (fetchId !== fetchIdRef.current) return;

      let allEvents: ProgramEvent[] = result.events;

      // If incremental fetch with cache
      if (cached && cached.events.length > 0) {
        allEvents = [...result.events, ...cached.events];
      }

      // Update cursor refs: ONLY update if not doing an incremental `until` fetch
      // or if oldestSignatureRef is not set yet
      if (!cached?.lastSignature) {
        if (result.oldestRawSignature) {
          oldestSignatureRef.current = result.oldestRawSignature;
        }
        hasMoreRef.current = result.hasMore;
        setHasMore(result.hasMore);
      } else if (!oldestSignatureRef.current && result.oldestRawSignature) {
        oldestSignatureRef.current = result.oldestRawSignature;
      }

      // Robust cursor fallback: Ensure oldestSignatureRef is populated if we have events
      if (!oldestSignatureRef.current && allEvents.length > 0) {
        oldestSignatureRef.current = allEvents[allEvents.length - 1].signature;
      }

      // Save top 20 events to localStorage cache with history cursors
      if (allEvents.length > 0) {
        setCachedEvents(
          cacheKey,
          allEvents.slice(0, 20),
          allEvents[0].signature,
          oldestSignatureRef.current,
          hasMoreRef.current
        );
      }

      // Convert events to ActivityEntry[]
      const parsedEntries: ActivityEntry[] = [];
      const seenIds = new Set<string>();

      for (const event of allEvents) {
        const entry = eventToActivity(event, tokenDecimals);
        if (entry && !seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          parsedEntries.push(entry);
        }
      }

      parsedEntries.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      if (fetchId === fetchIdRef.current) {
        updateEntriesState(parsedEntries);
      }
    } catch (err) {
      console.error("useActivityFeed initial fetch error:", err);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, userAddress, tokenDecimals, updateEntriesState]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  /**
   * Lazily fetch the next batch of historical transactions using `before: oldestSignature`.
   * Automatically scans up to 4 signature batches if non-program transactions are encountered.
   */
  const loadMore = useCallback(
    async (batchLimit: number = 15): Promise<boolean> => {
      if (
        !userAddress ||
        !hasMoreRef.current ||
        !oldestSignatureRef.current ||
        isFetchingMoreRef.current
      ) {
        return false;
      }

      const fetchId = fetchIdRef.current;
      isFetchingMoreRef.current = true;
      setIsFetchingMore(true);

      try {
        const rpc = client.runtime.rpc;
        const walletAddr = userAddress as unknown as Address;

        const newParsed: ActivityEntry[] = [];
        let canContinue: boolean = hasMoreRef.current;
        const MAX_SCAN_BATCHES = 4;
        let batchCount = 0;

        while (
          newParsed.length === 0 &&
          canContinue &&
          oldestSignatureRef.current &&
          batchCount < MAX_SCAN_BATCHES
        ) {
          batchCount++;
          const result = await fetchProgramEvents(rpc, walletAddr, {
            limit: batchLimit,
            before: oldestSignatureRef.current,
          });

          if (fetchId !== fetchIdRef.current) return false;

          if (result.oldestRawSignature) {
            oldestSignatureRef.current = result.oldestRawSignature;
          }
          hasMoreRef.current = result.hasMore;
          setHasMore(result.hasMore);
          canContinue = result.hasMore;

          for (const event of result.events) {
            const entry = eventToActivity(event, tokenDecimals);
            if (entry) newParsed.push(entry);
          }

          if (result.events.length === 0 && !result.hasMore) {
            break;
          }
        }

        if (newParsed.length > 0) {
          const merged = mergeAndDeduplicate(entriesRef.current, newParsed);
          updateEntriesState(merged);
        }

        return hasMoreRef.current;
      } catch (err) {
        console.error("useActivityFeed loadMore error:", err);
        return false;
      } finally {
        isFetchingMoreRef.current = false;
        if (fetchId === fetchIdRef.current) {
          setIsFetchingMore(false);
        }
      }
    },
    [client, userAddress, tokenDecimals, updateEntriesState]
  );

  /**
   * Automatically fetch historical transactions in batches until matching count is met or history ends.
   */
  const fetchUntilMatches = useCallback(
    async (
      filterFn: (entry: ActivityEntry) => boolean,
      targetCount: number
    ): Promise<void> => {
      if (!userAddress || !hasMoreRef.current || isFetchingMoreRef.current)
        return;

      let currentMatches = entriesRef.current.filter(filterFn).length;
      if (currentMatches >= targetCount) return;

      const MAX_BATCHES = 5;
      let batchCount = 0;

      while (
        currentMatches < targetCount &&
        hasMoreRef.current &&
        batchCount < MAX_BATCHES
      ) {
        batchCount++;
        setScanProgress({ currentBatch: batchCount, maxBatches: MAX_BATCHES });

        const canContinue = await loadMore(15);
        currentMatches = entriesRef.current.filter(filterFn).length;

        if (!canContinue) break;
      }

      setScanProgress(null);
    },
    [userAddress, loadMore]
  );

  const prependLocal = useCallback(
    (entry: ActivityEntry) => {
      const updated = mergeAndDeduplicate(entriesRef.current, [entry]);
      updateEntriesState(updated);
    },
    [updateEntriesState]
  );

  return {
    entries,
    isLoading,
    isFetchingMore,
    hasMore,
    scanProgress,
    totalLoaded: entries.length,
    refetch: fetchFeed,
    loadMore,
    fetchUntilMatches,
    prependLocal,
  };
}
