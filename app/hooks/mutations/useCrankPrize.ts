"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { useBondsContext } from "@/app/components/providers/BondsProvider";
import { useWalletConnection } from "@solana/react-hooks";
import type { Address } from "@solana/kit";
import {
  calculateReinvestmentBreakdown,
  patchOptimisticPrizeInCache,
  isPoolClosed,
  INDEXER_PROPAGATION_GRACE_PERIOD_MS,
  type UserPrizeLedgerCacheData,
  type ReinvestmentBreakdown,
} from "@/app/lib/draw-helpers";
import { addOptimisticActivity } from "@/app/lib/optimistic-activity-store";
import { createOptimisticReinvestActivity } from "@/app/lib/activity-helpers";
import type { PrizeHistoryEntry } from "@/app/types";
import type { UserBondPosition } from "@/app/hooks/queries/useUserBondPosition";

export interface CrankPrizeVariables {
  entry: PrizeHistoryEntry;
  bondPrice?: number;
  decimals?: number;
  onSigning?: () => void;
}

export type LedgerQuerySnapshot = [
  QueryKey,
  UserPrizeLedgerCacheData | undefined,
];

export interface CrankPrizeContext {
  userAddress: Address | string;
  previousLedgerSnapshots: LedgerQuerySnapshot[];
  previousHistorySnapshot: PrizeHistoryEntry[] | undefined;
  previousPosition: UserBondPosition | undefined;
  breakdown: ReinvestmentBreakdown;
  bondPrice: number;
}

export function useCrankPrize(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const { pool, actions, refetch } = useBondsContext();
  const { wallet } = useWalletConnection();
  const userAddress = wallet?.account.address.toString();

  return useMutation<string, Error, CrankPrizeVariables, CrankPrizeContext>({
    onMutate: async ({ entry, bondPrice: overrideBondPrice }) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (pool?.status === "Paused") throw new Error("Pool is paused");
      if (pool?.isFrozenForDraw)
        throw new Error("Pool is frozen for draw preparation");

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
      const isClosed = isPoolClosed(pool);
      const effectiveBondPrice =
        overrideBondPrice ?? pool?.bondPrice ?? 5_000_000;
      const breakdown = calculateReinvestmentBreakdown(
        entry.amount,
        Number(previousPosition?.unclaimedWinnings ?? 0n),
        effectiveBondPrice,
        isClosed ? 0 : undefined
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
        const reinvestedCost =
          BigInt(Math.trunc(breakdown.bondsBought)) *
          BigInt(Math.trunc(effectiveBondPrice));
        return {
          ...old,
          unclaimedWinnings: BigInt(Math.trunc(breakdown.remainingDust)),
          totalReinvested: old.totalReinvested + reinvestedCost,
          activeTicketsCount: old.activeTicketsCount + breakdown.bondsBought,
        };
      });

      return {
        userAddress,
        previousLedgerSnapshots,
        previousHistorySnapshot,
        previousPosition,
        breakdown,
        bondPrice: effectiveBondPrice,
      };
    },
    mutationFn: async ({ entry, onSigning }) => {
      if (!userAddress) throw new Error("Wallet not connected");
      return await actions.reinvestWinnings(
        entry.drawCycleId,
        entry.winnerIndex,
        {
          winnerAddress: userAddress,
          onSigning,
        }
      );
    },
    onError: (_err, _vars, context) => {
      const targetUserAddress = context?.userAddress;
      if (!targetUserAddress) return;

      // Deterministic rollback across all snapshotted exact query keys
      if (context?.previousLedgerSnapshots) {
        for (const [key, data] of context.previousLedgerSnapshots) {
          queryClient.setQueryData(key, data);
        }
      }
      if (context?.previousHistorySnapshot) {
        queryClient.setQueryData(
          bondsKeys.userPrizeHistory(poolId, targetUserAddress),
          context.previousHistorySnapshot
        );
      }
      if (context?.previousPosition) {
        queryClient.setQueryData(
          bondsKeys.userPosition(poolId, targetUserAddress),
          context.previousPosition
        );
      }
    },
    onSuccess: (txSignature, { entry, decimals }, context) => {
      const targetUserAddress = context?.userAddress;
      if (!targetUserAddress) return;

      // Update query cache with confirmed txSignature and reinvested state
      if (context?.breakdown) {
        patchOptimisticPrizeInCache({
          queryClient,
          poolId,
          userAddress: targetUserAddress,
          drawCycleId: entry.drawCycleId,
          winnerIndex: entry.winnerIndex,
          breakdown: context.breakdown,
          txSignature,
        });

        // Append to shared optimistic activity store
        addOptimisticActivity(
          targetUserAddress,
          createOptimisticReinvestActivity({
            entry,
            breakdown: context.breakdown,
            txSignature,
            decimals: decimals ?? pool?.tokenDecimals ?? 6,
          })
        );
      }

      refetch();
      queryClient.invalidateQueries({
        queryKey: bondsKeys.userPosition(poolId, targetUserAddress),
      });

      // Trailing invalidation for off-chain indexer queries to avoid clobbering optimistic state
      setTimeout(() => {
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPrizeLedgerRoot(poolId, targetUserAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.userPrizeHistory(poolId, targetUserAddress),
        });
        queryClient.invalidateQueries({
          queryKey: bondsKeys.activityFeed(poolId, targetUserAddress),
        });
      }, INDEXER_PROPAGATION_GRACE_PERIOD_MS);
    },
  });
}
