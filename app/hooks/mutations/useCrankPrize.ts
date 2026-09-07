"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { useBondsContext } from "@/app/components/providers/BondsProvider";
import { useWalletConnection } from "@solana/react-hooks";
import {
  calculateReinvestmentBreakdown,
  patchOptimisticPrizeInCache,
  INDEXER_PROPAGATION_GRACE_PERIOD_MS,
  type UserPrizeLedgerCacheData,
} from "@/app/lib/draw-helpers";
import { addOptimisticActivity } from "@/app/lib/optimistic-activity-store";
import { createOptimisticActivity } from "@/app/lib/activity-helpers";
import type { PrizeHistoryEntry } from "@/app/types";
import type { UserBondPosition } from "@/app/hooks/queries/useUserBondPosition";

export interface CrankPrizeVariables {
  entry: PrizeHistoryEntry;
  bondPrice: number;
}

export interface CrankPrizeContext {
  previousLedgerSnapshots: Array<
    [QueryKey, UserPrizeLedgerCacheData | undefined]
  >;
  previousHistorySnapshot: PrizeHistoryEntry[] | undefined;
  previousPosition: UserBondPosition | undefined;
  breakdown: ReturnType<typeof calculateReinvestmentBreakdown>;
  bondPrice: number;
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
      const prizeHistoryKey = bondsKeys.userPrizeHistory(poolId, userAddress);
      const positionKey = bondsKeys.userPosition(poolId, userAddress);

      // 1. Cancel in-flight queries to prevent overwriting optimistic updates
      await queryClient.cancelQueries({ queryKey: prizeFilterRoot });
      await queryClient.cancelQueries({ queryKey: prizeHistoryKey });
      await queryClient.cancelQueries({ queryKey: positionKey });

      // 2. Snapshot all matching paginated and unpaginated prize queries
      const previousLedgerSnapshots =
        queryClient.getQueriesData<UserPrizeLedgerCacheData>({
          queryKey: prizeFilterRoot,
        });
      const previousHistorySnapshot =
        queryClient.getQueryData<PrizeHistoryEntry[]>(prizeHistoryKey);
      const previousPosition =
        queryClient.getQueryData<UserBondPosition>(positionKey);

      // 3. Domain calculations
      const breakdown = calculateReinvestmentBreakdown(
        entry.amount,
        Number(previousPosition?.unclaimedWinnings ?? 0n),
        bondPrice
      );

      // 4. Optimistically patch all active prize views (both paginated & unpaginated)
      patchOptimisticPrizeInCache({
        queryClient,
        poolId,
        userAddress,
        drawCycleId: entry.drawCycleId,
        winnerIndex: entry.winnerIndex,
        breakdown,
      });

      // 5. Optimistically patch UserBondPosition
      queryClient.setQueryData<UserBondPosition>(positionKey, (old) => {
        if (!old) return old;
        const currentUnclaimed = Number(old.unclaimedWinnings);
        const newUnclaimed = Math.max(
          0,
          currentUnclaimed - breakdown.usedPriorDust + breakdown.dustAccumulated
        );
        return {
          ...old,
          unclaimedWinnings: BigInt(newUnclaimed),
          totalReinvested: old.totalReinvested + BigInt(entry.amount),
          activeTicketsCount: old.activeTicketsCount + breakdown.bondsBought,
        };
      });

      return {
        previousLedgerSnapshots,
        previousHistorySnapshot,
        previousPosition,
        breakdown,
        bondPrice,
      };
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
      if (context?.previousHistorySnapshot && userAddress) {
        queryClient.setQueryData(
          bondsKeys.userPrizeHistory(poolId, userAddress),
          context.previousHistorySnapshot
        );
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

      const effectiveBondPrice = context?.bondPrice ?? 5_000_000;

      // Append to shared optimistic activity store
      if (context?.breakdown.bondsBought && context.breakdown.bondsBought > 0) {
        addOptimisticActivity(
          userAddress,
          createOptimisticActivity({
            activityType: "auto-reinvest",
            bonds: context.breakdown.bondsBought,
            amountUsdc: context.breakdown.bondsBought * effectiveBondPrice,
            cycleId: entry.drawCycleId,
            txSignature,
          })
        );
      }

      refetch();
      queryClient.invalidateQueries({
        queryKey: bondsKeys.userPosition(poolId, userAddress),
      });

      // Trailing invalidation for off-chain indexer queries to avoid clobbering optimistic state
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPrizeLedgerRoot(poolId, userAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPrizeHistory(poolId, userAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.activityFeed(poolId, userAddress),
        });
      }, INDEXER_PROPAGATION_GRACE_PERIOD_MS);
    },
  });
}
