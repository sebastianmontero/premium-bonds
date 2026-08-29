"use client";

import { useEffect, useState } from "react";
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

    const globalChannel = pusher.subscribe(REALTIME_GLOBAL_CHANNEL);
    globalChannel.bind(REALTIME_PROTOCOL_SYNC_EVENT, handleGlobalSync);

    // 2. Subscribe to User-Specific Channel (if userAddress is provided)
    let userChannel: Channel | null = null;
    let userChannelName: string | null = null;
    let handleUserSync: ((data: ProtocolSyncDetail) => void) | null = null;

    if (userAddress) {
      const targetUserChannel = getRealtimeUserChannel(userAddress);
      if (isValidPusherChannel(targetUserChannel)) {
        userChannelName = targetUserChannel;
        handleUserSync = (data: ProtocolSyncDetail) => {
          notifyProtocolUpdate(data.scope, {
            poolId: data.poolId,
            reason: `push:user_${data.reason || "personal"}`,
          });
        };

        userChannel = pusher.subscribe(targetUserChannel);
        userChannel.bind(REALTIME_PROTOCOL_SYNC_EVENT, handleUserSync);
      }
    }

    return () => {
      globalChannel.unbind(REALTIME_PROTOCOL_SYNC_EVENT, handleGlobalSync);
      pusher.unsubscribe(REALTIME_GLOBAL_CHANNEL);

      if (userChannel && userChannelName && handleUserSync) {
        userChannel.unbind(REALTIME_PROTOCOL_SYNC_EVENT, handleUserSync);
        pusher.unsubscribe(userChannelName);
      }

      pusher.connection.unbind("connected", handleConnected);
      pusher.connection.unbind("disconnected", handleDisconnected);
      pusher.connection.unbind("unavailable", handleDisconnected);
      pusher.connection.unbind("failed", handleDisconnected);
    };
  }, [userAddress]);

  return { isConnected, isAvailable };
}
