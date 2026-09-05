import Pusher from "pusher";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
  type ProtocolSyncScope,
  derivePrimaryScope,
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
  scope?: ProtocolSyncScope;
  scopes?: readonly ProtocolSyncScope[];
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
    const userScopes = new Map<string, Set<ProtocolSyncScope>>();
    const userPoolIds = new Map<string, Set<number>>();
    const poolIds = new Set<number>();

    for (const evt of events) {
      const evtScopes = evt.scopes ?? (evt.scope ? [evt.scope] : ["all"]);
      for (const s of evtScopes) scopes.add(s);
      if (evt.poolId !== undefined) poolIds.add(evt.poolId);

      if (evt.userAddress) {
        const existingScopes = userScopes.get(evt.userAddress) ?? new Set();
        for (const s of evtScopes) existingScopes.add(s);
        userScopes.set(evt.userAddress, existingScopes);

        if (evt.poolId !== undefined) {
          const existingPools = userPoolIds.get(evt.userAddress) ?? new Set();
          existingPools.add(evt.poolId);
          userPoolIds.set(evt.userAddress, existingPools);
        }
      }
    }

    const broadcastPromises: Promise<unknown>[] = [];
    const poolIdsArray = Array.from(poolIds);
    const primaryPoolId =
      poolIdsArray.length === 1 ? poolIdsArray[0] : undefined;
    const scopesArray = Array.from(scopes);

    const USER_SPECIFIC_SCOPES: ReadonlySet<ProtocolSyncScope> = new Set([
      "user",
      "tickets",
      "redemptions",
      "activity",
    ]);

    // 1. Single Global / Pool Invalidation Broadcast (protocol/pool scopes, plus protocol-wide user invalidation if no targeted users)
    const globalScopes = scopesArray.filter(
      (s) => !USER_SPECIFIC_SCOPES.has(s) || (s === "user" && userScopes.size === 0)
    );
    if (globalScopes.length > 0) {
      broadcastPromises.push(
        server.trigger(REALTIME_GLOBAL_CHANNEL, REALTIME_PROTOCOL_SYNC_EVENT, {
          scope: derivePrimaryScope(globalScopes),
          scopes: globalScopes,
          poolId: primaryPoolId,
          poolIds: poolIdsArray.length > 0 ? poolIdsArray : undefined,
          reason: `webhook:aggregated_${events.length}_events`,
          timestamp: Date.now(),
        })
      );
    }

    // 2. Targeted User Channel Invalidation Broadcasts
    for (const [user, uScopes] of userScopes.entries()) {
      const userChannel = getRealtimeUserChannel(user);
      if (!isValidPusherChannel(userChannel)) continue;

      const uScopesArray = Array.from(uScopes);
      const uPoolsArray = Array.from(userPoolIds.get(user) ?? []);

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
