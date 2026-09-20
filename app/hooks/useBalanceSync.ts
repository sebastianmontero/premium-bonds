"use client";

import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useWalletConnection, useSolanaClient } from "@solana/react-hooks";
import { address } from "@solana/kit";
import {
  USDC_MINT,
  findAtaAddress,
  parseTokenAccountBalance,
  decodeAccountBase64Data,
} from "@/app/lib/bonds-sdk";
import { bondsKeys } from "@/app/lib/query-keys";
import {
  updateSolBalanceCache,
  updateTokenBalanceCache,
} from "@/app/lib/balance-cache";

/**
 * Interruptible sleep that immediately aborts on signal and wakes up on window 'online' events.
 */
function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      return reject(new DOMException("Aborted", "AbortError"));
    }

    let timer: NodeJS.Timeout | null = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };

    const onOnline = () => {
      cleanup();
      resolve();
    };

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);

    signal.addEventListener("abort", onAbort, { once: true });
    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline, { once: true });
    }
  });
}

/**
 * Consumes an async iterable notification stream safely, aborting its sibling controller on termination or error.
 */
async function runStreamWithSiblingAbort<T>(
  stream: AsyncIterable<T>,
  controller: AbortController,
  onUpdate: (notification: T) => void
): Promise<void> {
  try {
    for await (const notification of stream) {
      if (controller.signal.aborted) break;
      onUpdate(notification);
    }
  } finally {
    // If this stream closes or errors, abort the sibling stream to trigger reconnection
    if (!controller.signal.aborted) {
      controller.abort();
    }
  }
}

export function useBalanceSync(): void {
  const client = useSolanaClient();
  const queryClient = useQueryClient();
  const { wallet, status } = useWalletConnection();

  const userAddress = wallet?.account.address.toString();
  const isConnected = status === "connected" && !!userAddress;

  useEffect(() => {
    if (!isConnected || !userAddress) return;
    const activeUserAddress = userAddress;

    const rootController = new AbortController();
    const { rpcSubscriptions } = client.runtime;
    const balanceQueryKey = bondsKeys.userAssetBalances(
      activeUserAddress,
      USDC_MINT
    );

    async function runReconnectionLoop() {
      let backoffMs = 1000;

      while (!rootController.signal.aborted) {
        const iterationController = new AbortController();
        const onRootAbort = () => iterationController.abort();
        rootController.signal.addEventListener("abort", onRootAbort, {
          once: true,
        });

        try {
          const user = address(activeUserAddress);
          const userAta = await findAtaAddress(activeUserAddress, USDC_MINT);

          // 1. Concurrent Subscriptions via Promise.all
          const [solSub, ataSub] = await Promise.all([
            rpcSubscriptions
              .accountNotifications(user, {
                commitment: "confirmed",
                encoding: "base64",
              })
              .subscribe({ abortSignal: iterationController.signal }),
            rpcSubscriptions
              .accountNotifications(userAta, {
                commitment: "confirmed",
                encoding: "base64",
              })
              .subscribe({ abortSignal: iterationController.signal }),
          ]);

          // Connection established successfully: reset backoff
          backoffMs = 1000;

          // 2. Start sibling-aborting stream consumers
          const solPromise = runStreamWithSiblingAbort(
            solSub,
            iterationController,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (notification: any) => {
              const notifSlot = BigInt(notification.context?.slot ?? 0n);
              const solLamports = notification.value?.lamports
                ? BigInt(notification.value.lamports)
                : 0n;

              updateSolBalanceCache(
                queryClient,
                balanceQueryKey,
                solLamports,
                notifSlot
              );
            }
          );

          const ataPromise = runStreamWithSiblingAbort(
            ataSub,
            iterationController,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (notification: any) => {
              const notifSlot = BigInt(notification.context?.slot ?? 0n);
              const rawBytes = decodeAccountBase64Data(notification.value);
              const tokenBaseUnits = rawBytes
                ? parseTokenAccountBalance(rawBytes)
                : 0n;

              updateTokenBalanceCache(
                queryClient,
                balanceQueryKey,
                tokenBaseUnits,
                notifSlot
              );
            }
          );

          // 3. Trigger initial snapshot query once subscriptions are verified active
          queryClient.invalidateQueries({ queryKey: balanceQueryKey });

          // Wait until either stream terminates or errors
          await Promise.all([solPromise, ataPromise]);
        } catch (err) {
          if (rootController.signal.aborted) return;
          console.warn(
            `[BalanceSync] WebSocket disconnected. Reconnecting in ${backoffMs}ms...`,
            err
          );
        } finally {
          iterationController.abort();
          rootController.signal.removeEventListener("abort", onRootAbort);
        }

        // Apply interruptible backoff delay before reconnecting
        if (!rootController.signal.aborted) {
          try {
            await sleepWithAbort(backoffMs, rootController.signal);
            backoffMs = Math.min(backoffMs * 2, 30_000);
            queryClient.invalidateQueries({ queryKey: balanceQueryKey });
          } catch {
            return;
          }
        }
      }
    }

    runReconnectionLoop();

    return () => {
      rootController.abort();
    };
  }, [isConnected, userAddress, client, queryClient]);
}
