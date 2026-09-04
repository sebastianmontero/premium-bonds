"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { ActivityEntry } from "../types";
import type { StoredOptimisticEntry } from "./activity-helpers";

type Listener = () => void;
const listeners = new Set<Listener>();
const store: Record<string, StoredOptimisticEntry[]> = {};
const activeTimers = new Map<string, ReturnType<typeof setTimeout>>();

const EMPTY_ENTRIES: readonly StoredOptimisticEntry[] = Object.freeze([]);

function notify() {
  listeners.forEach((l) => l());
}

export function subscribeToOptimisticStore(
  onStoreChange: Listener
): () => void {
  listeners.add(onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
  };
}

export function getOptimisticServerSnapshot(): readonly StoredOptimisticEntry[] {
  return EMPTY_ENTRIES;
}

export function getOptimisticStoreSnapshot(
  userAddress?: string
): readonly StoredOptimisticEntry[] {
  if (!userAddress) return EMPTY_ENTRIES;
  const entries = store[userAddress];
  return entries && entries.length > 0 ? entries : EMPTY_ENTRIES;
}

export function addOptimisticActivity(
  userAddress: string,
  entry: ActivityEntry
): void {
  if (!entry.txSignature) return;
  const item: StoredOptimisticEntry = {
    ...entry,
    txSignature: entry.txSignature,
    createdAt: Date.now(),
  };
  const current = store[userAddress] || [];
  store[userAddress] = [
    item,
    ...current.filter((e) => e.txSignature !== entry.txSignature),
  ];
  notify();

  // Active eviction timer (120s TTL)
  const timerKey = `${userAddress}:${entry.txSignature}`;
  if (activeTimers.has(timerKey)) clearTimeout(activeTimers.get(timerKey)!);
  const timer = setTimeout(() => {
    removeOptimisticActivity(userAddress, entry.txSignature!);
  }, 120_000);
  if (typeof timer === "object" && timer !== null && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
  activeTimers.set(timerKey, timer);
}

export function removeOptimisticActivity(
  userAddress: string,
  txSignature: string
): void {
  const current = store[userAddress];
  if (!current) return;
  const filtered = current.filter((e) => e.txSignature !== txSignature);
  if (filtered.length === current.length) {
    return;
  }
  if (filtered.length === 0) {
    delete store[userAddress];
  } else {
    store[userAddress] = filtered;
  }
  const timerKey = `${userAddress}:${txSignature}`;
  if (activeTimers.has(timerKey)) {
    clearTimeout(activeTimers.get(timerKey)!);
    activeTimers.delete(timerKey);
  }
  notify();
}

export function reconcileOptimisticActivities(
  userAddress: string,
  confirmedSignatures: Iterable<string>
): void {
  const current = store[userAddress];
  if (!current || current.length === 0) return;

  const confirmedSet =
    confirmedSignatures instanceof Set
      ? confirmedSignatures
      : new Set(confirmedSignatures);

  const remaining: StoredOptimisticEntry[] = [];
  let removedAny = false;

  for (const entry of current) {
    if (entry.txSignature && confirmedSet.has(entry.txSignature)) {
      removedAny = true;
      const timerKey = `${userAddress}:${entry.txSignature}`;
      const timer = activeTimers.get(timerKey);
      if (timer) {
        clearTimeout(timer);
        activeTimers.delete(timerKey);
      }
    } else {
      remaining.push(entry);
    }
  }

  if (!removedAny) return;

  if (remaining.length === 0) {
    delete store[userAddress];
  } else {
    store[userAddress] = remaining;
  }
  notify();
}

export function clearOptimisticActivitiesForUser(userAddress: string): void {
  delete store[userAddress];
  const prefix = `${userAddress}:`;
  for (const [key, timer] of activeTimers.entries()) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      activeTimers.delete(key);
    }
  }
  notify();
}

export function _resetOptimisticStoreForTesting(): void {
  for (const timer of activeTimers.values()) {
    clearTimeout(timer);
  }
  activeTimers.clear();
  for (const key of Object.keys(store)) {
    delete store[key];
  }
  listeners.clear();
}

export function useLocalActivity(
  userAddress?: string
): readonly StoredOptimisticEntry[] {
  const getSnapshot = useCallback(
    () => getOptimisticStoreSnapshot(userAddress),
    [userAddress]
  );

  return useSyncExternalStore(
    subscribeToOptimisticStore,
    getSnapshot,
    getOptimisticServerSnapshot
  );
}
