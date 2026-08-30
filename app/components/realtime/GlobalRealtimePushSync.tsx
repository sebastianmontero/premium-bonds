"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useProtocolPushSync } from "@/app/hooks/useProtocolPushSync";

/**
 * Headless real-time push synchronizer.
 * Mounted once at the application root layout boundary.
 * Maintains an active Pusher WebSocket connection and dispatches incoming
 * realtime events into the protocol sync bus without initiating any RPC calls.
 */
export function GlobalRealtimePushSync() {
  const { wallet } = useWalletConnection();
  const address = wallet?.account.address.toString();
  useProtocolPushSync(address);

  return null;
}
