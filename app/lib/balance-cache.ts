import type { QueryClient } from "@tanstack/react-query";
import type { UserRawBalances } from "./bonds-sdk";

/**
 * Pure cache updater for native SOL lamport balance with slot-monotonic guard.
 */
export function updateSolBalanceCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  solLamports: bigint,
  slot: bigint
): void {
  queryClient.setQueryData<UserRawBalances>(queryKey, (prev) => {
    if (prev && prev.slot > slot) return prev;
    return {
      solLamports,
      tokenBaseUnits: prev?.tokenBaseUnits ?? 0n,
      slot,
    };
  });
}

/**
 * Pure cache updater for SPL Token base units balance with slot-monotonic guard.
 */
export function updateTokenBalanceCache(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  tokenBaseUnits: bigint,
  slot: bigint
): void {
  queryClient.setQueryData<UserRawBalances>(queryKey, (prev) => {
    if (prev && prev.slot > slot) return prev;
    return {
      solLamports: prev?.solLamports ?? 0n,
      tokenBaseUnits,
      slot,
    };
  });
}
