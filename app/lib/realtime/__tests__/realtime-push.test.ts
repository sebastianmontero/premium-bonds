import test from "node:test";
import assert from "node:assert/strict";
import {
  notifyProtocolUpdate,
  subscribeProtocolUpdate,
  ProtocolSyncDetail,
  derivePrimaryScope,
  normalizeProtocolSyncDetail,
} from "../../protocol-sync-bus";
import {
  isPoolMatch,
  isScopeMatch,
} from "../../../hooks/useProtocolSyncSubscription";
import {
  REALTIME_GLOBAL_CHANNEL,
  REALTIME_PROTOCOL_SYNC_EVENT,
  getRealtimeUserChannel,
  isValidPusherChannel,
} from "../channels";
import { dispatchPushSync } from "../../../hooks/useProtocolPushSync";

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

test("isPoolMatch accurately filters single and multi-pool events", () => {
  // Untargeted subscriber matches everything
  assert.strictEqual(
    isPoolMatch(undefined, { scope: "all", timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isPoolMatch(undefined, { scope: "all", poolId: 1, timestamp: 0 }),
    true
  );

  // Targeted subscriber with single poolId event
  assert.strictEqual(
    isPoolMatch(1, { scope: "all", poolId: 1, timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isPoolMatch(1, { scope: "all", poolId: 2, timestamp: 0 }),
    false
  );

  // Targeted subscriber with multi poolIds event
  assert.strictEqual(
    isPoolMatch(1, { scope: "all", poolIds: [1, 2], timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isPoolMatch(2, { scope: "all", poolIds: [1, 2], timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isPoolMatch(3, { scope: "all", poolIds: [1, 2], timestamp: 0 }),
    false
  );

  // Event without pool restriction matches all subscribers
  assert.strictEqual(isPoolMatch(1, { scope: "all", timestamp: 0 }), true);
});

test("isScopeMatch accurately filters domain events with symmetric all matching", () => {
  // Empty activeScopes matches everything
  assert.strictEqual(
    isScopeMatch(undefined, { scope: "pool", timestamp: 0 }),
    true
  );
  assert.strictEqual(isScopeMatch([], { scope: "pool", timestamp: 0 }), true);

  // Subscriber listening to "all" matches everything
  assert.strictEqual(
    isScopeMatch(["all"], { scope: "pool", timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isScopeMatch(["all"], { scope: "draws", timestamp: 0 }),
    true
  );

  // Event with scope "all" matches all subscribers
  assert.strictEqual(
    isScopeMatch(["draws"], { scope: "all", timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isScopeMatch(["pool"], { scope: "all", timestamp: 0 }),
    true
  );

  // Event with "all" in scopes array matches all subscribers
  assert.strictEqual(
    isScopeMatch(["draws"], {
      scope: "pool",
      scopes: ["pool", "all"],
      timestamp: 0,
    }),
    true
  );

  // Discrete scope match
  assert.strictEqual(
    isScopeMatch(["draws"], { scope: "draws", timestamp: 0 }),
    true
  );
  assert.strictEqual(
    isScopeMatch(["draws"], { scope: "pool", timestamp: 0 }),
    false
  );

  // Vector overlap match
  assert.strictEqual(
    isScopeMatch(["draws"], {
      scope: "pool",
      scopes: ["pool", "draws"],
      timestamp: 0,
    }),
    true
  );
  assert.strictEqual(
    isScopeMatch(["user"], {
      scope: "draws",
      scopes: ["draws", "pool"],
      timestamp: 0,
    }),
    false
  );
});

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

test("getPusherClient and disconnectPusherClient execute safely in node/SSR environments", async () => {
  const { getPusherClient, disconnectPusherClient } = await import("../client");

  // In Node/SSR environment, getPusherClient safely returns null without crashing
  assert.strictEqual(getPusherClient(), null);

  // disconnectPusherClient can be invoked idempotently without error
  assert.doesNotThrow(() => {
    disconnectPusherClient();
  });
});

test("dispatchPushSync correctly adapts and dispatches global and user channel push notifications", () => {
  const dispatched: ProtocolSyncDetail[] = [];
  const unsubscribe = subscribeProtocolUpdate((detail) => {
    dispatched.push(detail);
  });

  try {
    // 1. Global channel push dispatch with full payload
    dispatchPushSync(
      {
        scope: "pool",
        scopes: ["pool", "draws"],
        poolId: 1,
        poolIds: [1, 2],
        reason: "yield_harvested",
      },
      "global"
    );

    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].scope, "draws"); // normalized primary scope
    assert.deepStrictEqual(dispatched[0].scopes, ["pool", "draws"]);
    assert.strictEqual(dispatched[0].poolId, 1);
    assert.deepStrictEqual(dispatched[0].poolIds, [1, 2]);
    assert.strictEqual(dispatched[0].reason, "push:global_yield_harvested");

    // 2. User channel push dispatch with user-scoped payload
    dispatchPushSync(
      {
        scope: "user",
        reason: "claim_settled",
      },
      "user"
    );

    assert.strictEqual(dispatched.length, 2);
    assert.strictEqual(dispatched[1].scope, "user");
    assert.deepStrictEqual(dispatched[1].scopes, ["user"]);
    assert.strictEqual(dispatched[1].reason, "push:user_claim_settled");

    // 3. Defensive fallback on missing reason and undefined payload
    dispatchPushSync(
      {
        scope: "draws",
      },
      "global"
    );

    assert.strictEqual(dispatched.length, 3);
    assert.strictEqual(dispatched[2].scope, "draws");
    assert.strictEqual(dispatched[2].reason, "push:global_");

    dispatchPushSync(undefined, "user");

    assert.strictEqual(dispatched.length, 4);
    assert.strictEqual(dispatched[3].scope, "all");
    assert.strictEqual(dispatched[3].reason, "push:user_");
  } finally {
    unsubscribe();
  }
});
