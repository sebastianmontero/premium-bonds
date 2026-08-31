"use client";

import { useEffect, useRef } from "react";
import {
  subscribeProtocolUpdate,
  ProtocolSyncScope,
  ProtocolSyncDetail,
  derivePrimaryScope,
} from "../lib/protocol-sync-bus";

export function isPoolMatch(
  targetPoolId: number | undefined,
  detail: ProtocolSyncDetail
): boolean {
  if (targetPoolId === undefined) return true;
  if (detail.poolIds && detail.poolIds.length > 0) {
    return detail.poolIds.includes(targetPoolId);
  }
  if (detail.poolId !== undefined) {
    return detail.poolId === targetPoolId;
  }
  return true;
}

export function isScopeMatch(
  activeScopes: readonly ProtocolSyncScope[] | undefined,
  detail: ProtocolSyncDetail
): boolean {
  if (!activeScopes || activeScopes.length === 0) return true;
  if (activeScopes.includes("all")) return true;
  const detailScopes = detail.scopes ?? [detail.scope];
  if (detailScopes.includes("all")) return true;
  return detailScopes.some((s) => activeScopes.includes(s));
}

export interface UseProtocolSyncSubscriptionOptions {
  scopes?: readonly ProtocolSyncScope[];
  poolId?: number;
  debounceMs?: number;
}

/**
 * Custom React hook that subscribes to the protocol synchronization bus.
 * Automatically executes the given `onSync` callback when a matching scoped event fires.
 *
 * @param onSync - Callback to execute upon synchronization trigger.
 * @param options - Subscription filtering options (scopes, poolId, debounce delay).
 */
export function useProtocolSyncSubscription(
  onSync: (detail?: ProtocolSyncDetail) => void | Promise<void>,
  options: UseProtocolSyncSubscriptionOptions = {}
): void {
  const { scopes, poolId, debounceMs = 150 } = options;
  const onSyncRef = useRef(onSync);
  const scopesRef = useRef(scopes);
  const poolIdRef = useRef(poolId);
  const timerRef = useRef<NodeJS.Timeout | number | null>(null);
  const accumulatedScopesRef = useRef<Set<ProtocolSyncScope>>(new Set());
  const accumulatedPoolIdsRef = useRef<Set<number>>(new Set());
  const lastReasonRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    onSyncRef.current = onSync;
    if (scopesRef.current !== scopes || poolIdRef.current !== poolId) {
      accumulatedScopesRef.current.clear();
      accumulatedPoolIdsRef.current.clear();
    }
    scopesRef.current = scopes;
    poolIdRef.current = poolId;
  });

  useEffect(() => {
    const triggerDebounced = (detail?: ProtocolSyncDetail) => {
      if (detail) {
        lastReasonRef.current = detail.reason;
        if (detail.scopes) {
          detail.scopes.forEach((s) => accumulatedScopesRef.current.add(s));
        }
        if (detail.scope) {
          accumulatedScopesRef.current.add(detail.scope);
        }
        if (detail.poolIds) {
          detail.poolIds.forEach((p) => accumulatedPoolIdsRef.current.add(p));
        }
        if (detail.poolId !== undefined) {
          accumulatedPoolIdsRef.current.add(detail.poolId);
        }
      }

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(async () => {
        const accumulatedScopes = Array.from(accumulatedScopesRef.current);
        const accumulatedPoolIds = Array.from(accumulatedPoolIdsRef.current);
        accumulatedScopesRef.current.clear();
        accumulatedPoolIdsRef.current.clear();

        const mergedDetail: ProtocolSyncDetail = {
          scope: derivePrimaryScope(accumulatedScopes),
          scopes: accumulatedScopes,
          poolId:
            accumulatedPoolIds.length === 1 ? accumulatedPoolIds[0] : undefined,
          poolIds:
            accumulatedPoolIds.length > 0 ? accumulatedPoolIds : undefined,
          reason: lastReasonRef.current,
          timestamp: Date.now(),
        };

        try {
          await onSyncRef.current(mergedDetail);
        } catch (err) {
          console.error("Protocol sync subscriber error:", err);
        }
      }, debounceMs);
    };

    const unsubscribe = subscribeProtocolUpdate((detail) => {
      const activeScopes = scopesRef.current;
      const targetPoolId = poolIdRef.current;

      if (
        isPoolMatch(targetPoolId, detail) &&
        isScopeMatch(activeScopes, detail)
      ) {
        triggerDebounced(detail);
      }
    });

    const accumulatedScopes = accumulatedScopesRef.current;
    const accumulatedPoolIds = accumulatedPoolIdsRef.current;

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      accumulatedScopes.clear();
      accumulatedPoolIds.clear();
      unsubscribe();
    };
  }, [debounceMs]);
}
