import test from "node:test";
import assert from "node:assert/strict";
import {
  notifyProtocolUpdate,
  subscribeProtocolUpdate,
  ProtocolSyncDetail,
} from "../../protocol-sync-bus";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
} from "../channels";

test("protocol-sync-bus dispatches scoped notifications cleanly", () => {
  const received: ProtocolSyncDetail[] = [];

  const unsubscribe = subscribeProtocolUpdate((detail) => {
    received.push(detail);
  });

  notifyProtocolUpdate("pool", { poolId: 1, reason: "push:global" });
  notifyProtocolUpdate("user", { reason: "push:deposit" });
  notifyProtocolUpdate("draws", { poolId: 2, reason: "push:harvest" });

  assert.strictEqual(received.length, 3);
  assert.strictEqual(received[0].scope, "pool");
  assert.strictEqual(received[0].poolId, 1);
  assert.strictEqual(received[1].scope, "user");
  assert.strictEqual(received[2].scope, "draws");
  assert.strictEqual(received[2].poolId, 2);

  unsubscribe();

  notifyProtocolUpdate("all", { reason: "after_unsub" });
  assert.strictEqual(received.length, 3); // No new events after unsubscribe
});

test("realtime channel constants adhere strictly to Pusher channel specifications", () => {
  // Pusher regex: /^[A-Za-z0-9_\-=@,.;]+$/ and length <= 200
  assert.strictEqual(REALTIME_GLOBAL_CHANNEL, "pb-global");
  assert.strictEqual(REALTIME_PROTOCOL_SYNC_EVENT, "protocol-sync");
  assert.strictEqual(isValidPusherChannel(REALTIME_GLOBAL_CHANNEL), true);

  // Valid Solana user public keys
  const sampleWallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
  const userChannel = getRealtimeUserChannel(sampleWallet);
  assert.strictEqual(userChannel, `pb-user-${sampleWallet}`);
  assert.strictEqual(isValidPusherChannel(userChannel), true);
  assert.ok(userChannel.length <= 200);

  // Verify rejection of legacy invalid channel formats with colons
  assert.strictEqual(isValidPusherChannel("pb:global"), false);
  assert.strictEqual(isValidPusherChannel(`pb:user-${sampleWallet}`), false);

  // Verify rejection of other invalid channel formats
  assert.strictEqual(isValidPusherChannel(""), false);
  assert.strictEqual(isValidPusherChannel("channel with spaces"), false);
  assert.strictEqual(isValidPusherChannel("channel/with/slashes"), false);
  assert.strictEqual(isValidPusherChannel("channel#hash"), false);
  assert.strictEqual(isValidPusherChannel("a".repeat(201)), false);
  assert.strictEqual(isValidPusherChannel(null), false);
  assert.strictEqual(isValidPusherChannel(undefined), false);
  assert.strictEqual(isValidPusherChannel(12345), false);
});
