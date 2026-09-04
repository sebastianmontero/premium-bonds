"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "../lib/query-keys";
import type { DetailedDrawCycle, DrawWinnerRecord } from "../types";
import { useCallback, useMemo } from "react";

interface DrawCycleDetailsResult {
  details: DetailedDrawCycle | null;
  isLoading: boolean;
  isRefetching: boolean;
  error: string | null;
  refetch: () => Promise<unknown>;
  markWinnerOptimisticallyProcessed: (
    winnerIndex: number,
    bondsBought?: number,
    bondPrice?: number
  ) => void;
}

export function useDrawCycleDetails(
  poolId: PoolId = 1,
  cycleId: number | null | undefined,
  userAddress?: string
): DrawCycleDetailsResult {
  const queryClient = useQueryClient();

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: bondsKeys.drawDetails(poolId, cycleId),
    enabled: cycleId !== null && cycleId !== undefined && cycleId >= 0,
    queryFn: async (): Promise<DetailedDrawCycle | null> => {
      if (cycleId === null || cycleId === undefined || cycleId < 0) return null;
      const res = await fetch(
        `/api/indexer/draws/${cycleId}?poolId=${poolId}`,
        { cache: "no-store" }
      );
      if (!res.ok) throw new Error("Failed to fetch draw cycle details");
      const json = await res.json();
      if (!json.success || !json.data) {
        throw new Error(json.error || "Draw cycle details not found");
      }

      const d = json.data;
      const winners: DrawWinnerRecord[] = (d.winners || []).map(
        (w: Record<string, unknown>) => ({
          winnerIndex: Number(w.winnerIndex),
          slotInTier: Number(w.winnerIndex),
          winnerAddress: String(w.winnerAddress || ""),
          amountOwed: Number(w.amountOwed),
          bondsBought: Number(w.bondsBought || 0),
          processed: Boolean(w.processed),
          tierIndex: Number(w.tierIndex ?? 0),
          winningTicketIndex:
            w.winningTicketIdx != null ? Number(w.winningTicketIdx) : undefined,
        })
      );

      return {
        poolId: d.poolId,
        cycleId: d.cycleId,
        status: d.status,
        prizePot: Number(d.prizePot),
        cycleFeeCollected: Number(d.cycleFeeCollected),
        lockedTicketCount: Number(d.lockedTicketCount),
        harvestSlot: d.harvestSlot,
        randomnessAccount: d.randomnessAccount,
        randomnessSeed: new Uint8Array(32),
        vrfSeedHex: d.vrfSeedHex,
        winnersCount: d.winnersCount,
        payoutsCompleted: winners.filter((w) => w.processed).length,
        hasPayoutRegistry: winners.length > 0,
        winners,
        initiatedAt: d.initiatedAt,
        revealedAt: d.revealedAt ?? undefined,
        completedAt: d.completedAt ?? undefined,
      };
    },
    staleTime: 0,
  });

  const markWinnerOptimisticallyProcessed = useCallback(
    (
      winnerIndex: number,
      bondsBought?: number,
      bondPrice: number = 5_000_000
    ) => {
      if (cycleId === null || cycleId === undefined) return;
      queryClient.setQueryData<DetailedDrawCycle | null>(
        bondsKeys.drawDetails(poolId, cycleId),
        (old) => {
          if (!old) return old;
          const updatedWinners = old.winners.map((w) => {
            if (w.winnerIndex !== winnerIndex) return w;
            const estimatedBonds =
              bondsBought ??
              (w.amountOwed > 0
                ? Math.floor(w.amountOwed / bondPrice)
                : w.bondsBought);
            return {
              ...w,
              processed: true,
              bondsBought: estimatedBonds,
            };
          });
          return {
            ...old,
            winners: updatedWinners,
            payoutsCompleted: updatedWinners.filter((w) => w.processed).length,
          };
        }
      );
    },
    [poolId, cycleId, queryClient]
  );

  const details = useMemo((): DetailedDrawCycle | null => {
    if (!data) return null;

    let isUserWinner = false;
    let userWinningsTotal = 0;
    if (userAddress) {
      const lower = userAddress.toLowerCase();
      for (const w of data.winners) {
        if (w.winnerAddress.toLowerCase() === lower) {
          isUserWinner = true;
          userWinningsTotal += w.amountOwed;
        }
      }
    }

    return {
      ...data,
      isUserWinner,
      userWinningsTotal,
    };
  }, [data, userAddress]);

  return {
    details,
    isLoading,
    isRefetching: isFetching,
    error: error ? error.message : null,
    refetch,
    markWinnerOptimisticallyProcessed,
  };
}
