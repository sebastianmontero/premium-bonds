/**
 * Canonical channel and event names for Pusher realtime synchronization.
 * Pusher enforces channel names matching /^[A-Za-z0-9_\-=@,.;]+$/ with length <= 200.
 */

export const REALTIME_GLOBAL_CHANNEL = "pb-global";
export const REALTIME_PROTOCOL_SYNC_EVENT = "protocol-sync";

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
