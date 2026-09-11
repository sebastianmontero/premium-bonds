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

export const USER_SPECIFIC_SCOPES: ReadonlySet<ProtocolSyncScope> = new Set([
  "user",
  "tickets",
  "redemptions",
  "activity",
]);

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
  poolIds?: readonly number[];
  reason?: string;
  timestamp?: number;
}

export interface RealtimeBroadcastItem {
  scope?: ProtocolSyncScope;
  scopes?: readonly ProtocolSyncScope[];
  poolId?: number;
  userAddress?: string;
  txSignature?: string;
  reason?: string;
}

export interface UserInvalidationPartition {
  readonly scopes: Set<ProtocolSyncScope>;
  readonly poolIds: Set<number>;
}

export interface PartitionedInvalidations {
  readonly globalScopes: Set<ProtocolSyncScope>;
  readonly globalPoolIds: Set<number>;
  readonly userPartitions: Map<string, UserInvalidationPartition>;
}

/**
 * Pure helper to partition a batch of broadcast items into global scopes and
 * per-user targeted scopes.
 *
 * Invariant:
 * - Targeted user events route USER_SPECIFIC_SCOPES to the user channel and
 *   non-user scopes to the global channel.
 * - Protocol lifecycle events (no userAddress) route ALL scopes (including "tickets")
 *   directly to the global channel.
 * - Only records globalPoolIds when an event contributes to globalScopes.
 * - Lazily instantiates userPartitions only when user-specific scopes are present.
 */
export function partitionBroadcastInvalidations(
  events: readonly RealtimeBroadcastItem[]
): PartitionedInvalidations {
  const globalScopes = new Set<ProtocolSyncScope>();
  const globalPoolIds = new Set<number>();
  const userPartitions = new Map<string, UserInvalidationPartition>();

  for (const evt of events) {
    const evtScopes = evt.scopes ?? (evt.scope ? [evt.scope] : ["all"]);
    let contributesToGlobal = false;

    if (evt.userAddress) {
      for (const s of evtScopes) {
        if (USER_SPECIFIC_SCOPES.has(s)) {
          let userPart = userPartitions.get(evt.userAddress);
          if (!userPart) {
            userPart = { scopes: new Set(), poolIds: new Set() };
            userPartitions.set(evt.userAddress, userPart);
          }
          userPart.scopes.add(s);
          if (evt.poolId !== undefined) {
            userPart.poolIds.add(evt.poolId);
          }
        } else {
          globalScopes.add(s);
          contributesToGlobal = true;
        }
      }
    } else {
      // Protocol-level lifecycle event without userAddress: all scopes broadcast globally
      for (const s of evtScopes) {
        globalScopes.add(s);
      }
      contributesToGlobal = true;
    }

    if (contributesToGlobal && evt.poolId !== undefined) {
      globalPoolIds.add(evt.poolId);
    }
  }

  return { globalScopes, globalPoolIds, userPartitions };
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
