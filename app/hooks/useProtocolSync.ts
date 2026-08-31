"use client";

import { useEffect, useRef } from "react";
import { notifyProtocolUpdate } from "../lib/protocol-sync-bus";

export interface ProtocolSyncOptions {
  intervalMs?: number;
}

let lastFocusSyncTime = 0;
const FOCUS_COOLDOWN_MS = 4000;

/**
 * Custom React hook that drives background ambient or push heartbeat ticks,
 * network-online recovery, and tab focus synchronization.
 */
export function useProtocolSync(options: ProtocolSyncOptions = {}): void {
  const { intervalMs = 18000 } = options;
  const intervalRef = useRef(intervalMs);

  useEffect(() => {
    intervalRef.current = intervalMs;
  }, [intervalMs]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timer: NodeJS.Timeout | null = null;

    const scheduleTimer = () => {
      if (timer) clearInterval(timer);
      if (document.visibilityState === "visible" && intervalRef.current > 0) {
        timer = setInterval(() => {
          notifyProtocolUpdate("pool", { reason: "heartbeat_tick" });
        }, intervalRef.current);
      }
    };

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        const now = Date.now();
        if (now - lastFocusSyncTime >= FOCUS_COOLDOWN_MS) {
          lastFocusSyncTime = now;
          notifyProtocolUpdate("all", { reason: "tab_focused" });
        }
        scheduleTimer();
      } else {
        if (timer) {
          clearInterval(timer);
          timer = null;
        }
      }
    };

    const handleOnline = () => {
      notifyProtocolUpdate("all", { reason: "network_online" });
      scheduleTimer();
    };

    scheduleTimer();

    window.addEventListener("visibilitychange", handleVisibilityOrFocus);
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("online", handleOnline);

    return () => {
      if (timer) clearInterval(timer);
      window.removeEventListener("visibilitychange", handleVisibilityOrFocus);
      window.removeEventListener("focus", handleVisibilityOrFocus);
      window.removeEventListener("online", handleOnline);
    };
  }, [intervalMs]);
}
