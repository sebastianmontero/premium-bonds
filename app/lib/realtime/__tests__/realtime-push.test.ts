import test from "node:test";
import assert from "node:assert/strict";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
  derivePrimaryScope,
  normalizeProtocolSyncDetail,
} from "../channels";

test("derivePrimaryScope deterministically resolves primary scalar scope according to priority", () => {
  // Empty or undefined
  assert.strictEqual(derivePrimaryScope(undefined), "all");
  assert.strictEqual(derivePrimaryScope([]), "all");

  // Single scope
  assert.strictEqual(derivePrimaryScope(["pool"]), "pool");
  assert.strictEqual(derivePrimaryScope(["draws"]), "draws");
  assert.strictEqual(derivePrimaryScope(["user"]), "user");

  // "all" takes precedence
  assert.strictEqual(derivePrimaryScope(["pool", "all"]), "all");
  assert.strictEqual(derivePrimaryScope(["user", "draws", "all"]), "all");

  // Priority order: all > draws > pool > user > redemptions > clock
  assert.strictEqual(derivePrimaryScope(["pool", "draws"]), "draws");
  assert.strictEqual(derivePrimaryScope(["user", "pool"]), "pool");
  assert.strictEqual(derivePrimaryScope(["redemptions", "user"]), "user");
  assert.strictEqual(
    derivePrimaryScope(["clock", "redemptions"]),
    "redemptions"
  );
});

test("normalizeProtocolSyncDetail constructs synchronized scalar and vector fields", () => {
  // 1. Default invocation
  const def = normalizeProtocolSyncDetail();
  assert.strictEqual(def.scope, "all");
  assert.deepStrictEqual(def.scopes, ["all"]);
  assert.strictEqual(def.poolId, undefined);
  assert.strictEqual(def.poolIds, undefined);

  // 2. Single poolId and scalar scope
  const single = normalizeProtocolSyncDetail("pool", {
    poolId: 1,
    reason: "test",
  });
  assert.strictEqual(single.scope, "pool");
  assert.deepStrictEqual(single.scopes, ["pool"]);
  assert.strictEqual(single.poolId, 1);
  assert.deepStrictEqual(single.poolIds, [1]);
  assert.strictEqual(single.reason, "test");

  // 3. Multi-scope vector and multi-pool vector
  const multi = normalizeProtocolSyncDetail("all", {
    scopes: ["draws", "pool", "user"],
    poolIds: [1, 2],
    reason: "multi_crank",
  });
  assert.strictEqual(multi.scope, "draws");
  assert.deepStrictEqual(multi.scopes, ["draws", "pool", "user"]);
  assert.strictEqual(multi.poolId, undefined);
  assert.deepStrictEqual(multi.poolIds, [1, 2]);
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

test("getPusherClient and disconnectPusherClient execute safely in node/SSR environments", async () => {
  const { getPusherClient, disconnectPusherClient } = await import("../client");

  // In Node/SSR environment, getPusherClient safely returns null without crashing
  assert.strictEqual(getPusherClient(), null);

  // disconnectPusherClient can be invoked idempotently without error
  assert.doesNotThrow(() => {
    disconnectPusherClient();
  });
});
