"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { address, getBase64Encoder } from "@solana/kit";

interface UseOnChainClockOptions {
  resyncIntervalMs?: number;
}

const DEFAULT_RESYNC_INTERVAL_MS =
  Number(process.env.NEXT_PUBLIC_CLOCK_RESYNC_INTERVAL_MS) || 10000;

const SYSVAR_CLOCK_ADDRESS = address(
  "SysvarC1ock11111111111111111111111111111111"
);
const base64Encoder = getBase64Encoder();

export function useOnChainClock(options: UseOnChainClockOptions = {}) {
  const { resyncIntervalMs = DEFAULT_RESYNC_INTERVAL_MS } = options;
  const client = useSolanaClient();
  const [clockOffset, setClockOffset] = useState<number>(0);
  const [isSynced, setIsSynced] = useState<boolean>(false);
  const reqIdRef = useRef<number>(0);

  const syncClock = useCallback(async () => {
    const currentReqId = ++reqIdRef.current;
    // Record local time BEFORE RPC call to eliminate RTT latency skew
    const startSystemNow = Math.floor(Date.now() / 1000);

    try {
      const rpc = client.runtime.rpc;
      const clockAcc = await rpc
        .getAccountInfo(SYSVAR_CLOCK_ADDRESS, { encoding: "base64" })
        .send();

      if (clockAcc && clockAcc.value && clockAcc.value.data[0]) {
        const bytes = new Uint8Array(
          base64Encoder.encode(clockAcc.value.data[0])
        );
        if (bytes.byteLength >= 40) {
          const view = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength
          );
          const onChainTime = Number(view.getBigInt64(32, true));

          if (currentReqId === reqIdRef.current) {
            setClockOffset(onChainTime - startSystemNow);
            setIsSynced(true);
          }
          return;
        }
      }
    } catch (err) {
      console.warn(
        "Direct Sysvar Clock account fetch failed, trying block time fallback:",
        err
      );
    }

    // Fallback to getBlockTime if sysvar account fetch fails
    try {
      const rpc = client.runtime.rpc;
      const slot = await rpc.getSlot().send();
      const blockTime = await rpc.getBlockTime(slot).send();

      if (blockTime !== null && currentReqId === reqIdRef.current) {
        setClockOffset(Number(blockTime) - startSystemNow);
        setIsSynced(true);
      }
    } catch {
      // Retain existing clockOffset on failure
    }
  }, [client]);

  useEffect(() => {
    let active = true;

    queueMicrotask(() => {
      if (active) {
        syncClock();
      }
    });

    // Re-sync immediately when tab becomes visible after being backgrounded
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && active) {
        syncClock();
      }
    }

    window.addEventListener("visibilitychange", handleVisibilityChange);
    const intervalId = setInterval(() => {
      if (active) {
        syncClock();
      }
    }, resyncIntervalMs);

    return () => {
      active = false;
      window.removeEventListener("visibilitychange", handleVisibilityChange);
      clearInterval(intervalId);
    };
  }, [syncClock, resyncIntervalMs]);

  return { clockOffset, isSynced, resync: syncClock };
}
