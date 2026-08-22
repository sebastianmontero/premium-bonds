"use client";

import { useEffect, useRef } from "react";
import { notifyProtocolUpdate } from "../lib/protocol-sync-bus";

export interface ProtocolSyncOptions {
  isFrozenForDraw?: boolean;
  isAwaitingDraw?: boolean;
  hasSettlingRedemptions?: boolean;
  hasActiveTx?: boolean;
  fastIntervalMs?: number;
  ambientIntervalMs?: number;
}

interface SyncCoordinatorState {
  activeSubscribers: number;
  volatileSubscribers: number;
  settlingSubscribers: number;
  intervalTimer: NodeJS.Timeout | null;
  currentCadence: "fast" | "ambient" | "paused";
}

const coordinatorState: SyncCoordinatorState = {
  activeSubscribers: 0,
  volatileSubscribers: 0,
  settlingSubscribers: 0,
  intervalTimer: null,
  currentCadence: "paused",
};

function evaluateAndScheduleCadence(
  fastIntervalMs: number = 3500,
  ambientIntervalMs: number = 18000
) {
  if (typeof window === "undefined") return;

  const isVisible =
    typeof document !== "undefined"
      ? document.visibilityState === "visible"
      : true;

  if (!isVisible || coordinatorState.activeSubscribers === 0) {
    if (coordinatorState.intervalTimer) {
      clearInterval(coordinatorState.intervalTimer);
      coordinatorState.intervalTimer = null;
    }
    coordinatorState.currentCadence = "paused";
    return;
  }

  const isVolatile = coordinatorState.volatileSubscribers > 0;
  const targetCadence: "fast" | "ambient" = isVolatile ? "fast" : "ambient";
  const targetInterval = isVolatile ? fastIntervalMs : ambientIntervalMs;

  if (
    coordinatorState.currentCadence !== targetCadence ||
    !coordinatorState.intervalTimer
  ) {
    if (coordinatorState.intervalTimer) {
      clearInterval(coordinatorState.intervalTimer);
    }

    coordinatorState.currentCadence = targetCadence;
    coordinatorState.intervalTimer = setInterval(() => {
      // In fast-cadence volatile polling, only poll pool & redemptions to prevent RPC rate-limit exhaustion
      if (coordinatorState.settlingSubscribers > 0) {
        notifyProtocolUpdate("redemptions", { reason: "settling_poll" });
      }
      notifyProtocolUpdate("pool", { reason: `${targetCadence}_cadence_tick` });
    }, targetInterval);
  }
}

/**
 * Custom React hook that registers the component with the singleton protocol sync engine.
 * Automatically modulates between Fast (3.5s) and Ambient (18s) cadences.
 */
export function useProtocolSync(options: ProtocolSyncOptions = {}): void {
  const {
    isFrozenForDraw = false,
    isAwaitingDraw = false,
    hasSettlingRedemptions = false,
    hasActiveTx = false,
    fastIntervalMs = 3500,
    ambientIntervalMs = 18000,
  } = options;

  const isVolatile =
    isFrozenForDraw || isAwaitingDraw || hasSettlingRedemptions || hasActiveTx;

  const prevVolatileRef = useRef(isVolatile);
  const prevSettlingRef = useRef(hasSettlingRedemptions);

  useEffect(() => {
    coordinatorState.activeSubscribers += 1;
    if (isVolatile) coordinatorState.volatileSubscribers += 1;
    if (hasSettlingRedemptions) coordinatorState.settlingSubscribers += 1;

    evaluateAndScheduleCadence(fastIntervalMs, ambientIntervalMs);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        notifyProtocolUpdate("all", { reason: "tab_focused" });
        evaluateAndScheduleCadence(fastIntervalMs, ambientIntervalMs);
      } else {
        evaluateAndScheduleCadence(fastIntervalMs, ambientIntervalMs);
      }
    };

    const handleOnline = () => {
      notifyProtocolUpdate("all", { reason: "network_online" });
      evaluateAndScheduleCadence(fastIntervalMs, ambientIntervalMs);
    };

    window.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      coordinatorState.activeSubscribers = Math.max(
        0,
        coordinatorState.activeSubscribers - 1
      );
      if (prevVolatileRef.current) {
        coordinatorState.volatileSubscribers = Math.max(
          0,
          coordinatorState.volatileSubscribers - 1
        );
      }
      if (prevSettlingRef.current) {
        coordinatorState.settlingSubscribers = Math.max(
          0,
          coordinatorState.settlingSubscribers - 1
        );
      }

      window.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("online", handleOnline);

      evaluateAndScheduleCadence(fastIntervalMs, ambientIntervalMs);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fastIntervalMs, ambientIntervalMs]);

  // Adjust counters when volatile or settling state changes
  useEffect(() => {
    if (prevVolatileRef.current !== isVolatile) {
      if (isVolatile) {
        coordinatorState.volatileSubscribers += 1;
      } else {
        coordinatorState.volatileSubscribers = Math.max(
          0,
          coordinatorState.volatileSubscribers - 1
        );
      }
      prevVolatileRef.current = isVolatile;
    }

    if (prevSettlingRef.current !== hasSettlingRedemptions) {
      if (hasSettlingRedemptions) {
        coordinatorState.settlingSubscribers += 1;
      } else {
        coordinatorState.settlingSubscribers = Math.max(
          0,
          coordinatorState.settlingSubscribers - 1
        );
      }
      prevSettlingRef.current = hasSettlingRedemptions;
    }

    evaluateAndScheduleCadence(fastIntervalMs, ambientIntervalMs);
  }, [isVolatile, hasSettlingRedemptions, fastIntervalMs, ambientIntervalMs]);
}
