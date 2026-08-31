"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { getPusherClient } from "../lib/realtime/client";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
} from "../lib/realtime/channels";
import {
  notifyProtocolUpdate,
  ProtocolSyncDetail,
} from "../lib/protocol-sync-bus";

export interface ProtocolPushSyncStatus {
  isConnected: boolean;
  isAvailable: boolean;
}

// ── Push Connection External Store ──────────────────────────────────────────

type PushStatusListener = () => void;
const pushListeners = new Set<PushStatusListener>();
let _pushConnected = false;

export const pushConnectionStore = {
  subscribe(listener: PushStatusListener): () => void {
    pushListeners.add(listener);
    return () => pushListeners.delete(listener);
  },
  getSnapshot(): boolean {
    if (typeof window === "undefined") return false;
    const client = getPusherClient();
    return client?.connection.state === "connected" || _pushConnected;
  },
  getServerSnapshot(): boolean {
    return false;
  },
  setConnected(connected: boolean) {
    if (_pushConnected !== connected) {
      _pushConnected = connected;
      pushListeners.forEach((l) => l());
    }
  },
};

/**
 * Hook to subscribe to Pusher connection status safely across SSR and Concurrent React.
 */
export function usePushConnectionStatus(): { isConnected: boolean } {
  const isConnected = useSyncExternalStore(
    pushConnectionStore.subscribe,
    pushConnectionStore.getSnapshot,
    pushConnectionStore.getServerSnapshot
  );
  return { isConnected };
}

/**
 * Dispatches incoming push notification sync payloads into the protocol sync bus.
 * Defensively guards against malformed or partial push payloads over the socket.
 */
export function dispatchPushSync(
  data: Partial<ProtocolSyncDetail> | undefined,
  channelType: "global" | "user"
): void {
  notifyProtocolUpdate(data?.scope ?? "all", {
    scopes: data?.scopes,
    poolId: data?.poolId,
    poolIds: data?.poolIds,
    reason: `push:${channelType}_${data?.reason || ""}`,
  });
}

export function useProtocolPushSync(
  userAddress?: string
): ProtocolPushSyncStatus {
  const { isConnected } = usePushConnectionStatus();
  const [isAvailable] = useState<boolean>(() =>
    typeof window !== "undefined" ? Boolean(getPusherClient()) : false
  );

  // 1. Global Pusher connection & pb-global channel lifecycle (Mounted once)
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    let wasEverConnected = false;
    let lastReconnectionTime = 0;
    const RECONNECT_COOLDOWN_MS = 10_000;

    const handleConnected = () => {
      pushConnectionStore.setConnected(true);
      const now = Date.now();
      if (
        wasEverConnected &&
        now - lastReconnectionTime > RECONNECT_COOLDOWN_MS
      ) {
        lastReconnectionTime = now;
        // Reconnection recovery: catch up on missed state changes during sleep/offline
        notifyProtocolUpdate("all", { reason: "push:reconnected" });
      }
      wasEverConnected = true;
    };
    const handleDisconnected = () => pushConnectionStore.setConnected(false);
    const handleStateChange = (states: {
      previous: string;
      current: string;
    }) => {
      pushConnectionStore.setConnected(states.current === "connected");
    };

    pusher.connection.bind("connected", handleConnected);
    pusher.connection.bind("disconnected", handleDisconnected);
    pusher.connection.bind("unavailable", handleDisconnected);
    pusher.connection.bind("failed", handleDisconnected);
    pusher.connection.bind("state_change", handleStateChange);

    // Initial state check
    if (pusher.connection.state === "connected") {
      pushConnectionStore.setConnected(true);
    }

    // Subscribe to Global Protocol Channel
    const handleGlobalSync = (data: ProtocolSyncDetail) => {
      dispatchPushSync(data, "global");
    };

    const globalChannel = pusher.subscribe(REALTIME_GLOBAL_CHANNEL);
    globalChannel.bind(REALTIME_PROTOCOL_SYNC_EVENT, handleGlobalSync);

    return () => {
      globalChannel.unbind(REALTIME_PROTOCOL_SYNC_EVENT, handleGlobalSync);
      pusher.unsubscribe(REALTIME_GLOBAL_CHANNEL);

      pusher.connection.unbind("connected", handleConnected);
      pusher.connection.unbind("disconnected", handleDisconnected);
      pusher.connection.unbind("unavailable", handleDisconnected);
      pusher.connection.unbind("failed", handleDisconnected);
      pusher.connection.unbind("state_change", handleStateChange);
    };
  }, []);

  // 2. User-Specific Channel lifecycle (Subscribes/unsubscribes strictly when userAddress changes)
  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher || !userAddress) return;

    const targetUserChannel = getRealtimeUserChannel(userAddress);
    if (!isValidPusherChannel(targetUserChannel)) return;

    const handleUserSync = (data: ProtocolSyncDetail) => {
      dispatchPushSync(data, "user");
    };

    const userChannel = pusher.subscribe(targetUserChannel);
    userChannel.bind(REALTIME_PROTOCOL_SYNC_EVENT, handleUserSync);

    return () => {
      userChannel.unbind(REALTIME_PROTOCOL_SYNC_EVENT, handleUserSync);
      pusher.unsubscribe(targetUserChannel);
    };
  }, [userAddress]);

  return { isConnected, isAvailable };
}
