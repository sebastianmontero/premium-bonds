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

interface ActivityFeedResult {
  /** Activity feed entries sorted by date descending. */
  entries: ActivityEntry[];
  /** Whether data is currently loading. */
  isLoading: boolean;
  /** Refetch all data. */
  refetch: () => void;
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

function eventToActivity(event: ProgramEvent): ActivityEntry | null {
  const date = event.blockTime
    ? new Date(Number(event.blockTime) * 1000).toISOString().split("T")[0]
    : new Date().toISOString().split("T")[0];

  switch (event.type) {
    case "BondsPurchased": {
      const d = event.data;
      return {
        id: `evt-buy-${event.signature.slice(0, 8)}`,
        date,
        type: "deposit" as ActivityType,
        description: `Deposited ${formatAmount(d.amount)} USDC → +${d.bonds} tickets`,
        amount: Number(d.amount),
      };
    }
    case "BondsSold": {
      const d = event.data;
      return {
        id: `evt-sell-${event.signature.slice(0, 8)}`,
        date,
        type: "withdraw" as ActivityType,
        description: `Sold ${d.bonds} bonds (${formatAmount(d.principal)} USDC) · Pending settle`,
        amount: Number(d.principal),
      };
    }
    case "WinningsReinvested": {
      const d = event.data;
      if (d.bondsBought === 0) return null; // Skip zero-bond batches
      return {
        id: `evt-reinvest-${event.signature.slice(0, 8)}`,
        date,
        type: "auto-reinvest" as ActivityType,
        description: d.isFinalBatch
          ? `Draw #${d.cycleId} reinvestment finalized: +${d.bondsBought} tickets from ${formatAmount(d.amountReinvested)} USDC`
          : `Draw #${d.cycleId} batch reinvest: +${d.bondsBought} tickets (${formatAmount(d.amountReinvested)} USDC)`,
        amount: Number(d.amountReinvested),
      };
    }
    case "WinningsClaimed": {
      const d = event.data;
      return {
        id: `evt-claim-win-${event.signature.slice(0, 8)}`,
        date,
        type: "win" as ActivityType,
        description: `Claimed accumulated winnings of ${formatAmount(d.amount)} USDC · Pending settle`,
        amount: Number(d.amount),
      };
    }
    case "RedemptionClaimed": {
      const d = event.data;
      return {
        id: `evt-redeem-${event.signature.slice(0, 8)}`,
        date,
        type: "claim-redemption" as ActivityType,
        description: `Claimed settled redemption of ${formatAmount(d.amount)} USDC to wallet`,
        amount: Number(d.amount),
      };
    }
    case "DrawCompleted":
      // Draw completion events are global, not user-specific activity
      return null;
    default:
      return null;
  }
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetches and parses Anchor program events for the connected user to build
 * a real-time activity feed.
 *
 * Strategy:
 * 1. Fetch transaction signatures for the UserWinnings PDA (touches all
 *    prize-related instructions) and the user's wallet address (touches
 *    buy_bonds, sell_bonds, claim_redemption, claim_non_reinvested_winnings).
 * 2. Parse Anchor event logs from each transaction.
 * 3. Filter events relevant to the user.
 * 4. Convert to ActivityEntry[] for the UI.
 * 5. Cache results in localStorage for fast subsequent loads.
 *
 * Also exposes `prependLocal()` for optimistic UI updates after transactions.
 */
export function useActivityFeed(
  userAddress: string | undefined,
  tokenDecimals: number = 6
): ActivityFeedResult {
  const client = useSolanaClient();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchFeed = useCallback(async () => {
    if (!userAddress) {
      setEntries([]);
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
      const fetchOpts = cached
        ? { limit: 50, until: cached.lastSignature }
        : { limit: 100 };

      // Fetch events from the user's wallet address
      // This captures: buy_bonds, sell_bonds, claim_redemption, claim_non_reinvested_winnings
      const events = await fetchProgramEvents(rpc, walletAddr, fetchOpts);

      if (fetchId !== fetchIdRef.current) return;

      // Merge with cached events if doing incremental fetch
      let allEvents: ProgramEvent[] = events;
      if (cached && cached.events.length > 0) {
        allEvents = [...events, ...cached.events];
      }

      // Update cache
      if (allEvents.length > 0) {
        setCachedEvents(cacheKey, allEvents, allEvents[0].signature);
      }

      // Convert events to ActivityEntry[]
      const activityEntries: ActivityEntry[] = [];
      const seenIds = new Set<string>();

      for (const event of allEvents) {
        const entry = eventToActivity(event);
        if (entry && !seenIds.has(entry.id)) {
          seenIds.add(entry.id);
          activityEntries.push(entry);
        }
      }

      // Sort by date descending (most recent first)
      activityEntries.sort(
        (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
      );

      if (fetchId === fetchIdRef.current) {
        setEntries(activityEntries);
      }
    } catch (err) {
      console.error("useActivityFeed fetch error:", err);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, userAddress, tokenDecimals]);

  useEffect(() => {
    fetchFeed();
  }, [fetchFeed]);

  const prependLocal = useCallback((entry: ActivityEntry) => {
    setEntries((prev) => [entry, ...prev]);
  }, []);

  return {
    entries,
    isLoading,
    refetch: fetchFeed,
    prependLocal,
  };
}
