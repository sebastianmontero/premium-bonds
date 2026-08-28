"use client";

import { useEffect, useState } from "react";
import { getPusherClient } from "../lib/realtime/client";
import {
  notifyProtocolUpdate,
  ProtocolSyncDetail,
} from "../lib/protocol-sync-bus";
import type { Channel } from "pusher-js";

export interface ProtocolPushSyncStatus {
  isConnected: boolean;
  isAvailable: boolean;
}

export function useProtocolPushSync(
  userAddress?: string
): ProtocolPushSyncStatus {
  const [isConnected, setIsConnected] = useState(() =>
    typeof window !== "undefined"
      ? Boolean(getPusherClient()?.connection.state === "connected")
      : false
  );
  const [isAvailable] = useState(() =>
    typeof window !== "undefined" ? Boolean(getPusherClient()) : false
  );

  useEffect(() => {
    const pusher = getPusherClient();
    if (!pusher) return;

    const handleConnected = () => setIsConnected(true);
    const handleDisconnected = () => setIsConnected(false);

    pusher.connection.bind("connected", handleConnected);
    pusher.connection.bind("disconnected", handleDisconnected);
    pusher.connection.bind("unavailable", handleDisconnected);
    pusher.connection.bind("failed", handleDisconnected);

    // 1. Subscribe to Global Protocol Channel
    const handleGlobalSync = (data: ProtocolSyncDetail) => {
      notifyProtocolUpdate(data.scope, {
        poolId: data.poolId,
        reason: `push:${data.reason || "global"}`,
      });
    };

    const globalChannel = pusher.subscribe("pb:global");
    globalChannel.bind("protocol-sync", handleGlobalSync);

    // 2. Subscribe to User-Specific Channel (if userAddress is provided)
    let userChannel: Channel | null = null;
    let handleUserSync: ((data: ProtocolSyncDetail) => void) | null = null;

    if (userAddress) {
      handleUserSync = (data: ProtocolSyncDetail) => {
        notifyProtocolUpdate(data.scope, {
          poolId: data.poolId,
          reason: `push:user_${data.reason || "personal"}`,
        });
      };

      userChannel = pusher.subscribe(`pb:user-${userAddress}`);
      userChannel.bind("protocol-sync", handleUserSync);
    }

    return () => {
      globalChannel.unbind("protocol-sync", handleGlobalSync);
      pusher.unsubscribe("pb:global");

      if (userChannel && userAddress && handleUserSync) {
        userChannel.unbind("protocol-sync", handleUserSync);
        pusher.unsubscribe(`pb:user-${userAddress}`);
      }

      pusher.connection.unbind("connected", handleConnected);
      pusher.connection.unbind("disconnected", handleDisconnected);
      pusher.connection.unbind("unavailable", handleDisconnected);
      pusher.connection.unbind("failed", handleDisconnected);
    };
  }, [userAddress]);

  return { isConnected, isAvailable };
}
