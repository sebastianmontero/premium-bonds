import Pusher from "pusher";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
  derivePrimaryScope,
  partitionBroadcastInvalidations,
  type RealtimeBroadcastItem,
} from "./channels";

export type { RealtimeBroadcastItem };

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

export async function broadcastAggregatedInvalidations(
  events: RealtimeBroadcastItem[]
): Promise<void> {
  const server = getPusherServer();
  if (!server || events.length === 0) return;

  try {
    const { globalScopes, globalPoolIds, userPartitions } =
      partitionBroadcastInvalidations(events);

    const broadcastPromises: Promise<unknown>[] = [];
    const globalPoolsArray = Array.from(globalPoolIds);
    const primaryPoolId =
      globalPoolsArray.length === 1 ? globalPoolsArray[0] : undefined;
    const globalScopesArray = Array.from(globalScopes);

    // 1. Single Global / Pool Invalidation Broadcast
    if (globalScopesArray.length > 0) {
      broadcastPromises.push(
        server.trigger(REALTIME_GLOBAL_CHANNEL, REALTIME_PROTOCOL_SYNC_EVENT, {
          scope: derivePrimaryScope(globalScopesArray),
          scopes: globalScopesArray,
          poolId: primaryPoolId,
          poolIds: globalPoolsArray.length > 0 ? globalPoolsArray : undefined,
          reason: `webhook:aggregated_${events.length}_events`,
          timestamp: Date.now(),
        })
      );
    }

    // 2. Targeted User Channel Invalidation Broadcasts
    for (const [user, partition] of userPartitions.entries()) {
      if (partition.scopes.size === 0) continue;
      const userChannel = getRealtimeUserChannel(user);
      if (!isValidPusherChannel(userChannel)) continue;

      const uScopesArray = Array.from(partition.scopes);
      const uPoolsArray = Array.from(partition.poolIds);

      broadcastPromises.push(
        server.trigger(userChannel, REALTIME_PROTOCOL_SYNC_EVENT, {
          scope: derivePrimaryScope(uScopesArray),
          scopes: uScopesArray,
          poolId: uPoolsArray.length === 1 ? uPoolsArray[0] : undefined,
          poolIds: uPoolsArray.length > 0 ? uPoolsArray : undefined,
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
