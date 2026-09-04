"use client";

import { useMemo, useCallback } from "react";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import { address } from "@solana/kit";
import { usePrizePool } from "./queries/usePrizePool";
import { useUserBondPosition } from "./queries/useUserBondPosition";
import { useUserTokenBalance } from "./useUserTokenBalance";
import { useQuery } from "@tanstack/react-query";
import { bondsKeys } from "../lib/query-keys";
import {
  buildBuyBondsInstruction,
  buildSellBondsInstruction,
  buildClaimRedemptionInstruction,
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
        `/api/indexer/redemptions?user=${encodeURIComponent(userAddress)}&poolId=${poolId}`
      );
      if (!res.ok) return [];
      const json = await res.json();
      return (json.data || []).map((dto: PendingRedemptionDto) =>
        mapDtoToPendingRedemption(dto)
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

  const refetch = useCallback(async () => {
    await Promise.all([
      poolQuery.refetch(),
      positionQuery.refetch(),
      tokenBalanceQuery.refetch(),
      redemptionsQuery.refetch(),
    ]);
  }, [poolQuery, positionQuery, tokenBalanceQuery, redemptionsQuery]);

  // Mutations
  const buyBonds = useCallback(
    async (ticketsToBuy: number) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool || !pool.ticketRegistry)
        throw new Error("Pool state not loaded");

      const userAta = await import("../lib/bonds-sdk").then((m) =>
        m.findAtaAddress(userAddress, m.USDC_MINT)
      );

      const ix = await buildBuyBondsInstruction({
        poolId,
        userAddress: address(userAddress),
        ticketsToBuy,
        ticketRegistry: address(pool.ticketRegistry),
        userTokenAccount: userAta,
      });

      const sig = await send({ instructions: [ix] });
      await positionQuery.refetch();
      await tokenBalanceQuery.refetch();
      return sig.toString();
    },
    [userAddress, pool, poolId, send, positionQuery, tokenBalanceQuery]
  );

  const sellBonds = useCallback(
    async (amount: number) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool || !pool.ticketRegistry)
        throw new Error("Pool state not loaded");
      if (!userTickets) throw new Error("User position not loaded");

      const bondsToSell = Math.floor(amount / (pool.bondPrice || 5_000_000));
      const pendingToSell = Math.min(
        userTickets.pendingTicketsCount,
        bondsToSell
      );
      const activeToSell = bondsToSell - pendingToSell;

      const ix = await buildSellBondsInstruction({
        rpc,
        poolId,
        userAddress: address(userAddress),
        activeToSell,
        pendingToSell,
        userRegistryIndex: userTickets.entryIndex,
        currentUserTotalTickets: userTickets.totalTickets,
      });

      const sig = await send({ instructions: [ix] });
      await positionQuery.refetch();
      await redemptionsQuery.refetch();
      await tokenBalanceQuery.refetch();
      return sig.toString();
    },
    [
      userAddress,
      pool,
      poolId,
      userTickets,
      rpc,
      send,
      positionQuery,
      redemptionsQuery,
      tokenBalanceQuery,
    ]
  );

  const claimRedemption = useCallback(
    async (redemptionId: number) => {
      if (!userAddress) throw new Error("Wallet not connected");

      const userAta = await import("../lib/bonds-sdk").then((m) =>
        m.findAtaAddress(userAddress, m.USDC_MINT)
      );

      const ix = await buildClaimRedemptionInstruction({
        poolId,
        userAddress: address(userAddress),
        redemptionId,
        userTokenAccount: userAta,
      });

      const sig = await send({ instructions: [ix] });
      await redemptionsQuery.refetch();
      await tokenBalanceQuery.refetch();
      return sig.toString();
    },
    [userAddress, poolId, send, redemptionsQuery, tokenBalanceQuery]
  );

  const claimNonReinvestedWinnings = useCallback(
    async (amount: number) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool) throw new Error("Pool state not loaded");

      const ix = await buildClaimNonReinvestedWinningsInstruction({
        poolId,
        userAddress: address(userAddress),
        amount,
        nextRedemptionId: pool.nextRedemptionId || 0,
      });

      const sig = await send({ instructions: [ix] });
      await positionQuery.refetch();
      await redemptionsQuery.refetch();
      return sig.toString();
    },
    [userAddress, pool, poolId, send, positionQuery, redemptionsQuery]
  );

  const reinvestWinnings = useCallback(
    async (cycleId: number, winnerIndex: number, winnerAddress?: string) => {
      if (!userAddress) throw new Error("Wallet not connected");
      if (!pool || !pool.ticketRegistry)
        throw new Error("Pool state not loaded");

      const ix = await buildReinvestWinningsInstruction({
        poolId,
        userAddress: address(userAddress),
        cycleId,
        winnerIndex,
        ticketRegistry: address(pool.ticketRegistry),
        winnerAddress: winnerAddress ? address(winnerAddress) : undefined,
      });

      const sig = await send({ instructions: [ix] });
      await positionQuery.refetch();
      return sig.toString();
    },
    [userAddress, pool, poolId, send, positionQuery]
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
      actions,
    ]
  );
}

export type UseBondsContractReturn = ReturnType<typeof useBondsContract>;
