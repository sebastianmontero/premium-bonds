"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import { getBase64Encoder } from "@solana/kit";
import { USDC_MINT, findAtaAddress } from "../lib/bonds-sdk";
import { formatTokenAmount, USDC_DECIMALS } from "../lib/formatters";

const base64Encoder = getBase64Encoder();

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

  const refetch = useCallback(async () => {
    const fetchId = ++fetchIdRef.current;

    if (!isConnected || !userAddress) {
      setBalance(0);
      setIsLoading(false);
      return;
    }

    try {
      const userAta = await findAtaAddress(userAddress, mintAddress);
      const rpc = client.runtime.rpc;
      const ataAcc = await rpc
        .getAccountInfo(userAta, { encoding: "base64" })
        .send();

      if (fetchId !== fetchIdRef.current) return;

      if (ataAcc && ataAcc.value && ataAcc.value.data?.[0]) {
        const tokenBytes = base64Encoder.encode(ataAcc.value.data[0]);
        if (tokenBytes.byteLength >= 72) {
          const tokenView = new DataView(
            tokenBytes.buffer,
            tokenBytes.byteOffset,
            tokenBytes.byteLength
          );
          const rawBalance = Number(tokenView.getBigUint64(64, true));
          setBalance(rawBalance);
        } else {
          setBalance(0);
        }
      } else {
        // ATA does not exist yet (brand new wallet) -> safe 0 balance
        setBalance(0);
      }
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
  useEffect(() => {
    const handleBalanceUpdate = () => {
      refetch();
    };

    window.addEventListener("pb:balance-update", handleBalanceUpdate);
    window.addEventListener("focus", handleBalanceUpdate);

    return () => {
      window.removeEventListener("pb:balance-update", handleBalanceUpdate);
      window.removeEventListener("focus", handleBalanceUpdate);
    };
  }, [refetch]);

  const formattedBalance = formatTokenAmount(balance, decimals, 2, 2);

  return {
    balance,
    formattedBalance,
    isLoading: isConnected ? isLoading : false,
    refetch,
  };
}
