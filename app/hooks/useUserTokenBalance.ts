"use client";

import { useQuery } from "@tanstack/react-query";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import { USDC_MINT, fetchUserAtaBalance } from "../lib/bonds-sdk";
import {
  formatBalanceAmount,
  USDC_DECIMALS,
  type FormattedBalanceResult,
} from "../lib/formatters";
import { bondsKeys } from "../lib/query-keys";

export interface UseUserTokenBalanceResult {
  /** Raw base units balance (e.g. lamports/micro-USDC) */
  balance: number;
  /** Formatted human-readable string formatted with explicit en-US decimals (floored display) */
  formattedBalance: string;
  /** Structured formatted balance object */
  formatted: FormattedBalanceResult;
  /** Full precision string without truncation (e.g. "9.996000") */
  fullBalance: string;
  /** Display string with currency (e.g. "$9.99 USDC" or "< $0.01 USDC") */
  displayWithCurrency: string;
  /** Whether the initial token balance query is resolving */
  isLoading: boolean;
  /** Trigger a fresh RPC query for token balance */
  refetch: () => Promise<unknown>;
}

/**
 * Custom React hook that retrieves and tracks a user's token balance (ATA) on Solana via TanStack Query.
 * Automatically invalidates on wallet account changes and query cache invalidations.
 *
 * @param mintAddress - Token mint address (defaults to USDC).
 * @param decimals - Token decimals (defaults to 6).
 * @param tokenSymbol - Token symbol (defaults to USDC).
 */
export function useUserTokenBalance(
  mintAddress: string = USDC_MINT,
  decimals: number = USDC_DECIMALS,
  tokenSymbol: string = "USDC"
): UseUserTokenBalanceResult {
  const client = useSolanaClient();
  const { wallet, status } = useWalletConnection();

  const userAddress = wallet?.account.address.toString();
  const isConnected = status === "connected" && !!userAddress;

  const { data, isLoading, refetch } = useQuery({
    queryKey: bondsKeys.userTokenBalance(userAddress, mintAddress),
    enabled: isConnected,
    queryFn: async () => {
      if (!userAddress) return 0;
      const rpc = client.runtime.rpc;
      return await fetchUserAtaBalance(rpc, userAddress, mintAddress);
    },
    staleTime: 10_000,
  });

  const balance = data ?? 0;
  const formatted = formatBalanceAmount(balance, {
    decimals,
    tokenSymbol,
  });

  return {
    balance,
    formattedBalance: formatted.display,
    formatted,
    fullBalance: formatted.full,
    displayWithCurrency: formatted.displayWithCurrency,
    isLoading: isConnected ? isLoading : false,
    refetch,
  };
}
