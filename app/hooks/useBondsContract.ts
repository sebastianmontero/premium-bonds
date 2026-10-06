"use client";

import { useMemo, useCallback } from "react";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import { address, type Instruction } from "@solana/kit";
import { usePrizePool } from "./queries/usePrizePool";
import { useUserBondPosition } from "./queries/useUserBondPosition";
import { useUserTokenBalance } from "./useUserTokenBalance";
import { useQuery } from "@tanstack/react-query";
import { bondsKeys } from "../lib/query-keys";
import {
  buildBuyBondsInstruction,
  buildSellBondsInstruction,
  buildClaimRedemptionInstructions,
  buildReinvestWinningsInstruction,
  buildClaimNonReinvestedWinningsInstruction,
} from "../lib/bonds-instruction-factory";
import { useSendTransaction } from "@solana/react-hooks";
import type { PoolInfo, UserTicketInfo, PendingRedemption } from "../types";
import {
  mapDtoToPendingRedemption,
  PendingRedemptionDto,
} from "../lib/indexer-mappers";
import { UNASSIGNED_REGISTRY_INDEX } from "../lib/ticket-registry-helpers";

export interface ActionLifecycleOptions {
  onSigning?: () => void;
}

export interface ReinvestOptions extends ActionLifecycleOptions {
  winnerAddress?: string;
}

