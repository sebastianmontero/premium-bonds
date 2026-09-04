"use client";

import { useEffect, useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getPusherClient } from "@/app/lib/realtime/client";
import {
  REALTIME_GLOBAL_CHANNEL,
  getRealtimeUserChannel,
  REALTIME_PROTOCOL_SYNC_EVENT,
  type ProtocolSyncMessage,
} from "@/app/lib/realtime/channels";
import { bondsKeys, type PoolId } from "@/app/lib/query-keys";
import { useWalletConnection } from "@solana/react-hooks";

export function useRealtimeSync(poolId: PoolId = 1) {
  const queryClient = useQueryClient();
  const { wallet } = useWalletConnection();
  const userAddress = wallet?.account.address.toString();
  const userAddressRef = useRef(userAddress);

  useEffect(() => {
    userAddressRef.current = userAddress;
  }, [userAddress]);

  const [isPusherConnected, setIsPusherConnected] = useState<boolean>(
    () => typeof window !== "undefined" && Boolean(getPusherClient())
  );
  const wasDisconnectedRef = useRef(false);

  useEffect(() => {
    const client = getPusherClient();
    if (!client) return;

    const handleConnected = () => {
      setIsPusherConnected(true);
      if (wasDisconnectedRef.current) {
        // Reconnection watermark: catch up on dropped events
        queryClient.invalidateQueries({ queryKey: bondsKeys.poolRoot(poolId) });
        wasDisconnectedRef.current = false;
      }
    };
    const handleDisconnected = () => {
      setIsPusherConnected(false);
      wasDisconnectedRef.current = true;
    };

    client.connection.bind("connected", handleConnected);
    client.connection.bind("error", handleDisconnected);
    client.connection.bind("disconnected", handleDisconnected);

    const handleProtocolSync = (msg: ProtocolSyncMessage) => {
      if (!msg) return;
      if (msg.poolId !== undefined && msg.poolId !== poolId) return;

      const scopes = msg.scopes || (msg.scope ? [msg.scope] : ["all"]);
      const currentAddress = userAddressRef.current;
      const keysToInvalidate: (readonly unknown[])[] = [];

      for (const s of scopes) {
        switch (s) {
          case "pool":
            keysToInvalidate.push(bondsKeys.poolState(poolId));
            break;
          case "draws":
          case "draw":
            keysToInvalidate.push(bondsKeys.poolState(poolId));
            keysToInvalidate.push(bondsKeys.draws(poolId));
            keysToInvalidate.push(bondsKeys.prizes(poolId));
            if (currentAddress) {
              keysToInvalidate.push(
                bondsKeys.userPrizeHistory(poolId, currentAddress)
              );
            }
            break;
          case "activity":
            keysToInvalidate.push(
              bondsKeys.activityFeed(poolId, currentAddress)
            );
            break;
          case "redemptions":
            if (currentAddress) {
              keysToInvalidate.push(
                bondsKeys.userRedemptions(poolId, currentAddress)
              );
            }
            break;
          case "user":
          case "tickets":
            if (currentAddress) {
              keysToInvalidate.push(
                bondsKeys.userPosition(poolId, currentAddress)
              );
              keysToInvalidate.push(
                bondsKeys.userPrizeHistory(poolId, currentAddress)
              );
            }
            break;
          case "all":
            keysToInvalidate.push(bondsKeys.poolRoot(poolId));
            break;
        }
      }

      // Deduplicate keys before invalidating
      const seen = new Set<string>();
      for (const key of keysToInvalidate) {
        const serialized = JSON.stringify(key);
        if (!seen.has(serialized)) {
          seen.add(serialized);
          queryClient.invalidateQueries({ queryKey: key });
        }
      }
    };

    const globalChannel = client.subscribe(REALTIME_GLOBAL_CHANNEL);
    globalChannel.bind(REALTIME_PROTOCOL_SYNC_EVENT, handleProtocolSync);

    const userChannel = userAddress
      ? client.subscribe(getRealtimeUserChannel(userAddress))
      : null;
    if (userChannel) {
      userChannel.bind(REALTIME_PROTOCOL_SYNC_EVENT, handleProtocolSync);
    }

    return () => {
      client.connection.unbind("connected", handleConnected);
      client.connection.unbind("error", handleDisconnected);
      client.connection.unbind("disconnected", handleDisconnected);

      globalChannel.unbind(REALTIME_PROTOCOL_SYNC_EVENT, handleProtocolSync);
      client.unsubscribe(REALTIME_GLOBAL_CHANNEL);

      if (userChannel && userAddress) {
        userChannel.unbind(REALTIME_PROTOCOL_SYNC_EVENT, handleProtocolSync);
        client.unsubscribe(getRealtimeUserChannel(userAddress));
      }
    };
  }, [poolId, userAddress, queryClient]);

  return { isPusherConnected };
}
