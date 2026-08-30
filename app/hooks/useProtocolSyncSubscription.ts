"use client";

import { useEffect, useRef } from "react";
import {
  subscribeProtocolUpdate,
  ProtocolSyncScope,
  ProtocolSyncDetail,
} from "../lib/protocol-sync-bus";

export interface UseProtocolSyncSubscriptionOptions {
  scopes?: ProtocolSyncScope[];
  debounceMs?: number;
  listenToWindowFocus?: boolean; // Deprecated: Kept for backwards compatibility
}

/**
 * Custom React hook that subscribes to the protocol synchronization bus.
 * Automatically executes the given `onSync` callback when a matching scoped event fires.
 *
 * @param onSync - Callback to execute upon synchronization trigger.
 * @param options - Subscription filtering options (scopes, debounce delay).
 */
export function useProtocolSyncSubscription(
  onSync: (detail?: ProtocolSyncDetail) => void | Promise<void>,
  options: UseProtocolSyncSubscriptionOptions = {}
): void {
  const { scopes, debounceMs = 150 } = options;
  const onSyncRef = useRef(onSync);
  const timerRef = useRef<NodeJS.Timeout | number | null>(null);

  useEffect(() => {
    onSyncRef.current = onSync;
  });

  useEffect(() => {
    const triggerDebounced = (detail?: ProtocolSyncDetail) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        onSyncRef.current(detail);
      }, debounceMs);
    };

    const unsubscribe = subscribeProtocolUpdate((detail) => {
      if (
        !scopes ||
        scopes.length === 0 ||
        detail.scope === "all" ||
        scopes.includes(detail.scope)
      ) {
        triggerDebounced(detail);
      }
    });

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      unsubscribe();
    };
  }, [scopes, debounceMs]);
}
