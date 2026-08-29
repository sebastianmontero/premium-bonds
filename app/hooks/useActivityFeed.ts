"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { address } from "@solana/kit";
import {
  fetchProgramEvents,
  ProgramEvent,
  getCachedEvents,
  setCachedEvents,
  fetchClusterGenesisHash,
  clearCachedEvents,
} from "../lib/anchor-events";
import { formatActivityDescription } from "../lib/activity-helpers";
import { useProtocolSyncSubscription } from "./useProtocolSyncSubscription";
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

function eventToActivity(
  event: ProgramEvent,
  decimals: number = 6
): ActivityEntry | null {
  const date = event.blockTime
    ? new Date(Number(event.blockTime) * 1000).toISOString()
    : new Date().toISOString();

  const signature = event.signature;
  let activityType: ActivityType | null = null;
  let bonds: number | undefined;
  let amountUsdc: bigint = 0n;
  let cycleId: number | undefined;

  switch (event.type) {
    case "BondsPurchased":
      activityType = "deposit";
      bonds = event.data.bonds;
      amountUsdc = event.data.amount;
      break;
    case "BondsSold":
      activityType = "withdraw";
      bonds = event.data.bonds;
      amountUsdc = event.data.principal;
      break;
    case "WinningsReinvested":
      if (event.data.bondsBought === 0) return null;
      activityType = "auto-reinvest";
      bonds = event.data.bondsBought;
      amountUsdc = event.data.amountReinvested;
      cycleId = event.data.cycleId;
      break;
    case "WinningsClaimed":
      activityType = "win";
      amountUsdc = event.data.amount;
      break;
    case "RedemptionClaimed":
      activityType = "claim-redemption";
      amountUsdc = event.data.amount;
      break;
    default:
      return null;
  }

  return {
    id: `evt-${activityType}-${signature.slice(0, 8)}-0`,
    date,
    type: activityType,
    description: formatActivityDescription({
      activityType,
      bonds,
      amountUsdc,
      cycleId,
      decimals,
    }),
    amount: Number(amountUsdc),
    txSignature: signature,
  };
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
      const matched = incoming.some((inc) => {
        if (item.txSignature && inc.txSignature) {
          return item.txSignature === inc.txSignature;
        }
        return (
          inc.type === item.type &&
          (item.amount === undefined || inc.amount === item.amount)
        );
      });
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
 * a real-time activity feed with dual-mode support (Indexer REST primary, RPC fallback).
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
  const indexerCursorRef = useRef<string | null>(null);
  const modeRef = useRef<"indexer" | "rpc">("indexer");
  const hasMoreRef = useRef(true);
  const isFetchingMoreRef = useRef(false);
  const entriesRef = useRef<ActivityEntry[]>([]);
  const lastUserAddressRef = useRef<string | undefined>(userAddress);
  const lastGenesisHashRef = useRef<string | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const hasLoadedRef = useRef(false);

  // Keep entriesRef in sync with state
  const updateEntriesState = useCallback((newEntries: ActivityEntry[]) => {
    entriesRef.current = newEntries;
    setEntries(newEntries);
  }, []);

  const updateHasMoreState = useCallback((val: boolean) => {
    hasMoreRef.current = val;
    setHasMore(val);
  }, []);

  const resetFeedState = useCallback(() => {
    entriesRef.current = [];
    updateEntriesState([]);
    updateHasMoreState(false);
    oldestSignatureRef.current = null;
    indexerCursorRef.current = null;
    hasLoadedRef.current = false;
    setIsLoading(false);
    setIsFetchingMore(false);
    isFetchingMoreRef.current = false;
    setScanProgress(null);
  }, [updateEntriesState, updateHasMoreState]);

  // Reset entries state on wallet address change to avoid cross-wallet contamination
  useEffect(() => {
    if (lastUserAddressRef.current !== userAddress) {
      lastUserAddressRef.current = userAddress;
      ++fetchIdRef.current;
      resetFeedState();
    }
  }, [userAddress, resetFeedState]);

  // Cleanup pending background timers on unmount
  useEffect(() => {
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  const fetchFeed = useCallback(async () => {
    if (!userAddress) {
      ++fetchIdRef.current;
      resetFeedState();
      return;
    }

    const fetchId = ++fetchIdRef.current;
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }

    try {
      // 1. Primary Path: Try Indexer REST API
      try {
        const res = await fetch(
          `/api/indexer/activity?user=${encodeURIComponent(userAddress)}&limit=20`,
          { cache: "no-store" }
        );

        if (res.ok) {
          const data = await res.json();
          if (data && data.fallback !== true) {
            if (fetchId !== fetchIdRef.current) return;

            modeRef.current = "indexer";
            indexerCursorRef.current = data.nextCursor || null;
            const moreAvailable = Boolean(data.nextCursor);
            updateHasMoreState(moreAvailable);

            const mergedEntries = mergeAndDeduplicate(
              entriesRef.current,
              data.entries || []
            );
            updateEntriesState(mergedEntries);

            if (!oldestSignatureRef.current && mergedEntries.length > 0) {
              const lastWithSig = [...mergedEntries]
                .reverse()
                .find((e) => Boolean(e.txSignature));
              if (lastWithSig?.txSignature) {
                oldestSignatureRef.current = lastWithSig.txSignature;
              }
            }

            return;
          }
        }
      } catch {
        // Non-critical: Fallback cleanly to on-chain RPC scanning
      }

      // 2. Fallback Path: Client-Side RPC Scanning
      modeRef.current = "rpc";
      const rpc = client.runtime.rpc;
      const walletAddr = address(userAddress);

      const genesisHash = await fetchClusterGenesisHash(rpc);

      if (
        genesisHash &&
        lastGenesisHashRef.current &&
        lastGenesisHashRef.current !== genesisHash
      ) {
        entriesRef.current = [];
        updateEntriesState([]);
        oldestSignatureRef.current = null;
        hasMoreRef.current = true;
        clearCachedEvents(userAddress, lastGenesisHashRef.current);
      }

      if (genesisHash) {
        lastGenesisHashRef.current = genesisHash;
      }

      const cached = getCachedEvents(userAddress, genesisHash ?? undefined);

      if (cached && cached.events.length > 0) {
        if (cached.oldestSignature !== undefined) {
          oldestSignatureRef.current = cached.oldestSignature;
        }
        if (cached.hasMore !== undefined) {
          updateHasMoreState(cached.hasMore);
        }
      }

      const fetchOpts =
        cached?.lastSignature && cached.events.length > 0
          ? { limit: 15, until: cached.lastSignature }
          : { limit: 15 };

      const result = await fetchProgramEvents(rpc, walletAddr, fetchOpts);

      if (fetchId !== fetchIdRef.current) return;

      let allEvents: ProgramEvent[] = result.events;

      if (cached && cached.events.length > 0) {
        if (result.events.length === 0 && result.oldestRawSignature === null) {
          allEvents = [];
          clearCachedEvents(userAddress, genesisHash ?? undefined);
        } else {
          allEvents = [...result.events, ...cached.events];
        }
      }

      if (!cached?.lastSignature) {
        if (result.oldestRawSignature) {
          oldestSignatureRef.current = result.oldestRawSignature;
        }
        updateHasMoreState(result.hasMore);
      } else if (!oldestSignatureRef.current && result.oldestRawSignature) {
        oldestSignatureRef.current = result.oldestRawSignature;
      }

      if (!oldestSignatureRef.current && allEvents.length > 0) {
        oldestSignatureRef.current = allEvents[allEvents.length - 1].signature;
      }

      if (allEvents.length > 0) {
        setCachedEvents(
          userAddress,
          allEvents.slice(0, 20),
          allEvents[0].signature,
          oldestSignatureRef.current,
          hasMoreRef.current,
          genesisHash ?? undefined
        );
      }

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
        const mergedEntries = mergeAndDeduplicate(
          entriesRef.current,
          parsedEntries
        );
        updateEntriesState(mergedEntries);
      }
    } catch (err) {
      console.error("useActivityFeed initial fetch error:", err);
    } finally {
      if (fetchId === fetchIdRef.current) {
        hasLoadedRef.current = true;
        setIsLoading(false);
      }
    }
  }, [
    client,
    userAddress,
    tokenDecimals,
    updateEntriesState,
    updateHasMoreState,
    resetFeedState,
  ]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  // Subscribe to real-time invalidation push events
  useProtocolSyncSubscription(fetchFeed, {
    scopes: ["all", "user"],
    debounceMs: 150,
  });

  /**
   * Lazily fetch the next batch of historical transactions.
   */
  const loadMore = useCallback(
    async (batchLimit: number = 15): Promise<boolean> => {
      if (!userAddress || !hasMoreRef.current || isFetchingMoreRef.current) {
        return false;
      }

      const fetchId = fetchIdRef.current;
      isFetchingMoreRef.current = true;
      setIsFetchingMore(true);

      try {
        // 1. Indexer Mode Pagination
        if (modeRef.current === "indexer" && indexerCursorRef.current) {
          try {
            const res = await fetch(
              `/api/indexer/activity?user=${encodeURIComponent(userAddress)}&limit=${batchLimit}&cursor=${encodeURIComponent(indexerCursorRef.current)}`,
              { cache: "no-store" }
            );

            if (res.ok) {
              const data = await res.json();
              if (data && data.fallback !== true) {
                if (fetchId !== fetchIdRef.current) return false;

                indexerCursorRef.current = data.nextCursor || null;
                const moreAvailable = Boolean(data.nextCursor);
                updateHasMoreState(moreAvailable);

                const merged = mergeAndDeduplicate(
                  entriesRef.current,
                  data.entries || []
                );
                updateEntriesState(merged);

                if (!oldestSignatureRef.current && merged.length > 0) {
                  const lastWithSig = [...merged]
                    .reverse()
                    .find((e) => Boolean(e.txSignature));
                  if (lastWithSig?.txSignature) {
                    oldestSignatureRef.current = lastWithSig.txSignature;
                  }
                }

                return moreAvailable;
              }
            }
          } catch {
            // Switch to RPC mode if indexer fails during pagination
            modeRef.current = "rpc";
          }
        }

        // 2. RPC Mode Pagination
        if (!oldestSignatureRef.current) {
          return false;
        }

        const rpc = client.runtime.rpc;
        const walletAddr = address(userAddress);

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
          updateHasMoreState(result.hasMore);
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
    [client, userAddress, tokenDecimals, updateEntriesState, updateHasMoreState]
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

      try {
        while (
          currentMatches < targetCount &&
          hasMoreRef.current &&
          batchCount < MAX_BATCHES
        ) {
          batchCount++;
          setScanProgress({
            currentBatch: batchCount,
            maxBatches: MAX_BATCHES,
          });

          const canContinue = await loadMore(15);
          currentMatches = entriesRef.current.filter(filterFn).length;

          if (!canContinue) break;
        }
      } finally {
        setScanProgress(null);
      }
    },
    [userAddress, loadMore]
  );

  const prependLocal = useCallback(
    (entry: ActivityEntry) => {
      const updated = mergeAndDeduplicate(entriesRef.current, [entry]);
      updateEntriesState(updated);

      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = setTimeout(() => {
        fetchFeed();
      }, 2500);
    },
    [updateEntriesState, fetchFeed]
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
