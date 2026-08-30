"use client";

import PusherClient from "pusher-js";

let clientInstance: PusherClient | null = null;

export function getPusherClient(): PusherClient | null {
  if (typeof window === "undefined") return null;
  if (clientInstance) return clientInstance;

  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER || "us2";

  if (!key) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        "[Realtime Push] NEXT_PUBLIC_PUSHER_KEY is not defined in the client environment. Realtime push sync is disabled. Falling back to HTTP polling."
      );
    }
    return null;
  }

  if (process.env.NODE_ENV === "development") {
    try {
      PusherClient.logToConsole = true;
    } catch {
      // Ignore if logToConsole assignment is restricted in test environments
    }
  }

  clientInstance = new PusherClient(key, {
    cluster,
    forceTLS: true,
  });

  return clientInstance;
}

/**
 * Disconnects the active Pusher client instance and resets the singleton.
 * Useful for clean test resets and explicit connection teardown.
 */
export function disconnectPusherClient(): void {
  if (clientInstance) {
    try {
      clientInstance.disconnect();
    } catch {
      // Ignore disconnection errors during teardown
    }
    clientInstance = null;
  }
}
