"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { Address, getBase64Encoder } from "@solana/kit";
import {
  findDrawCyclePda,
  findPayoutRegistryPda,
  findPrizePoolPda,
  parseDrawCycle,
  parsePayoutRegistry,
  parsePrizePool,
  parseTicketRegistry,
  DrawCycleInfo,
  PayoutRegistryInfo,
  UserEntryInfo,
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

// ─── Hook ────────────────────────────────────────────────────────────────────

/**
 * Fetches draw cycle history, payout registries, and derives prize history
 * for the connected user + recent winners for the global ticker.
 *
 * Strategy:
 * 1. Calculate PDAs for up to `maxCyclesToFetch` (defaults to 50) past draw cycles.
 * 2. Fetch TicketRegistry to resolve `winner.userIndex` to owner wallet addresses.
 * 3. Fetch all DrawCycle and PayoutRegistry accounts in a single batch `getMultipleAccounts` RPC request.
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
  maxCyclesToFetch: number = 50
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

      // 1. Fetch PrizePool and TicketRegistry for owner pubkey resolution
      let registryEntries: UserEntryInfo[] = [];
      let currentUserIndex: number = -1;
      try {
        const poolPda = await findPrizePoolPda(poolId);
        const poolAcc = await rpc
          .getAccountInfo(poolPda, { encoding: "base64" })
          .send();
        if (poolAcc?.value?.data) {
          const poolBytes = new Uint8Array(
            base64Encoder.encode(poolAcc.value.data[0])
          );
          const poolState = parsePrizePool(poolBytes);
          const registryAcc = await rpc
            .getAccountInfo(poolState.ticketRegistry, { encoding: "base64" })
            .send();
          if (registryAcc?.value?.data) {
            const regBytes = new Uint8Array(
              base64Encoder.encode(registryAcc.value.data[0])
            );
            const regState = parseTicketRegistry(regBytes);
            registryEntries = regState.entries;
            if (userAddress) {
              currentUserIndex = registryEntries.findIndex(
                (e) => e.owner.toString() === userAddress
              );
            }
          }
        }
      } catch {
        // Fallback if TicketRegistry resolution fails
      }

      // Build range of historical cycle IDs (newest first)
      const cycleIds: number[] = [];
      for (
        let cycleId = currentDrawCycleId;
        cycleId >= 1 && cycleId > currentDrawCycleId - maxCyclesToFetch;
        cycleId--
      ) {
        cycleIds.push(cycleId);
      }

      if (cycleIds.length === 0) {
        if (fetchId === fetchIdRef.current) {
          setPrizeHistory([]);
          setRecentWinners([]);
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

      // Single RPC batch request via getMultipleAccounts
      const accountsRes = await rpc
        .getMultipleAccounts(pdaKeys, { encoding: "base64" })
        .send();

      if (fetchId !== fetchIdRef.current) return;

      const accountValues = accountsRes?.value || [];

      // Process each cycle pair in memory
      for (let i = 0; i < pdaPairs.length; i++) {
        const cycleId = pdaPairs[i].cycleId;
        const drawAcc = accountValues[2 * i];
        const payoutAcc = accountValues[2 * i + 1];

        if (!drawAcc?.data || !payoutAcc?.data) continue;

        let drawCycle: DrawCycleInfo;
        let payout: PayoutRegistryInfo;

        try {
          const drawBytes = new Uint8Array(
            base64Encoder.encode(drawAcc.data[0])
          );
          const payoutBytes = new Uint8Array(
            base64Encoder.encode(payoutAcc.data[0])
          );
          drawCycle = parseDrawCycle(drawBytes);
          payout = parsePayoutRegistry(payoutBytes);
        } catch {
          continue;
        }

        // Only process completed draw cycles
        if (drawCycle.status !== "Complete") continue;

        // Extract Recent Winners from the latest completed cycle
        if (!latestCompleteCycleFound) {
          latestCompleteCycleFound = true;
          for (const winner of payout.winners) {
            const ownerAddr = registryEntries[winner.userIndex]?.owner;
            const addressStr = ownerAddr
              ? ownerAddr.toString()
              : `User #${winner.userIndex}`;
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
        if (userAddress && currentUserIndex !== -1) {
          for (let wi = 0; wi < payout.winners.length; wi++) {
            const winner = payout.winners[wi];
            if (winner.userIndex !== currentUserIndex) continue;

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

            // Compute reinvested tickets count, used prior dust, and leftover dust:
            // On-chain, when prior dust is combined with current winnings to purchase an extra ticket,
            // 100% of current winnings (amountOwed) is recorded in amountReinvested.
            // If amountReinvested % bondPrice !== 0 for a processed winner, Math.ceil gives the true tickets purchased.
            let reinvestedTickets: number | undefined;
            let usedPriorDust: number | undefined;
            let dustAccumulated: number | undefined;

            if (amountReinvested > 0) {
              if (amountReinvested % bondPrice !== 0 && winner.processed) {
                reinvestedTickets = Math.ceil(amountReinvested / bondPrice);
                const totalTicketValue = reinvestedTickets * bondPrice;
                usedPriorDust =
                  totalTicketValue > amountOwed
                    ? totalTicketValue - amountOwed
                    : undefined;
                dustAccumulated = 0;
              } else {
                reinvestedTickets = Math.floor(amountReinvested / bondPrice);
                if (winner.processed && amountOwed > amountReinvested) {
                  dustAccumulated = amountOwed - amountReinvested;
                }
              }
            }

            userPrizes.push({
              drawCycleId: cycleId,
              date: new Date().toISOString().split("T")[0],
              tierIndex: winner.tierIndex,
              amount: amountOwed,
              winnerIndex: wi,
              status,
              amountReinvested,
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
