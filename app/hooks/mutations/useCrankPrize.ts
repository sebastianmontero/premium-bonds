"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { useBondsContext } from "@/app/components/providers/BondsProvider";
import { useWalletConnection } from "@solana/react-hooks";
import { calculateReinvestmentBreakdown } from "@/app/lib/draw-helpers";
import { addOptimisticActivity } from "@/app/lib/optimistic-activity-store";
import { createOptimisticActivity } from "@/app/lib/activity-helpers";
import type { PrizeHistoryEntry } from "@/app/types";
import type { UserBondPosition } from "@/app/hooks/queries/useUserBondPosition";
import type { PaginatedWinnersResponse } from "@/app/types/indexer-contracts";

export interface CrankPrizeVariables {
  entry: PrizeHistoryEntry;
  bondPrice: number;
}

export interface CrankPrizeContext {
  previousLedgerSnapshots: Array<
    [QueryKey, PaginatedWinnersResponse | undefined]
  >;
  previousPosition: UserBondPosition | undefined;
  breakdown: ReturnType<typeof calculateReinvestmentBreakdown>;
}

export function useCrankPrize(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const { actions, refetch } = useBondsContext();
  const { wallet } = useWalletConnection();
  const userAddress = wallet?.account.address.toString();

  return useMutation<string, Error, CrankPrizeVariables, CrankPrizeContext>({
    onMutate: async ({ entry, bondPrice }) => {
      if (!userAddress) throw new Error("Wallet not connected");

      const prizeFilterRoot = bondsKeys.userPrizeLedgerRoot(
        poolId,
        userAddress
      );
      const positionKey = bondsKeys.userPosition(poolId, userAddress);

      // 1. Cancel in-flight queries to prevent overwriting optimistic updates
      await queryClient.cancelQueries({ queryKey: prizeFilterRoot });
      await queryClient.cancelQueries({ queryKey: positionKey });

      // 2. Snapshot all matching paginated prize queries across any filter combination
      const previousLedgerSnapshots =
        queryClient.getQueriesData<PaginatedWinnersResponse>({
          queryKey: prizeFilterRoot,
        });
      const previousPosition =
        queryClient.getQueryData<UserBondPosition>(positionKey);

      // 3. Domain calculations
      const breakdown = calculateReinvestmentBreakdown(
        entry.amount,
        Number(previousPosition?.unclaimedWinnings ?? 0n),
        bondPrice
      );

      // 4. Optimistically patch all active prize ledger views
      queryClient.setQueriesData<PaginatedWinnersResponse>(
        { queryKey: prizeFilterRoot },
        (old) => {
          if (!old || !old.data) return old;
          return {
            ...old,
            data: old.data.map((p) =>
              p.cycleId === entry.drawCycleId &&
              p.winnerIndex === entry.winnerIndex
                ? {
                    ...p,
                    processed: true,
                    bondsBought: String(breakdown.bondsBought),
                    dustAccumulated: String(breakdown.dustAccumulated),
                  }
                : p
            ),
          };
        }
      );

      // 5. Optimistically patch UserBondPosition
      queryClient.setQueryData<UserBondPosition>(positionKey, (old) => {
        if (!old) return old;
        const currentUnclaimed = Number(old.unclaimedWinnings);
        const newUnclaimed = Math.max(
          0,
          currentUnclaimed - breakdown.usedPriorDust
        );
        return {
          ...old,
          unclaimedWinnings: BigInt(newUnclaimed),
          totalReinvested: old.totalReinvested + BigInt(entry.amount),
          activeTicketsCount: old.activeTicketsCount + breakdown.bondsBought,
        };
      });

      return { previousLedgerSnapshots, previousPosition, breakdown };
    },
    mutationFn: async ({ entry }) => {
      if (!userAddress) throw new Error("Wallet not connected");
      return await actions.reinvestWinnings(
        entry.drawCycleId,
        entry.winnerIndex,
        userAddress
      );
    },
    onError: (_err, _vars, context) => {
      // Deterministic rollback across all snapshotted exact query keys
      if (context?.previousLedgerSnapshots) {
        for (const [key, data] of context.previousLedgerSnapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousPosition && userAddress) {
        queryClient.setQueryData(
          bondsKeys.userPosition(poolId, userAddress),
          context.previousPosition
        );
      }
    },
    onSuccess: (txSignature, { entry }, context) => {
      if (!userAddress) return;

      // Append to shared optimistic activity store
      if (context?.breakdown.bondsBought && context.breakdown.bondsBought > 0) {
        addOptimisticActivity(
          userAddress,
          createOptimisticActivity({
            activityType: "auto-reinvest",
            bonds: context.breakdown.bondsBought,
            amountUsdc: context.breakdown.bondsBought * 5_000_000,
            cycleId: entry.drawCycleId,
            txSignature,
          })
        );
      }

      refetch();

      // Re-fetch active ledger queries for authoritative server state
      queryClient.invalidateQueries({
        queryKey: bondsKeys.userPrizeLedgerRoot(poolId, userAddress),
        refetchType: "active",
      });
      queryClient.invalidateQueries({
        queryKey: bondsKeys.activityFeed(poolId, userAddress),
      });
    },
  });
}
