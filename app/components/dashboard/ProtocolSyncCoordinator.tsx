"use client";

import { useEffect, useRef } from "react";
import { usePushConnectionStatus } from "@/app/hooks/useProtocolPushSync";
import { useProtocolSync } from "@/app/hooks/useProtocolSync";
import { notifyProtocolUpdate } from "@/app/lib/protocol-sync-bus";

/**
 * Headless protocol synchronization coordinator.
 * Mounted once at the dashboard layout boundary to drive real-time background
 * reactivity across all dashboard tabs without spawning duplicate timers.
 */
export function ProtocolSyncCoordinator() {
  const { isConnected: isPushConnected } = usePushConnectionStatus();
  const prevConnectedRef = useRef(isPushConnected);

  useEffect(() => {
    if (prevConnectedRef.current && !isPushConnected) {
      notifyProtocolUpdate("pool", { reason: "fallback_activated" });
    }
    prevConnectedRef.current = isPushConnected;
  }, [isPushConnected]);

  useProtocolSync({
    intervalMs: isPushConnected ? 90000 : 18000,
  });

  return null;
}