export function useBondsContract(poolId: number = 1) {
  const client = useSolanaClient();
  const rpc = client.runtime.rpc;
  const { wallet, status } = useWalletConnection();
  const { send } = useSendTransaction();
  const userAddress = wallet?.account.address.toString();
  const isConnected = status === "connected" && !!userAddress;

  // 1. Focused Queries
  const poolQuery = usePrizePool(poolId);
  const positionQuery = useUserBondPosition(poolId);
  const tokenBalanceQuery = useUserTokenBalance();

  // 2. Pending Redemptions Query
  const redemptionsQuery = useQuery({
    queryKey: bondsKeys.userRedemptions(poolId, userAddress ?? "anonymous"),
    enabled: isConnected,
    queryFn: async (): Promise<PendingRedemption[]> => {
      if (!userAddress) return [];
      const res = await fetch(
        `/api/indexer/redemptions?user=${encodeURIComponent(userAddress)}&poolId=${poolId}&status=pending`
      );
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || [])
        .map((dto: PendingRedemptionDto) => mapDtoToPendingRedemption(dto))
        .filter(
          (r: PendingRedemption | null): r is PendingRedemption => r !== null
        );
    },
    staleTime: 15_000,
  });

  const pool: PoolInfo | null = poolQuery.data ?? null;

  const userTickets:
    | (UserTicketInfo & { entryIndex: number; totalTickets: number })
    | null = useMemo(() => {
    if (!positionQuery.data) return null;
    return {
      poolId,
      activeTicketsCount: positionQuery.data.activeTicketsCount,
      pendingTicketsCount: positionQuery.data.pendingTicketsCount,
      totalTickets:
        positionQuery.data.activeTicketsCount +
        positionQuery.data.pendingTicketsCount,
      entryIndex: positionQuery.data.registryEntryIndex,
    };
  }, [positionQuery.data, poolId]);

  const userWinnings = useMemo(() => {
    if (!positionQuery.data) return null;
    return {
      unclaimedNonReinvestedWinnings: Number(
        positionQuery.data.unclaimedWinnings
      ),
      totalClaimed: Number(positionQuery.data.totalClaimed ?? 0n),
      totalReinvested: Number(positionQuery.data.totalReinvested ?? 0n),
      registryEntryIndex: positionQuery.data.registryEntryIndex,
    };
  }, [positionQuery.data]);

  const refetch = useCallback(
    async (options?: { bypassCache?: boolean }) => {
      await Promise.all([
        poolQuery.refetch(options),
        positionQuery.refetch(),
        tokenBalanceQuery.refetch(),
        redemptionsQuery.refetch(),
      ]);
    },
    [poolQuery, positionQuery, tokenBalanceQuery, redemptionsQuery]
  );

  const refetchOnChain = useCallback(async () => {
    await Promise.all([
      poolQuery.refetch(),
      positionQuery.refetch(),
      tokenBalanceQuery.refetch(),
    ]);
  }, [poolQuery, positionQuery, tokenBalanceQuery]);

  const executeAction = useCallback(
    async (
      buildIx: () => Promise<Instruction | readonly Instruction[]>,
      options?: ActionLifecycleOptions
    ): Promise<string> => {
      const ixOrIxs = await buildIx();
      const instructions = Array.isArray(ixOrIxs) ? [...ixOrIxs] : [ixOrIxs];
      options?.onSigning?.();
      const sig = await send({ instructions });
      return sig.toString();
    },
    [send]
  );

  // Mutations
  const buyBonds = useCallback(
    async (ticketsToBuy: number, options?: ActionLifecycleOptions) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool || !pool.ticketRegistry)
        throw new Error("Pool state not loaded");
      const currentPool = pool;
      const ticketRegistry = pool.ticketRegistry;

      return executeAction(
        () =>
          buildBuyBondsInstruction({
            poolId,
            userAddress: address(userAddress),
            ticketsToBuy,
            ticketRegistry: address(ticketRegistry),
            humaAddresses: currentPool.humaPoolState
              ? { poolState: address(currentPool.humaPoolState) }
              : undefined,
          }),
        options
      );
    },
    [userAddress, pool, poolId, executeAction]
  );

  const sellBonds = useCallback(
    async (amount: number, options?: ActionLifecycleOptions) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool || !pool.ticketRegistry)
        throw new Error("Pool state not loaded");
      if (!userTickets) throw new Error("User position not loaded");
      const currentPool = pool;

      const bondsToSell = Math.floor(
        amount / (currentPool.bondPrice || 5_000_000)
      );
      const pendingToSell = Math.min(
        userTickets.pendingTicketsCount,
        bondsToSell
      );
      const activeToSell = bondsToSell - pendingToSell;

      return executeAction(
        () =>
          buildSellBondsInstruction({
            rpc,
            poolId,
            userAddress: address(userAddress),
            activeToSell,
            pendingToSell,
            userRegistryIndex: userTickets.entryIndex,
            currentUserTotalTickets: userTickets.totalTickets,
            humaAddresses: currentPool.humaPoolState
              ? { poolState: address(currentPool.humaPoolState) }
              : undefined,
          }),
        options
      );
    },
    [userAddress, pool, poolId, userTickets, rpc, executeAction]
  );

  const claimRedemption = useCallback(
    async (redemptionId: number, options?: ActionLifecycleOptions) => {
      if (!userAddress) throw new Error("Wallet not connected");
      const currentPool = pool;

      return executeAction(
        () =>
          buildClaimRedemptionInstructions({
            poolId,
            userAddress: address(userAddress),
            redemptionId,
            humaAddresses: currentPool?.humaPoolState
              ? { poolState: address(currentPool.humaPoolState) }
              : undefined,
          }),
        options
      );
    },
    [userAddress, pool, poolId, executeAction]
  );

  const claimNonReinvestedWinnings = useCallback(
    async (amount: number, options?: ActionLifecycleOptions) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool) throw new Error("Pool state not loaded");
      const currentPool = pool;

      return executeAction(
        () =>
          buildClaimNonReinvestedWinningsInstruction({
            poolId,
            userAddress: address(userAddress),
            amount,
            nextRedemptionId: currentPool.nextRedemptionId || 0,
            humaAddresses: currentPool.humaPoolState
              ? { poolState: address(currentPool.humaPoolState) }
              : undefined,
          }),
        options
      );
    },
    [userAddress, pool, poolId, executeAction]
  );

  const reinvestWinnings = useCallback(
    async (
      cycleId: number,
      winnerIndex: number,
      options?: ReinvestOptions | string
    ) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool || !pool.ticketRegistry)
        throw new Error("Pool state not loaded");
      const ticketRegistry = pool.ticketRegistry;

      const opts: ReinvestOptions =
        typeof options === "string"
          ? { winnerAddress: options }
          : options || {};

      return executeAction(
        () =>
          buildReinvestWinningsInstruction({
            poolId,
            userAddress: address(userAddress),
            cycleId,
            winnerIndex,
            ticketRegistry: address(ticketRegistry),
            winnerAddress: opts.winnerAddress
              ? address(opts.winnerAddress)
              : undefined,
          }),
        opts
      );
    },
    [userAddress, pool, poolId, executeAction]
  );

  const actions = useMemo(
    () => ({
      buyBonds,
      sellBonds,
      claimRedemption,
      claimNonReinvestedWinnings,
      reinvestWinnings,
    }),
    [
      buyBonds,
      sellBonds,
      claimRedemption,
      claimNonReinvestedWinnings,
      reinvestWinnings,
    ]
  );

  const hasUserWinningsAccount = Boolean(
    positionQuery.data?.hasRegisteredEntry ||
    (positionQuery.data?.registryEntryIndex !== undefined &&
      positionQuery.data?.registryEntryIndex !== UNASSIGNED_REGISTRY_INDEX)
  );

  return useMemo(
    () => ({
      pool,
      userTickets,
      userWinnings,
      pendingRedemptions: redemptionsQuery.data || [],
      walletBalance: tokenBalanceQuery.balance,
      hasUserWinningsAccount,
      isFirstDeposit: !hasUserWinningsAccount,
      isLoading: poolQuery.isLoading,
      error: poolQuery.error ? poolQuery.error.message : null,
      isPoolLoading: poolQuery.isLoading,
      isPoolError: poolQuery.isError,
      poolError: poolQuery.error
        ? poolQuery.error instanceof Error
          ? poolQuery.error.message
          : String(poolQuery.error)
        : null,
      isPoolFetching: poolQuery.isFetching,
      refetch,
      refetchOnChain,
      actions,
    }),
    [
      pool,
      userTickets,
      userWinnings,
      redemptionsQuery.data,
      tokenBalanceQuery.balance,
      hasUserWinningsAccount,
      poolQuery.isLoading,
      poolQuery.isError,
      poolQuery.error,
      poolQuery.isFetching,
      refetch,
      refetchOnChain,
      actions,
    ]
  );
}

export type UseBondsContractReturn = ReturnType<typeof useBondsContract>;
