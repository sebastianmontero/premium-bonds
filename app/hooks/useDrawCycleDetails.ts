"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { getBase64Encoder } from "@solana/kit";
import {
  findDrawCyclePda,
  findPayoutRegistryPda,
  parseDrawCycle,
  parsePayoutRegistry,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../lib/bonds-sdk";
import {
  formatDrawCycleSummary,
  parseWinnersWithVrf,
  getWinnerKey,
} from "../lib/draw-helpers";
import { useProtocolSyncSubscription } from "./useProtocolSyncSubscription";
import type { DetailedDrawCycle, DrawWinnerRecord } from "../types";

const base64Encoder = getBase64Encoder();
const OPTIMISTIC_TTL_MS = 30_000;

interface DrawCycleDetailsResult {
  /** Detailed draw cycle with parsed winners and VRF derivations. */
  details: DetailedDrawCycle | null;
  /** Initial loading state indicator (true only before first data load). */
  isLoading: boolean;
  /** Background refetching indicator (true during silent background refreshes). */
  isRefetching: boolean;
  /** Error message if fetch failed. */
  error: string | null;
  /** Refetch function returning a Promise. */
  refetch: () => Promise<void>;
  /** Optimistically marks a winner as processed to guarantee immediate zero-flicker UI updates. */
  markWinnerOptimisticallyProcessed: (
    winnerIndex: number,
    bondsBought?: number,
    bondPrice?: number
  ) => void;
}

/**
 * On-demand hook for inspecting a specific draw cycle's complete PayoutRegistry.
 * Computes deterministic winning ticket numbers via client-side VRF derivation.
 */
export function useDrawCycleDetails(
  poolId: number,
  cycleId: number | null | undefined,
  userAddress?: string
): DrawCycleDetailsResult {
  const client = useSolanaClient();
  const [details, setDetails] = useState<DetailedDrawCycle | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefetching, setIsRefetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fetchIdRef = useRef(0);
  const detailsRef = useRef<DetailedDrawCycle | null>(null);

  // Cycle-scoped optimistic winner tracker with 30s TTL
  const optimisticProcessedWinnersRef = useRef<
    Map<string, { bondsBought: number; timestamp: number }>
  >(new Map());

  // Keep detailsRef in sync with state
  useEffect(() => {
    detailsRef.current = details;
  }, [details]);

  // Reset optimistic tracker and state when cycleId or poolId changes
  useEffect(() => {
    setDetails(null);
    detailsRef.current = null;
    setError(null);
    optimisticProcessedWinnersRef.current.clear();
  }, [poolId, cycleId]);

  const markWinnerOptimisticallyProcessed = useCallback(
    (
      winnerIndex: number,
      bondsBought?: number,
      bondPrice: number = 5_000_000
    ) => {
      if (cycleId === null || cycleId === undefined) return;
      const key = getWinnerKey(cycleId, winnerIndex);

      setDetails((prev) => {
        if (!prev) return prev;
        const targetWinner = prev.winners.find(
          (w) => w.winnerIndex === winnerIndex
        );
        const alreadyProcessed = targetWinner?.processed ?? false;

        const estimatedBonds =
          bondsBought ??
          (targetWinner && targetWinner.amountOwed > 0
            ? Math.floor(targetWinner.amountOwed / (bondPrice || 5_000_000))
            : 0);

        optimisticProcessedWinnersRef.current.set(key, {
          bondsBought: estimatedBonds,
          timestamp: Date.now(),
        });

        const updatedWinners = prev.winners.map((w) => {
          if (w.winnerIndex === winnerIndex) {
            return {
              ...w,
              processed: true,
              bondsBought: estimatedBonds,
            };
          }
          return w;
        });

        return {
          ...prev,
          winners: updatedWinners,
          payoutsCompleted: alreadyProcessed
            ? prev.payoutsCompleted
            : prev.payoutsCompleted + 1,
        };
      });
    },
    [cycleId]
  );

  const fetchDetails = useCallback(async () => {
    if (cycleId === null || cycleId === undefined || cycleId < 0) {
      setDetails(null);
      setIsLoading(false);
      setIsRefetching(false);
      setError(null);
      return;
    }

    const fetchId = ++fetchIdRef.current;
    if (!detailsRef.current) {
      setIsLoading(true);
    } else {
      setIsRefetching(true);
    }
    setError(null);

    try {
      // 1. Primary path: Query Indexer REST API
      try {
        const apiRes = await fetch(
          `/api/indexer/draws/${cycleId}?poolId=${poolId}`
        );
        const apiJson = await apiRes.json();
        if (
          apiJson.success &&
          apiJson.fallbackRequired === false &&
          apiJson.data
        ) {
          if (fetchId !== fetchIdRef.current) return;
          const d = apiJson.data;
          interface ApiWinnerRecord {
            winnerIndex: number;
            winnerAddress: string;
            amountOwed: number | string;
            bondsBought?: number | string | null;
            processed?: boolean | null;
            tierIndex: number;
            winningTicketIdx?: number | string | null;
          }
          const rawWinners = (d.winners || []) as ApiWinnerRecord[];
          const reconciledWinners: DrawWinnerRecord[] = rawWinners.map((w) => {
            const key = getWinnerKey(cycleId, w.winnerIndex);
            const opt = optimisticProcessedWinnersRef.current.get(key);
            let isProcessed = Boolean(w.processed);
            let effectiveBondsBought = Number(w.bondsBought || 0);

            if (opt) {
              if (w.processed || now - opt.timestamp > OPTIMISTIC_TTL_MS) {
                optimisticProcessedWinnersRef.current.delete(key);
              } else {
                isProcessed = true;
                effectiveBondsBought =
                  effectiveBondsBought > 0
                    ? effectiveBondsBought
                    : opt.bondsBought;
              }
            }

            return {
              winnerIndex: w.winnerIndex,
              slotInTier: w.winnerIndex,
              winnerAddress: w.winnerAddress,
              amountOwed: Number(w.amountOwed),
              bondsBought: effectiveBondsBought,
              processed: isProcessed,
              tierIndex: w.tierIndex,
              winningTicketIndex:
                w.winningTicketIdx != null
                  ? Number(w.winningTicketIdx)
                  : undefined,
            };
          });

          let isUserWinner = false;
          let userWinningsTotal = 0;
          if (userAddress) {
            const userMatches = reconciledWinners.filter(
              (w) => w.winnerAddress.toLowerCase() === userAddress.toLowerCase()
            );
            if (userMatches.length > 0) {
              isUserWinner = true;
              userWinningsTotal = userMatches.reduce(
                (sum, w) => sum + w.amountOwed,
                0
              );
            }
          }

          const detailed: DetailedDrawCycle = {
            poolId: d.poolId,
            cycleId: d.cycleId,
            status: d.status as DetailedDrawCycle["status"],
            prizePot: Number(d.prizePot),
            cycleFeeCollected: Number(d.cycleFeeCollected),
            lockedTicketCount: Number(d.lockedTicketCount),
            harvestSlot: d.harvestSlot,
            randomnessAccount: d.randomnessAccount,
            randomnessSeed: new Uint8Array(32),
            vrfSeedHex: d.vrfSeedHex,
            revealedAt: d.revealedAt ?? undefined,
            initiatedAt: d.initiatedAt ?? undefined,
            completedAt: d.completedAt ?? undefined,
            winnersCount: d.winnersCount,
            payoutsCompleted: reconciledWinners.filter((w) => w.processed)
              .length,
            hasPayoutRegistry: Boolean(d.winnersSynced || d.winnersCount > 0),
            payoutRegistryStatus: "Active",
            winners: reconciledWinners,
            isUserWinner,
            userWinningsTotal,
          };

          setDetails(detailed);
          return;
        }
      } catch {
        // Fall back to RPC getMultipleAccounts
      }

      // 2. Secondary fallback path: Direct Solana RPC batch queries
      const rpc = client.runtime.rpc;
      const drawPda = await findDrawCyclePda(poolId, cycleId);
      const payoutPda = await findPayoutRegistryPda(poolId, cycleId);

      const accountsRes = await rpc
        .getMultipleAccounts([drawPda, payoutPda], {
          encoding: "base64",
          commitment: "confirmed",
        })
        .send();

      if (fetchId !== fetchIdRef.current) return;

      const drawAcc = accountsRes?.value?.[0];
      const payoutAcc = accountsRes?.value?.[1];

      if (!drawAcc?.data) {
        setDetails(null);
        setError(`Draw cycle #${cycleId} account not found on-chain.`);
        return;
      }

      const drawBytes = new Uint8Array(base64Encoder.encode(drawAcc.data[0]));
      const drawCycle: DrawCycleInfo = parseDrawCycle(drawBytes);

      let payout: PayoutRegistryInfo | undefined;
      if (payoutAcc?.data) {
        const payoutBytes = new Uint8Array(
          base64Encoder.encode(payoutAcc.data[0])
        );
        payout = parsePayoutRegistry(payoutBytes);
      }

      const summary = formatDrawCycleSummary(drawCycle, payout);
      const parsedWinners = payout
        ? await parseWinnersWithVrf(payout, drawCycle)
        : [];

      // Reconcile on-chain winners with optimistic tracker ref
      const now = Date.now();
      let optimisticOverridesCount = 0;

      const reconciledWinners = parsedWinners.map((w) => {
        const key = getWinnerKey(cycleId, w.winnerIndex);
        const opt = optimisticProcessedWinnersRef.current.get(key);

        if (opt) {
          if (w.processed || now - opt.timestamp > OPTIMISTIC_TTL_MS) {
            // Reconciled with on-chain truth or expired TTL
            optimisticProcessedWinnersRef.current.delete(key);
          } else {
            // Keep optimistic override active
            optimisticOverridesCount++;
            return {
              ...w,
              processed: true,
              bondsBought: w.bondsBought > 0 ? w.bondsBought : opt.bondsBought,
            };
          }
        }
        return w;
      });

      let isUserWinner = false;
      let userWinningsTotal = 0;

      if (userAddress) {
        const userMatches = reconciledWinners.filter(
          (w) => w.winnerAddress.toLowerCase() === userAddress.toLowerCase()
        );
        if (userMatches.length > 0) {
          isUserWinner = true;
          userWinningsTotal = userMatches.reduce(
            (sum, w) => sum + w.amountOwed,
            0
          );
        }
      }

      if (fetchId !== fetchIdRef.current) return;

      setDetails({
        ...summary,
        payoutRegistryStatus:
          payout && payout.status === 1 ? "Voided" : "Active",
        payoutsCompleted: summary.payoutsCompleted + optimisticOverridesCount,
        winners: reconciledWinners,
        isUserWinner,
        userWinningsTotal,
      });
    } catch (err) {
      console.error(
        `useDrawCycleDetails fetch error for cycle #${cycleId}:`,
        err
      );
      if (fetchId === fetchIdRef.current) {
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load draw cycle details."
        );
        setDetails(null);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
        setIsRefetching(false);
      }
    }
  }, [client, poolId, cycleId, userAddress]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  // Listen for custom protocol draw/settlement events with scoped filtering
  useProtocolSyncSubscription(fetchDetails, {
    scopes: ["draws"],
    poolId,
    debounceMs: 150,
  });

  return {
    details,
    isLoading,
    isRefetching,
    error,
    refetch: fetchDetails,
    markWinnerOptimisticallyProcessed,
  };
}
