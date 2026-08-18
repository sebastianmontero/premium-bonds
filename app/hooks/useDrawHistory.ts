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
import { resolveDrawCycleTimestamp } from "../lib/draw-helpers";
import type { PrizeHistoryEntry, RecentWinner, PrizeStatus } from "../types";

const base64Encoder = getBase64Encoder();

// ─── Types ───────────────────────────────────────────────────────────────────

interface DrawHistoryResult {
  /** Prize history for the connected user (sorted by cycle, newest first). */
  prizeHistory: PrizeHistoryEntry[];
  /** Recent winners from the latest completed draw cycle. */
  recentWinners: RecentWinner[];
  /** Whether data is currently loading. */
  isLoading: boolean;
  /** Refetch all data. */
  refetch: () => void;
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
  const fetchIdRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const lastUserAddressRef = useRef<string | undefined>(userAddress);
  const lastPoolIdRef = useRef<number>(poolId);
  const lastDrawCycleIdRef = useRef<number | undefined>(currentDrawCycleId);

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
    }
  }, [userAddress, poolId, currentDrawCycleId]);

  const fetchHistory = useCallback(async () => {
    if (currentDrawCycleId === undefined || currentDrawCycleId < 0) {
      setPrizeHistory([]);
      setRecentWinners([]);
      hasLoadedRef.current = false;
      return;
    }

    const fetchId = ++fetchIdRef.current;
    if (!hasLoadedRef.current) {
      setIsLoading(true);
    }

    try {
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
          rpc.getMultipleAccounts(chunk, { encoding: "base64" }).send()
        )
      );

      if (fetchId !== fetchIdRef.current) return;

      const accountValues = accountsResArrays.flatMap(
        (res) => res?.value || []
      );

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

            // Determine status
            const status: PrizeStatus = winner.processed
              ? "reinvested"
              : "processing";
            const amountOwed = Number(winner.amountOwed);
            const bondsBought = winner.bondsBought ?? 0;

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

            // Compute reinvested tickets count, used prior dust, and leftover dust:
            let reinvestedTickets: number | undefined;
            let usedPriorDust: number | undefined;
            let dustAccumulated: number | undefined;

            if (winner.processed) {
              reinvestedTickets = bondsBought;
              const totalTicketValue = bondsBought * bondPrice;

              if (totalTicketValue > amountOwed) {
                usedPriorDust = totalTicketValue - amountOwed;
                dustAccumulated = 0;
              } else {
                dustAccumulated = amountOwed - totalTicketValue;
              }
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
              bondsBought,
              dustAccumulated,
              usedPriorDust,
              reinvestedTickets,
              winningTicket:
                winningTicketIdx !== undefined
                  ? `#${winningTicketIdx}`
                  : undefined,
              vrfSeed,
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
        setIsLoading(false);
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

  return {
    prizeHistory,
    recentWinners,
    isLoading,
    refetch: fetchHistory,
  };
}
