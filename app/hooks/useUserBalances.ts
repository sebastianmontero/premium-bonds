"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import {
  USDC_MINT,
  fetchUserBalances,
  type UserRawBalances,
} from "../lib/bonds-sdk";
import {
  formatBalanceAmount,
  USDC_DECIMALS,
  type FormattedBalanceResult,
} from "../lib/formatters";
import { bondsKeys } from "../lib/query-keys";

export interface UserBalanceItem {
  raw: bigint;
  formatted: FormattedBalanceResult;
}

export interface UseUserBalancesOptions {
  mintAddress?: string;
  decimals?: number;
  tokenSymbol?: string;
}

export interface UseUserBalancesResult {
  usdc: UserBalanceItem;
  sol: UserBalanceItem;
  isLowSol: boolean;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: () => Promise<unknown>;
}

export const MINIMUM_RECOMMENDED_SOL_LAMPORTS = 5_000_000n; // 0.005 SOL

export function useUserBalances(
  options: UseUserBalancesOptions = {}
): UseUserBalancesResult {
  const {
    mintAddress = USDC_MINT,
    decimals = USDC_DECIMALS,
    tokenSymbol = "USDC",
  } = options;

  const client = useSolanaClient();
  const queryClient = useQueryClient();
  const { wallet, status } = useWalletConnection();

  const userAddress = wallet?.account.address.toString();
  const isConnected = status === "connected" && !!userAddress;
  const balanceQueryKey = bondsKeys.userAssetBalances(userAddress, mintAddress);

  // 1. Snapshot Query with Slot-Monotonic Guard
  const { data, isLoading, isFetching, isError, refetch } = useQuery({
    queryKey: balanceQueryKey,
    enabled: isConnected,
    queryFn: async ({ signal }) => {
      if (!userAddress) {
        return { solLamports: 0n, tokenBaseUnits: 0n, slot: 0n };
      }
      const rpc = client.runtime.rpc;
      const fresh = await fetchUserBalances(
        rpc,
        userAddress,
        mintAddress,
        signal
      );

      // Slot-Monotonic Guard: Discard stale HTTP response if a newer WebSocket push was already ingested
      const cached = queryClient.getQueryData<UserRawBalances>(balanceQueryKey);
      if (cached && cached.slot > fresh.slot) {
        return cached;
      }
      return fresh;
    },
    staleTime: Infinity, // WebSocket pushes live updates into cache
    refetchOnWindowFocus: "always", // Instant sync on tab focus or sleep wake
    refetchOnReconnect: "always", // Instant sync on network reconnect
  });

  const tokenBaseUnits = data?.tokenBaseUnits ?? 0n;
  const solLamports = data?.solLamports ?? 0n;

  return useMemo(() => {
    const formattedUsdc = formatBalanceAmount(tokenBaseUnits, {
      decimals,
      tokenSymbol,
    });

    const formattedSol = formatBalanceAmount(solLamports, {
      tokenSymbol: "SOL",
    });

    const usdcItem: UserBalanceItem = {
      raw: tokenBaseUnits,
      formatted: formattedUsdc,
    };

    const solItem: UserBalanceItem = {
      raw: solLamports,
      formatted: formattedSol,
    };

    // Guard with !isError so RPC failures do not show a false "Low SOL" warning
    const isLowSol =
      isConnected &&
      !isLoading &&
      !isError &&
      solLamports < MINIMUM_RECOMMENDED_SOL_LAMPORTS;

    return {
      usdc: usdcItem,
      sol: solItem,
      isLowSol,
      isLoading: isConnected ? isLoading : false,
      isFetching: isConnected ? isFetching : false,
      isError: isConnected ? isError : false,
      refetch,
    };
  }, [
    tokenBaseUnits,
    solLamports,
    decimals,
    tokenSymbol,
    isConnected,
    isLoading,
    isFetching,
    isError,
    refetch,
  ]);
}
