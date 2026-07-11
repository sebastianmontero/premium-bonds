"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { address, Address, getBase64Encoder } from "@solana/kit";
import {
  findDrawCyclePda,
  findPayoutRegistryPda,
  parseDrawCycle,
  parsePayoutRegistry,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../lib/bonds-sdk";
import { deriveRandomIndex, formatSeedHex } from "../lib/vrf-utils";
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function fetchAccountData(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: any,
  pda: Address
): Promise<Uint8Array | null> {
  try {
    const acc = await rpc.getAccountInfo(pda, { encoding: "base64" }).send();
    if (acc?.value) {
      return new Uint8Array(base64Encoder.encode(acc.value.data[0]));
    }
  } catch {
    // Account doesn't exist
  }
  return null;
}

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetches draw cycle history, payout registries, and derives prize history
 * for the connected user + recent winners for the global ticker.
 *
 * Strategy:
 * 1. Walk backwards from currentDrawCycleId to find completed draw cycles.
 * 2. For each completed cycle, fetch its PayoutRegistry.
 * 3. Filter winners matching the user's address → PrizeHistoryEntry[].
 * 4. Extract all winners from the latest completed draw → RecentWinner[].
 * 5. Use client-side VRF to derive winning ticket indices for provable fairness.
 */
export function useDrawHistory(
  poolId: number,
  currentDrawCycleId: number | undefined,
  userAddress: string | undefined,
  tokenSymbol: string = "USDC",
  bondPrice: number = 5_000_000,
  maxCyclesToFetch: number = 10
): DrawHistoryResult {
  const client = useSolanaClient();
  const [prizeHistory, setPrizeHistory] = useState<PrizeHistoryEntry[]>([]);
  const [recentWinners, setRecentWinners] = useState<RecentWinner[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const fetchIdRef = useRef(0);

  const fetchHistory = useCallback(async () => {
    if (currentDrawCycleId === undefined || currentDrawCycleId < 1) {
      setPrizeHistory([]);
      setRecentWinners([]);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setIsLoading(true);

    try {
      const rpc = client.runtime.rpc;
      const userPrizes: PrizeHistoryEntry[] = [];
      const latestWinners: RecentWinner[] = [];
      let latestCompleteCycleFound = false;

      // Walk backwards from the most recent cycle
      // currentDrawCycleId might be AwaitingYield or AwaitingRandomness,
      // so we start checking from currentDrawCycleId itself going down
      for (
        let cycleId = currentDrawCycleId;
        cycleId >= 1 && cycleId > currentDrawCycleId - maxCyclesToFetch;
        cycleId--
      ) {
        if (fetchId !== fetchIdRef.current) return; // Stale fetch

        // Fetch DrawCycle account
        const drawCyclePda = await findDrawCyclePda(poolId, cycleId);
        const drawData = await fetchAccountData(rpc, drawCyclePda);
        if (!drawData) continue;

        let drawCycle: DrawCycleInfo;
        try {
          drawCycle = parseDrawCycle(drawData);
        } catch {
          continue;
        }

        // Only process completed draw cycles
        if (drawCycle.status !== "Complete") continue;

        // Fetch PayoutRegistry for this cycle
        const payoutPda = await findPayoutRegistryPda(poolId, cycleId);
        const payoutData = await fetchAccountData(rpc, payoutPda);
        if (!payoutData) continue;

        let payout: PayoutRegistryInfo;
        try {
          payout = parsePayoutRegistry(payoutData);
        } catch {
          continue;
        }

        // Extract Recent Winners from the latest completed cycle
        if (!latestCompleteCycleFound) {
          latestCompleteCycleFound = true;
          for (const winner of payout.winners) {
            latestWinners.push({
              address: winner.winnerPubkey.toString(),
              amount: Number(winner.amountOwed),
              tierIndex: winner.tierIndex,
              cycleId,
              tokenSymbol,
            });
          }
        }

        // Extract user's prizes from this payout
        if (userAddress) {
          for (let wi = 0; wi < payout.winners.length; wi++) {
            const winner = payout.winners[wi];
            if (winner.winnerPubkey.toString() !== userAddress) continue;

            // Determine status
            let status: PrizeStatus = "processing";
            const amountOwed = Number(winner.amountOwed);
            const amountReinvested = Number(winner.amountReinvested);

            if (winner.processed) {
              status = "reinvested";
            } else if (amountReinvested > 0) {
              status = "partial";
            }

            // Derive winning ticket index via client-side VRF
            let winningTicketIdx: number | undefined;
            let vrfSeed: string | undefined;
            try {
              const allZero = drawCycle.randomnessSeed.every((b) => b === 0);
              if (!allZero) {
                winningTicketIdx = await deriveRandomIndex(
                  drawCycle.randomnessSeed,
                  winner.tierIndex,
                  wi, // winner slot within tier
                  cycleId,
                  drawCycle.lockedTicketCount
                );
                vrfSeed = formatSeedHex(drawCycle.randomnessSeed);
              }
            } catch {
              // VRF derivation failed — non-critical
            }

            // Compute reinvested tickets count
            const reinvestedTickets =
              amountReinvested > 0
                ? Math.floor(amountReinvested / bondPrice)
                : undefined;

            // Compute dust
            const dustAccumulated =
              winner.processed && amountOwed > amountReinvested
                ? amountOwed - amountReinvested
                : undefined;

            userPrizes.push({
              drawCycleId: cycleId,
              date: new Date().toISOString().split("T")[0], // We'll refine with blockTime if available
              tierIndex: winner.tierIndex,
              amount: amountOwed,
              winnerIndex: wi,
              status,
              amountReinvested,
              dustAccumulated,
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
