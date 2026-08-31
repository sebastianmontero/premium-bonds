"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { Address, getBase64Encoder } from "@solana/kit";
import {
  findDrawCyclePda,
  findPayoutRegistryPda,
  parseDrawCycle,
  parsePayoutRegistry,
  chunkArray,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../lib/bonds-sdk";
import { deriveRandomIndex, formatSeedHex } from "../lib/vrf-utils";
import {
  resolveDrawCycleTimestamp,
  getWinnerKey,
  calculateReinvestmentBreakdown,
} from "../lib/draw-helpers";
import { useProtocolSyncSubscription } from "./useProtocolSyncSubscription";
import type { PrizeHistoryEntry, RecentWinner, PrizeStatus } from "../types";

const base64Encoder = getBase64Encoder();
const OPTIMISTIC_TTL_MS = 30_000;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface OptimisticPrizeParams {
  drawCycleId: number;
  winnerIndex: number;
  bondsBought?: number;
  bondPrice?: number;
  unclaimedDust?: number;
}

interface DrawHistoryResult {
  /** Prize history for the connected user (sorted by cycle, newest first). */
  prizeHistory: PrizeHistoryEntry[];
  /** Recent winners from the latest completed draw cycle. */
  recentWinners: RecentWinner[];
  /** Initial loading state indicator. */
  isLoading: boolean;
  /** Background refetching indicator. */
  isRefetching: boolean;
  /** Refetch all data returning a Promise. */
  refetch: () => Promise<void>;
  /** Optimistically mark a user's prize as reinvested/disbursed. */
  markPrizeOptimisticallyProcessed: (params: OptimisticPrizeParams) => void;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetches draw cycle history, payout registries, and derives prize history
 * for the connected user + recent winners for the global ticker.
 *
 * Strategy:
 * 2. Fetch all DrawCycle and PayoutRegistry accounts in a single batch `getMultipleAccounts` RPC request.
 * 4. In memory, locate the latest completed cycle to populate `recentWinners` for the ticker widget.
 * 5. Filter all `PayoutRegistry` winner entries matching `userAddress` across all past cycles.
 * 6. Use client-side VRF to derive winning ticket indices for provable fairness.
 *
 * @param poolId - The unique ID of the pool.
 * @param currentDrawCycleId - The current draw cycle ID on-chain.
 * @param userAddress - The base58 user wallet address.
 * @param tokenSymbol - Token symbol for UI formatting (defaults to "USDC").
 * @param bondPrice - Price per ticket in base units (defaults to 5_000_000).
 * @param maxCyclesToFetch - Number of historical cycles to inspect (defaults to 50).
 * @returns Prize history entries, recent winners, loading status, and refetch handler.
 */
export function useDrawHistory(
  poolId: number,
  currentDrawCycleId: number | undefined,
  userAddress: string | undefined,
  tokenSymbol: string = "USDC",
  bondPrice: number = 5_000_000,
  maxCyclesToFetch: number = 50,
  currentCycleEndAt?: number,
  cycleDurationSeconds: number = 604800
): DrawHistoryResult {
  const client = useSolanaClient();
  const [prizeHistory, setPrizeHistory] = useState<PrizeHistoryEntry[]>([]);
  const [recentWinners, setRecentWinners] = useState<RecentWinner[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const fetchIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastUserAddressRef = useRef<string | undefined>(userAddress);
  const lastPoolIdRef = useRef<number>(poolId);
  const lastDrawCycleIdRef = useRef<number | undefined>(currentDrawCycleId);

  // Optimistic prize tracker map keyed by `${drawCycleId}-${winnerIndex}` with 30s TTL
  const optimisticProcessedPrizesRef = useRef<
    Map<string, { bondsBought: number; timestamp: number }>
  >(new Map());

  useEffect(() => {
    if (
      lastUserAddressRef.current !== userAddress ||
      lastPoolIdRef.current !== poolId ||
      lastDrawCycleIdRef.current !== currentDrawCycleId
    ) {
      lastUserAddressRef.current = userAddress;
      lastPoolIdRef.current = poolId;
      lastDrawCycleIdRef.current = currentDrawCycleId;
      hasLoadedRef.current = false;
      optimisticProcessedPrizesRef.current.clear();
    }
  }, [userAddress, poolId, currentDrawCycleId]);

  const markPrizeOptimisticallyProcessed = useCallback(
    ({
      drawCycleId,
      winnerIndex,
      bondsBought,
      bondPrice: price = 5_000_000,
      unclaimedDust = 0,
    }: OptimisticPrizeParams) => {
      const key = getWinnerKey(drawCycleId, winnerIndex);

      setPrizeHistory((prev) =>
        prev.map((entry) => {
          if (
            entry.drawCycleId === drawCycleId &&
            entry.winnerIndex === winnerIndex
          ) {
            const breakdown = calculateReinvestmentBreakdown(
              entry.amount,
              unclaimedDust,
              price,
              bondsBought
            );

            optimisticProcessedPrizesRef.current.set(key, {
              bondsBought: breakdown.bondsBought,
              timestamp: Date.now(),
            });

            return {
              ...entry,
              status: "reinvested" as PrizeStatus,
              bondsBought: breakdown.bondsBought,
              reinvestedTickets: breakdown.bondsBought,
              usedPriorDust: breakdown.usedPriorDust,
              dustAccumulated: breakdown.dustAccumulated,
            };
          }
          return entry;
        })
      );
    },
    []
  );

  const fetchHistory = useCallback(async () => {
    if (currentDrawCycleId === undefined || currentDrawCycleId < 0) {
      setPrizeHistory([]);
      setRecentWinners([]);
      hasLoadedRef.current = false;
      setIsLoading(false);
      setIsRefetching(false);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    } else {
      setIsRefetching(true);
    }

    try {
      // 1. Primary path: Query Indexer REST API
      try {
        const userQuery = userAddress ? `&user=${userAddress}` : "";
        const [winnersRes, tickerRes] = await Promise.all([
          userAddress
            ? fetch(
                `/api/indexer/winners?poolId=${poolId}${userQuery}&limit=${maxCyclesToFetch}`
              )
            : Promise.resolve(null),
          fetch(`/api/indexer/winners?poolId=${poolId}&limit=10`),
        ]);

        const winnersJson = winnersRes ? await winnersRes.json() : null;
        const tickerJson = tickerRes ? await tickerRes.json() : null;

        if (
          (!winnersJson || winnersJson.fallbackRequired === false) &&
          tickerJson &&
          tickerJson.fallbackRequired === false
        ) {
          if (fetchId !== fetchIdRef.current) return;

          const now = Date.now();
          interface ApiWinnerHistoryRecord {
            cycleId: number;
            winnerIndex: number;
            winnerAddress: string;
            amountOwed: number | string;
            bondsBought?: number | string | null;
            processed?: boolean | null;
            tierIndex: number;
            winningTicketIdx?: number | string | null;
            claimSignature?: string | null;
            revealedAt: number;
          }

          const rawPrizes = (winnersJson?.data || []) as ApiWinnerHistoryRecord[];
          const mappedPrizes: PrizeHistoryEntry[] = rawPrizes.map((w) => {
            const key = getWinnerKey(w.cycleId, w.winnerIndex);
            const opt = optimisticProcessedPrizesRef.current.get(key);
            let isProcessed = Boolean(w.processed);
            let effectiveBondsBought = Number(w.bondsBought || 0);

            if (opt) {
              if (w.processed || now - opt.timestamp > OPTIMISTIC_TTL_MS) {
                optimisticProcessedPrizesRef.current.delete(key);
              } else {
                isProcessed = true;
                effectiveBondsBought =
                  effectiveBondsBought > 0
                    ? effectiveBondsBought
                    : opt.bondsBought;
              }
            }

            const status: PrizeStatus = isProcessed
              ? "reinvested"
              : "processing";
            const amountOwed = Number(w.amountOwed);
            let reinvestedTickets: number | undefined;
            let usedPriorDust: number | undefined;
            let dustAccumulated: number | undefined;

            if (isProcessed) {
              const breakdown = calculateReinvestmentBreakdown(
                amountOwed,
                0,
                bondPrice,
                effectiveBondsBought
              );
              reinvestedTickets = breakdown.bondsBought;
              effectiveBondsBought = breakdown.bondsBought;
              usedPriorDust = breakdown.usedPriorDust;
              dustAccumulated = breakdown.dustAccumulated;
            }

            return {
              drawCycleId: w.cycleId,
              date: new Date(w.revealedAt * 1000).toISOString(),
              tierIndex: w.tierIndex,
              amount: amountOwed,
              winnerIndex: w.winnerIndex,
              status,
              bondsBought: effectiveBondsBought,
              dustAccumulated,
              usedPriorDust,
              reinvestedTickets,
              winningTicket:
                w.winningTicketIdx != null
                  ? `#${w.winningTicketIdx}`
                  : undefined,
              claimSignature: w.claimSignature || undefined,
              revealedAt: w.revealedAt,
            };
          });

          const rawTicker = (tickerJson.data || []) as ApiWinnerHistoryRecord[];
          const mappedRecent: RecentWinner[] = rawTicker.map(
            (w) => ({
              address: w.winnerAddress,
              amount: Number(w.amountOwed),
              tierIndex: w.tierIndex,
              cycleId: w.cycleId,
              tokenSymbol,
            })
          );

          setPrizeHistory(mappedPrizes);
          setRecentWinners(mappedRecent);
          return;
        }
      } catch {
        // Fall back to RPC batch query
      }

      // 2. Secondary fallback path: Direct Solana RPC batch queries
      const rpc = client.runtime.rpc;
      const userPrizes: PrizeHistoryEntry[] = [];
      const latestWinners: RecentWinner[] = [];
      let latestCompleteCycleFound = false;

      // Build range of historical cycle IDs (newest first)
      const cycleIds: number[] = [];
      for (
        let cycleId = currentDrawCycleId;
        cycleId >= 0 && cycleId > currentDrawCycleId - maxCyclesToFetch;
        cycleId--
      ) {
        cycleIds.push(cycleId);
      }

      if (cycleIds.length === 0) {
        if (fetchId === fetchIdRef.current) {
          setPrizeHistory([]);
          setRecentWinners([]);
          hasLoadedRef.current = true;
          setIsLoading(false);
          setIsRefetching(false);
        }
        return;
      }

      // Deriving PDAs for all candidate cycles in parallel
      const pdaPairs = await Promise.all(
        cycleIds.map(async (cId) => {
          const drawPda = await findDrawCyclePda(poolId, cId);
          const payoutPda = await findPayoutRegistryPda(poolId, cId);
          return { cycleId: cId, drawPda, payoutPda };
        })
      );

      if (fetchId !== fetchIdRef.current) return;

      // Construct ordered array of all PDAs for single-RPC batch request
      const pdaKeys: Address[] = [];
      for (const pair of pdaPairs) {
        pdaKeys.push(pair.drawPda, pair.payoutPda);
      }

      // Chunk PDA keys to respect 100-account RPC getMultipleAccounts limit
      const pdaChunks = chunkArray(pdaKeys, 80);
      const accountsResArrays = await Promise.all(
        pdaChunks.map((chunk) =>
          rpc
            .getMultipleAccounts(chunk, {
              encoding: "base64",
              commitment: "confirmed",
            })
            .send()
        )
      );

      if (fetchId !== fetchIdRef.current) return;

      const accountValues = accountsResArrays.flatMap(
        (res) => res?.value || []
      );

      const now = Date.now();

      // Process each cycle pair in memory
      for (let i = 0; i < pdaPairs.length; i++) {
        const cycleId = pdaPairs[i].cycleId;
        const drawAcc = accountValues[2 * i];
        const payoutAcc = accountValues[2 * i + 1];

        if (!drawAcc?.data) continue;

        let drawCycle: DrawCycleInfo;
        let payout: PayoutRegistryInfo | undefined;

        try {
          const drawBytes = new Uint8Array(
            base64Encoder.encode(drawAcc.data[0])
          );
          drawCycle = parseDrawCycle(drawBytes);

          if (payoutAcc?.data) {
            const payoutBytes = new Uint8Array(
              base64Encoder.encode(payoutAcc.data[0])
            );
            payout = parsePayoutRegistry(payoutBytes);
          }
        } catch {
          continue;
        }

        // Only process completed draw cycles for prizes & winners
        if (drawCycle.status !== "Complete" || !payout) continue;

        // Extract Recent Winners from the latest completed cycle
        if (!latestCompleteCycleFound) {
          latestCompleteCycleFound = true;
          for (const winner of payout.winners.slice(0, payout.winnersCount)) {
            const addressStr = winner.winner
              ? winner.winner.toString()
              : "Unknown";
            latestWinners.push({
              address: addressStr,
              amount: Number(winner.amountOwed),
              tierIndex: winner.tierIndex,
              cycleId,
              tokenSymbol,
            });
          }
        }

        // Extract user's prizes from this payout
        if (userAddress) {
          const tierWinnerCounts: Record<number, number> = {};

          for (let wi = 0; wi < payout.winnersCount; wi++) {
            const winner = payout.winners[wi];
            const slotInTier = tierWinnerCounts[winner.tierIndex] ?? 0;
            tierWinnerCounts[winner.tierIndex] = slotInTier + 1;

            if (winner.winner !== userAddress) continue;

            const amountOwed = Number(winner.amountOwed);
            const key = getWinnerKey(cycleId, wi);
            const opt = optimisticProcessedPrizesRef.current.get(key);

            let isProcessed = !!winner.processed;
            let effectiveBondsBought = winner.bondsBought ?? 0;

            if (opt) {
              if (winner.processed || now - opt.timestamp > OPTIMISTIC_TTL_MS) {
                optimisticProcessedPrizesRef.current.delete(key);
              } else {
                isProcessed = true;
                effectiveBondsBought =
                  effectiveBondsBought > 0
                    ? effectiveBondsBought
                    : opt.bondsBought;
              }
            }

            // Determine status
            const status: PrizeStatus = isProcessed
              ? "reinvested"
              : "processing";

            // Derive winning ticket index via client-side VRF
            let winningTicketIdx: number | undefined;
            let vrfSeed: string | undefined;
            try {
              const allZero = drawCycle.randomnessSeed.every((b) => b === 0);
              if (!allZero && drawCycle.lockedTicketCount > 0) {
                winningTicketIdx = await deriveRandomIndex(
                  drawCycle.randomnessSeed,
                  winner.tierIndex,
                  slotInTier,
                  cycleId,
                  drawCycle.lockedTicketCount
                );
                vrfSeed = formatSeedHex(drawCycle.randomnessSeed);
              }
            } catch {
              // VRF derivation failed — non-critical
            }

            // Compute reinvested tickets count, used prior dust, and leftover dust
            let reinvestedTickets: number | undefined;
            let usedPriorDust: number | undefined;
            let dustAccumulated: number | undefined;

            if (isProcessed) {
              const breakdown = calculateReinvestmentBreakdown(
                amountOwed,
                0,
                bondPrice,
                effectiveBondsBought
              );
              reinvestedTickets = breakdown.bondsBought;
              effectiveBondsBought = breakdown.bondsBought;
              usedPriorDust = breakdown.usedPriorDust;
              dustAccumulated = breakdown.dustAccumulated;
            }

            const { timestamp: drawDateTimestamp } = resolveDrawCycleTimestamp(
              {
                revealedAt: payout.revealedAt
                  ? Number(payout.revealedAt)
                  : undefined,
                completedAt: drawCycle.completedAt
                  ? Number(drawCycle.completedAt)
                  : undefined,
                initiatedAt: drawCycle.initiatedAt
                  ? Number(drawCycle.initiatedAt)
                  : undefined,
                cycleId,
              },
              {
                currentCycleEndAt,
                currentCycleId: currentDrawCycleId,
                stakeCycleDurationHrs: cycleDurationSeconds / 3600,
              }
            );

            userPrizes.push({
              drawCycleId: cycleId,
              date: new Date(drawDateTimestamp * 1000).toISOString(),
              tierIndex: winner.tierIndex,
              amount: amountOwed,
              winnerIndex: wi,
              status,
              bondsBought: effectiveBondsBought,
              dustAccumulated,
              usedPriorDust,
              reinvestedTickets,
              winningTicket:
                winningTicketIdx !== undefined
                  ? `#${winningTicketIdx}`
                  : undefined,
              vrfSeed,
              revealedAt: payout.revealedAt
                ? Number(payout.revealedAt)
                : undefined,
            });
          }
        }
      }

      if (fetchId !== fetchIdRef.current) return;

      setPrizeHistory(userPrizes);
      setRecentWinners(latestWinners);
    } catch (err) {
      console.error("useDrawHistory fetch error:", err);
    } finally {
      if (fetchId === fetchIdRef.current) {
        hasLoadedRef.current = true;
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, [
    client,
    poolId,
    currentDrawCycleId,
    userAddress,
    tokenSymbol,
    bondPrice,
    maxCyclesToFetch,
    currentCycleEndAt,
    cycleDurationSeconds,
  ]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  // Listen for custom protocol draw/settlement events with scoped filtering
  useProtocolSyncSubscription(fetchHistory, {
    scopes: ["draws"],
    poolId,
    debounceMs: 150,
  });

  return {
    prizeHistory,
    recentWinners,
    isLoading,
    isRefetching,
    refetch: fetchHistory,
    markPrizeOptimisticallyProcessed,
  };
}
