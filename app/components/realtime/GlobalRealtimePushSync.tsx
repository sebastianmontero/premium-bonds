"use client";

import { useRealtimeSync } from "@/app/hooks/useRealtimeSync";

/**
 * Headless real-time push synchronizer.
 * Mounted once at the application root layout boundary.
 * Listens to Pusher WebSockets and invalidates matching TanStack Query keys.
 */
export function GlobalRealtimePushSync() {
  useRealtimeSync(1);
  return null;
}
