export const PROTOCOL_SYNC_EVENT = "pb:protocol-sync";

export type ProtocolSyncScope =
  | "all"
  | "pool"
  | "user"
  | "draws"
  | "redemptions"
  | "clock";

const SCOPE_PRIORITY: readonly ProtocolSyncScope[] = [
  "all",
  "draws",
  "pool",
  "user",
  "redemptions",
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

export type ProtocolSyncListener = (detail: ProtocolSyncDetail) => void;

interface ProtocolBusState {
  listeners: Set<ProtocolSyncListener>;
}

const busState: ProtocolBusState = {
  listeners: new Set(),
};

/**
 * Dispatches a protocol synchronization event to all registered in-memory listeners
 * and broadcasts a DOM CustomEvent on the window object (if running in a browser).
 *
 * @param scope - The domain scope to invalidate and refresh (default: "all").
 * @param context - Optional context metadata (e.g. poolId, poolIds, scopes, or trigger reason).
 */
export function notifyProtocolUpdate(
  scope: ProtocolSyncScope = "all",
  context?: {
    scopes?: readonly ProtocolSyncScope[];
    poolId?: number;
    poolIds?: readonly number[];
    reason?: string;
  }
): void {
  const detail = normalizeProtocolSyncDetail(scope, context);

  // 1. In-memory listeners (SSR safe, fast execution)
  busState.listeners.forEach((listener) => {
    try {
      listener(detail);
    } catch (err) {
      console.error("Error in protocol sync listener:", err);
    }
  });

  // 2. Window DOM custom event broadcast
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(new CustomEvent(PROTOCOL_SYNC_EVENT, { detail }));
    } catch {
      // Non-critical fallback if CustomEvent is unsupported
    }
  }
}

/**
 * Subscribes a listener callback directly to the protocol bus singleton.
 * Returns an unsubscribe cleanup function.
 */
export function subscribeProtocolUpdate(
  listener: ProtocolSyncListener
): () => void {
  busState.listeners.add(listener);
  return () => {
    busState.listeners.delete(listener);
  };
}
