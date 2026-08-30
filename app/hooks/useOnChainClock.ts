"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSolanaClient } from "@solana/react-hooks";
import { address, getBase64Encoder } from "@solana/kit";
import { notifyProtocolUpdate } from "../lib/protocol-sync-bus";

interface UseOnChainClockOptions {
  resyncIntervalMs?: number;
}

const DEFAULT_RESYNC_INTERVAL_MS =
  Number(process.env.NEXT_PUBLIC_CLOCK_RESYNC_INTERVAL_MS) || 60000;

const SYSVAR_CLOCK_ADDRESS = address(
  "SysvarC1ock11111111111111111111111111111111"
);
const base64Encoder = getBase64Encoder();

interface SharedClockState {
  clockOffset: number;
  isSynced: boolean;
  lastSyncTime: number;
  activeRequests: number;
  listeners: Set<(offset: number, synced: boolean) => void>;
  syncTimer: NodeJS.Timeout | null;
  activeSyncFn: (() => Promise<void>) | null;
}

const sharedClockState: SharedClockState = {
  clockOffset: 0,
  isSynced: false,
  lastSyncTime: 0,
  activeRequests: 0,
  listeners: new Set(),
  syncTimer: null,
  activeSyncFn: null,
};

function notifyListeners() {
  sharedClockState.listeners.forEach((listener) => {
    listener(sharedClockState.clockOffset, sharedClockState.isSynced);
  });
}

function ensureSharedSyncTimer(
  syncFn: () => Promise<void>,
  resyncIntervalMs: number
) {
  sharedClockState.activeSyncFn = syncFn;
  if (!sharedClockState.syncTimer && sharedClockState.listeners.size > 0) {
    sharedClockState.syncTimer = setInterval(() => {
      if (
        sharedClockState.activeSyncFn &&
        sharedClockState.listeners.size > 0
      ) {
        sharedClockState.activeSyncFn();
      }
    }, resyncIntervalMs);
  }
}

function stopSharedSyncTimerIfOrphaned() {
  if (sharedClockState.listeners.size === 0 && sharedClockState.syncTimer) {
    clearInterval(sharedClockState.syncTimer);
    sharedClockState.syncTimer = null;
    sharedClockState.activeSyncFn = null;
  }
}

export function useOnChainClock(options: UseOnChainClockOptions = {}) {
  const { resyncIntervalMs = DEFAULT_RESYNC_INTERVAL_MS } = options;
  const client = useSolanaClient();
  const [clockOffset, setClockOffset] = useState<number>(
    sharedClockState.clockOffset
  );
  const [isSynced, setIsSynced] = useState<boolean>(sharedClockState.isSynced);
  const reqIdRef = useRef<number>(0);

  const syncClock = useCallback(async () => {
    const currentReqId = ++reqIdRef.current;
    // Record local time BEFORE RPC call to eliminate RTT latency skew
    const startSystemNow = Math.floor(Date.now() / 1000);

    try {
      const rpc = client.runtime.rpc;
      const clockAcc = await rpc
        .getAccountInfo(SYSVAR_CLOCK_ADDRESS, {
          encoding: "base64",
          commitment: "confirmed",
        })
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
            const newOffset = onChainTime - startSystemNow;
            const hasJump =
              !sharedClockState.isSynced ||
              Math.abs(newOffset - sharedClockState.clockOffset) >= 3;

            sharedClockState.clockOffset = newOffset;
            sharedClockState.isSynced = true;
            sharedClockState.lastSyncTime = Date.now();
            setClockOffset(newOffset);
            setIsSynced(true);
            notifyListeners();

            if (hasJump) {
              notifyProtocolUpdate("clock", { reason: "clock_offset_jump" });
            }
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
      const slot = await rpc.getSlot({ commitment: "confirmed" }).send();
      const blockTime = await rpc.getBlockTime(slot).send();

      if (blockTime !== null && currentReqId === reqIdRef.current) {
        const newOffset = Number(blockTime) - startSystemNow;
        const hasJump =
          !sharedClockState.isSynced ||
          Math.abs(newOffset - sharedClockState.clockOffset) >= 3;

        sharedClockState.clockOffset = newOffset;
        sharedClockState.isSynced = true;
        sharedClockState.lastSyncTime = Date.now();
        setClockOffset(newOffset);
        setIsSynced(true);
        notifyListeners();

        if (hasJump) {
          notifyProtocolUpdate("clock", { reason: "clock_offset_jump" });
        }
      }
    } catch {
      // Retain existing clockOffset on failure
    }
  }, [client]);

  useEffect(() => {
    let active = true;

    const listener = (offset: number, synced: boolean) => {
      if (active) {
        setClockOffset(offset);
        setIsSynced(synced);
      }
    };

    sharedClockState.listeners.add(listener);
    ensureSharedSyncTimer(syncClock, resyncIntervalMs);

    // Initial sync if not synced or older than resync interval
    if (
      !sharedClockState.isSynced ||
      Date.now() - sharedClockState.lastSyncTime > resyncIntervalMs
    ) {
      queueMicrotask(() => {
        if (active) {
          syncClock();
        }
      });
    }

    // Re-sync immediately when tab becomes visible after being backgrounded
    function handleVisibilityChange() {
      if (document.visibilityState === "visible" && active) {
        syncClock();
      }
    }

    window.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      sharedClockState.listeners.delete(listener);
      stopSharedSyncTimerIfOrphaned();
      window.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [syncClock, resyncIntervalMs]);

  return { clockOffset, isSynced, resync: syncClock };
}

export interface UseClusterTimeOptions {
  tick?: boolean;
  tickIntervalMs?: number;
  resyncIntervalMs?: number;
}

export interface ClusterTimeState {
  now: number;
  clockOffset: number;
  isSynced: boolean;
  resync: () => Promise<void>;
  getNow: () => number;
}

/**
 * React hook that returns a reactive, cluster-synchronized unix timestamp (seconds).
 * Automatically ticks at `tickIntervalMs` (default 1000ms) and updates immediately
 * when Solana cluster clock synchronization finishes.
 */
export function useClusterTime(
  options: UseClusterTimeOptions = {}
): ClusterTimeState {
  const { tick = true, tickIntervalMs = 1000, resyncIntervalMs } = options;
  const { clockOffset, isSynced, resync } = useOnChainClock({
    resyncIntervalMs,
  });

  const getNow = useCallback(
    () => Math.floor(Date.now() / 1000) + clockOffset,
    [clockOffset]
  );

  const [now, setNow] = useState<number>(getNow);

  // Immediately update when clockOffset finishes syncing or changes
  useEffect(() => {
    setNow(getNow());
  }, [getNow]);

  // Periodic active ticker
  useEffect(() => {
    if (!tick || !tickIntervalMs || tickIntervalMs <= 0) return;

    const intervalId = setInterval(() => {
      setNow(getNow());
    }, tickIntervalMs);

    return () => clearInterval(intervalId);
  }, [tick, tickIntervalMs, getNow]);

  return {
    now,
    clockOffset,
    isSynced,
    resync,
    getNow,
  };
}
