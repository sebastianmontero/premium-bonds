/**
 * Canonical channel and event names for Pusher realtime synchronization.
 * Pusher enforces channel names matching /^[A-Za-z0-9_\-=@,.;]+$/ with length <= 200.
 */

export const REALTIME_GLOBAL_CHANNEL = "pb-global";
export const REALTIME_PROTOCOL_SYNC_EVENT = "protocol-sync";

export type ProtocolSyncScope =
  | "all"
  | "pool"
  | "user"
  | "draws"
  | "draw"
  | "redemptions"
  | "tickets"
  | "activity"
  | "clock";

const SCOPE_PRIORITY: readonly ProtocolSyncScope[] = [
  "all",
  "draws",
  "draw",
  "pool",
  "user",
  "redemptions",
  "tickets",
  "activity",
  "clock",
];

/**
 * Determines the primary scalar scope from a collection of discrete scopes based on canonical priority.
 */
export function derivePrimaryScope(
  scopes?: Iterable<ProtocolSyncScope> | readonly ProtocolSyncScope[]
): ProtocolSyncScope {
  if (!scopes) return "all";
  const arr = Array.isArray(scopes) ? scopes : Array.from(scopes);
  if (arr.length === 0) return "all";
  if (arr.length === 1) return arr[0];
  if (arr.includes("all")) return "all";
  for (const priorityScope of SCOPE_PRIORITY) {
    if (arr.includes(priorityScope)) return priorityScope;
  }
  return arr[0] ?? "all";
}

export interface ProtocolSyncDetail {
  scope: ProtocolSyncScope;
  scopes?: ProtocolSyncScope[];
  poolId?: number;
  poolIds?: number[];
  reason?: string;
  timestamp: number;
}

export function normalizeProtocolSyncDetail(
  scope: ProtocolSyncScope = "all",
  context?: {
    scopes?: readonly ProtocolSyncScope[];
    poolId?: number;
    poolIds?: readonly number[];
    reason?: string;
  }
): ProtocolSyncDetail {
  const scopes = context?.scopes ? Array.from(context.scopes) : [scope];
  const primaryScope = derivePrimaryScope(scopes);

  let poolIds: number[] | undefined;
  if (context?.poolIds && context.poolIds.length > 0) {
    poolIds = Array.from(context.poolIds);
  } else if (context?.poolId !== undefined) {
    poolIds = [context.poolId];
  }

  const primaryPoolId =
    poolIds && poolIds.length === 1 ? poolIds[0] : context?.poolId;

  return {
    scope: primaryScope,
    scopes,
    poolId: primaryPoolId,
    poolIds,
    reason: context?.reason,
    timestamp: Date.now(),
  };
}

export interface ProtocolSyncMessage {
  scope?: ProtocolSyncScope | string;
  scopes?: (ProtocolSyncScope | string)[];
  poolId?: number;
  reason?: string;
  timestamp?: number;
}

const PUSHER_CHANNEL_REGEX = /^[A-Za-z0-9_\-=@,.;]{1,200}$/;

/**
 * Returns the scoped Pusher channel name for a specific user address.
 */
export function getRealtimeUserChannel(userAddress: string): string {
  return `pb-user-${userAddress}`;
}

/**
 * Validates whether a channel string satisfies Pusher's allowed character set and length constraints.
 */
export function isValidPusherChannel(channel: unknown): channel is string {
  return (
    typeof channel === "string" &&
    channel.length > 0 &&
    channel.length <= 200 &&
    PUSHER_CHANNEL_REGEX.test(channel)
  );
}
