export const PROTOCOL_SYNC_EVENT = "pb:protocol-sync";

export type ProtocolSyncScope =
  | "all"
  | "pool"
  | "user"
  | "draws"
  | "redemptions"
  | "clock";

export interface ProtocolSyncDetail {
  scope: ProtocolSyncScope;
  poolId?: number;
  reason?: string;
  timestamp: number;
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
 * @param context - Optional context metadata (e.g. poolId or trigger reason).
 */
export function notifyProtocolUpdate(
  scope: ProtocolSyncScope = "all",
  context?: { poolId?: number; reason?: string }
): void {
  const detail: ProtocolSyncDetail = {
    scope,
    poolId: context?.poolId,
    reason: context?.reason,
    timestamp: Date.now(),
  };

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
