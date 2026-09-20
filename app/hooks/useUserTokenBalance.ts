"use client";

import { USDC_MINT } from "../lib/bonds-sdk";
import { USDC_DECIMALS, type FormattedBalanceResult } from "../lib/formatters";
import { useUserBalances } from "./useUserBalances";

export interface UseUserTokenBalanceResult {
  /** Raw base units balance as bigint */
  raw: bigint;
  /** Raw base units balance (e.g. lamports/micro-USDC) - Deprecated compatibility property */
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
  /** Whether query is actively fetching in background */
  isFetching: boolean;
  /** Whether the query failed with an error */
  isError: boolean;
  /** Trigger a fresh RPC query for token balance */
  refetch: () => Promise<unknown>;
}

/**
 * Backward-compatible adapter hook that retrieves and tracks a user's token balance (ATA) on Solana.
 * Routes through the unified useUserBalances hook with real-time WebSocket sync.
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
  const { usdc, isLoading, isFetching, isError, refetch } = useUserBalances({
    mintAddress,
    decimals,
    tokenSymbol,
  });

  return {
    raw: usdc.raw,
    balance: Number(usdc.raw), // Deprecated compatibility property
    formattedBalance: usdc.formatted.display,
    formatted: usdc.formatted,
    fullBalance: usdc.formatted.full,
    displayWithCurrency: usdc.formatted.displayWithCurrency,
    isLoading,
    isFetching,
    isError,
    refetch,
  };
}
