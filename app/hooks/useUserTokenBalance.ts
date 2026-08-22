"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import { USDC_MINT, fetchUserAtaBalance } from "../lib/bonds-sdk";
import { formatTokenAmount, USDC_DECIMALS } from "../lib/formatters";
import { notifyProtocolUpdate } from "../lib/protocol-sync-bus";
import { useProtocolSyncSubscription } from "./useProtocolSyncSubscription";

export const PB_BALANCE_UPDATE_EVENT = "pb:balance-update";

/**
 * Dispatches a protocol-wide custom event notifying all balance tracking hooks
 * (such as header balance pills and wallet dropdowns) to refresh token balances.
 */
export function notifyBalanceUpdate(): void {
  notifyProtocolUpdate("user", { reason: "balance_update" });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(PB_BALANCE_UPDATE_EVENT));
  }
}

export interface UseUserTokenBalanceResult {
  /** Raw base units balance (e.g. lamports/micro-USDC) */
  balance: number;
  /** Formatted human-readable string formatted with explicit en-US decimals */
  formattedBalance: string;
  /** Whether the initial token balance query is resolving */
  isLoading: boolean;
  /** Trigger a fresh RPC query for token balance */
  refetch: () => Promise<void>;
}

/**
 * Custom React hook that retrieves and tracks a user's token balance (ATA) on Solana.
 * Automatically invalidates on wallet account changes, window focus, and 'pb:balance-update' events.
 *
 * @param mintAddress - Token mint address (defaults to USDC).
 * @param decimals - Token decimals (defaults to 6).
 */
export function useUserTokenBalance(
  mintAddress: string = USDC_MINT,
  decimals: number = USDC_DECIMALS
): UseUserTokenBalanceResult {
  const client = useSolanaClient();
  const { wallet, status } = useWalletConnection();

  const [balance, setBalance] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  const userAddress = wallet?.account.address.toString();
  const isConnected = status === "connected" && !!userAddress;

  const fetchIdRef = useRef<number>(0);
  const lastUserRef = useRef<string | undefined>(userAddress);
  const trailingTimerRef = useRef<NodeJS.Timeout | number | null>(null);

  const refetch = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;

    if (!isConnected || !userAddress) {
      setBalance(0);
      setIsLoading(false);
      return;
    }

    try {
      const rpc = client.runtime.rpc;
      const rawBalance = await fetchUserAtaBalance(
        rpc,
        userAddress,
        mintAddress
      );

      if (fetchId !== fetchIdRef.current) return;
      setBalance(rawBalance);
    } catch {
      if (fetchId === fetchIdRef.current) {
        setBalance(0);
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [client, isConnected, userAddress, mintAddress]);

  // Handle wallet or mint changes
  useEffect(() => {
    if (lastUserRef.current !== userAddress) {
      lastUserRef.current = userAddress;
      setIsLoading(true);
    }
    refetch();
  }, [userAddress, mintAddress, refetch]);

  // Listen for custom protocol balance update events and window focus
  useProtocolSyncSubscription(
    () => {
      // 1. Immediate refetch for instant UI responsiveness
      refetch();

      // 2. Trailing refetch (~1000ms) to guarantee sync across delayed RPC slot propagation
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current);
      }
      trailingTimerRef.current = setTimeout(() => {
        refetch();
      }, 1000);
    },
    {
      scopes: ["all", "user"],
      debounceMs: 50,
    }
  );

  const formattedBalance = formatTokenAmount(balance, decimals, 2, 2);

  return {
    balance,
    formattedBalance,
    isLoading: isConnected ? isLoading : false,
    refetch,
  };
}
