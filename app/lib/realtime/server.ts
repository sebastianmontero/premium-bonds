import Pusher from "pusher";
import type { ProtocolSyncScope } from "../protocol-sync-bus";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
} from "./channels";

let pusherServer: Pusher | null = null;

export function getPusherServer(): Pusher | null {
  if (pusherServer) return pusherServer;

  const appId = process.env.PUSHER_APP_ID;
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const secret = process.env.PUSHER_SECRET;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2";

  if (!appId || !key || !secret) {
    return null;
  }

  pusherServer = new Pusher({
    appId,
    key,
    secret,
    cluster,
    useTLS: true,
  });

  return pusherServer;
}

export interface RealtimeBroadcastItem {
  scope: ProtocolSyncScope;
  poolId?: number;
  userAddress?: string;
  txSignature?: string;
  reason?: string;
}

export async function broadcastAggregatedInvalidations(
  events: RealtimeBroadcastItem[]
): Promise<void> {
  const server = getPusherServer();
  if (!server || events.length === 0) return;

  try {
    const scopes = new Set<ProtocolSyncScope>();
    const userAddresses = new Set<string>();
    let primaryPoolId: number | undefined;

    for (const evt of events) {
      scopes.add(evt.scope);
      if (evt.userAddress) userAddresses.add(evt.userAddress);
      if (evt.poolId !== undefined) primaryPoolId = evt.poolId;
    }

    const broadcastPromises: Promise<unknown>[] = [];

    // 1. Single Global / Pool Invalidation Broadcast
    const aggregatedScope: ProtocolSyncScope = scopes.has("all")
      ? "all"
      : scopes.size === 1
        ? Array.from(scopes)[0]
        : "all";

    broadcastPromises.push(
      server.trigger(REALTIME_GLOBAL_CHANNEL, REALTIME_PROTOCOL_SYNC_EVENT, {
        scope: aggregatedScope,
        poolId: primaryPoolId,
        reason: `webhook:aggregated_${events.length}_events`,
        timestamp: Date.now(),
      })
    );

    // 2. Targeted User Channel Invalidation Broadcasts
    for (const user of userAddresses) {
      const userChannel = getRealtimeUserChannel(user);
      if (!isValidPusherChannel(userChannel)) continue;

      broadcastPromises.push(
        server.trigger(userChannel, REALTIME_PROTOCOL_SYNC_EVENT, {
          scope: "user",
          poolId: primaryPoolId,
          reason: "webhook:user_activity",
          timestamp: Date.now(),
        })
      );
    }

    await Promise.allSettled(broadcastPromises);
  } catch (err) {
    console.warn("[Realtime Push Warning - Non-Critical]:", err);
  }
}
