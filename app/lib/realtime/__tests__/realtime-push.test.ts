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

test("USER_SPECIFIC_SCOPES contains all user-targeted scopes and excludes protocol-wide scopes", async () => {
  const { USER_SPECIFIC_SCOPES } = await import("../channels");
  assert.ok(USER_SPECIFIC_SCOPES.has("user"));
  assert.ok(USER_SPECIFIC_SCOPES.has("tickets"));
  assert.ok(USER_SPECIFIC_SCOPES.has("redemptions"));
  assert.ok(USER_SPECIFIC_SCOPES.has("activity"));
  assert.strictEqual(USER_SPECIFIC_SCOPES.has("pool"), false);
  assert.strictEqual(USER_SPECIFIC_SCOPES.has("draws"), false);
  assert.strictEqual(USER_SPECIFIC_SCOPES.has("clock"), false);
  assert.strictEqual(USER_SPECIFIC_SCOPES.has("all"), false);
});

test("partitionBroadcastInvalidations isolates user scopes, prevents leaky pool IDs, and preserves tickets on protocol lifecycle events", async () => {
  const { partitionBroadcastInvalidations } = await import("../channels");

  // 1. Protocol lifecycle event (DrawSkipped) without userAddress:
  // All declared scopes (including "tickets") MUST be preserved on the global channel
  const skippedDrawBatch = [
    {
      scopes: ["draws", "pool", "clock", "tickets"] as const,
      poolId: 1,
      reason: "webhook:DrawSkipped",
    },
  ];
  const skippedResult = partitionBroadcastInvalidations(skippedDrawBatch);
  assert.strictEqual(skippedResult.userPartitions.size, 0);
  assert.ok(skippedResult.globalScopes.has("tickets"));
  assert.ok(skippedResult.globalScopes.has("draws"));
  assert.ok(skippedResult.globalScopes.has("pool"));
  assert.ok(skippedResult.globalScopes.has("clock"));
  assert.deepStrictEqual(Array.from(skippedResult.globalPoolIds), [1]);

  // 2. Targeted user deposit event:
  // User-specific scopes ("tickets", "user") route to userPartition, "pool" routes to globalScopes.
  // Pool ID is recorded on user partition and on globalPoolIds (since "pool" contributes to global).
  const depositBatch = [
    {
      userAddress: "UserA",
      scopes: ["tickets", "user", "pool"] as const,
      poolId: 1,
      reason: "webhook:BondsPurchased",
    },
  ];
  const depositResult = partitionBroadcastInvalidations(depositBatch);
  assert.strictEqual(depositResult.globalScopes.has("tickets"), false);
  assert.strictEqual(depositResult.globalScopes.has("user"), false);
  assert.ok(depositResult.globalScopes.has("pool"));
  assert.deepStrictEqual(Array.from(depositResult.globalPoolIds), [1]);

  const userAPartition = depositResult.userPartitions.get("UserA");
  assert.ok(userAPartition);
  assert.ok(userAPartition.scopes.has("tickets"));
  assert.ok(userAPartition.scopes.has("user"));
  assert.strictEqual(userAPartition.scopes.has("pool"), false);
  assert.deepStrictEqual(Array.from(userAPartition.poolIds), [1]);

  // 3. User event with ONLY user-specific scopes on Pool 1 mixed with Global event on Pool 2:
  // Pool 1 must NOT leak into globalPoolIds!
  const userOnlyBatch = [
    {
      userAddress: "UserB",
      scopes: ["tickets"] as const,
      poolId: 1,
      reason: "webhook:UserTicketsOnly",
    },
    {
      scopes: ["draws"] as const,
      poolId: 2,
      reason: "webhook:DrawCompleted",
    },
  ];
  const userOnlyResult = partitionBroadcastInvalidations(userOnlyBatch);
  assert.deepStrictEqual(Array.from(userOnlyResult.globalPoolIds), [2]);
  assert.deepStrictEqual(Array.from(userOnlyResult.globalScopes), ["draws"]);

  const userB = userOnlyResult.userPartitions.get("UserB");
  assert.ok(userB);
  assert.deepStrictEqual(Array.from(userB.scopes), ["tickets"]);
  assert.deepStrictEqual(Array.from(userB.poolIds), [1]);

  // 4. User event with ONLY global scopes (e.g. "pool") must NOT create a zombie user partition
  const zombieCheckResult = partitionBroadcastInvalidations([
    { userAddress: "UserC", scopes: ["pool"] as const, poolId: 1 },
  ]);
  assert.strictEqual(zombieCheckResult.userPartitions.has("UserC"), false);
  assert.ok(zombieCheckResult.globalScopes.has("pool"));
  assert.deepStrictEqual(Array.from(zombieCheckResult.globalPoolIds), [1]);

  // 5. Mixed batch: user deposit + skipped draw
  const mixedBatch = [
    {
      userAddress: "UserA",
      scopes: ["tickets", "user", "pool"] as const,
      poolId: 1,
    },
    {
      scopes: ["draws", "pool", "clock", "tickets"] as const,
      poolId: 1,
    },
  ];
  const mixedResult = partitionBroadcastInvalidations(mixedBatch);
  // Global channel contains "tickets" from the DrawSkipped lifecycle event
  assert.ok(mixedResult.globalScopes.has("tickets"));
  assert.ok(mixedResult.globalScopes.has("draws"));
  assert.ok(mixedResult.globalScopes.has("pool"));
  assert.ok(mixedResult.globalScopes.has("clock"));
  // UserA partition contains targeted "tickets" and "user"
  const mixedUserA = mixedResult.userPartitions.get("UserA");
  assert.ok(mixedUserA);
  assert.ok(mixedUserA.scopes.has("tickets"));
  assert.ok(mixedUserA.scopes.has("user"));
});

test("resolveInvalidationQueryKeys accurately resolves query keys and enforces multi-pool isolation", async () => {
  const { resolveInvalidationQueryKeys } = await import(
    "../../../hooks/useRealtimeSync"
  );
  const { bondsKeys } = await import("../../query-keys");

  const sampleWallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  // 1. DrawSkipped global message with tickets scope
  const skippedMsg = {
    scope: "draws",
    scopes: ["draws", "pool", "clock", "tickets"],
    poolId: 1,
    timestamp: Date.now(),
  };
  const keysForSkipped = resolveInvalidationQueryKeys(
    skippedMsg,
    1,
    sampleWallet
  );
  const keyStrings = keysForSkipped.map((k) => JSON.stringify(k));

  // Must invalidate poolState, draws, prizes, userPrizeHistory, and userPosition
  assert.ok(keyStrings.includes(JSON.stringify(bondsKeys.poolState(1))));
  assert.ok(keyStrings.includes(JSON.stringify(bondsKeys.draws(1))));
  assert.ok(keyStrings.includes(JSON.stringify(bondsKeys.prizes(1))));
  assert.ok(
    keyStrings.includes(
      JSON.stringify(bondsKeys.userPosition(1, sampleWallet))
    )
  );
  assert.ok(
    keyStrings.includes(
      JSON.stringify(bondsKeys.userPrizeHistory(1, sampleWallet))
    )
  );

  // 2. Multi-pool vector filtering: message targeting poolIds [2, 3] ignored by pool 1 client
  const multiPoolMsg = {
    scope: "draws",
    scopes: ["draws", "pool"],
    poolIds: [2, 3],
    timestamp: Date.now(),
  };
  const keysForPool1 = resolveInvalidationQueryKeys(
    multiPoolMsg,
    1,
    sampleWallet
  );
  assert.deepStrictEqual(keysForPool1, []);

  // Same message accepted by pool 2 client
  const keysForPool2 = resolveInvalidationQueryKeys(
    multiPoolMsg,
    2,
    sampleWallet
  );
  assert.ok(keysForPool2.length > 0);

  // 3. Scalar poolId filtering: message targeting pool 2 ignored by pool 1 client
  const singlePool2Msg = {
    scope: "draws",
    scopes: ["draws", "pool"],
    poolId: 2,
    timestamp: Date.now(),
  };
  assert.deepStrictEqual(
    resolveInvalidationQueryKeys(singlePool2Msg, 1, sampleWallet),
    []
  );

  // 4. Anonymous user (no connected wallet) does not generate user-specific keys
  const anonKeys = resolveInvalidationQueryKeys(skippedMsg, 1, undefined);
  const anonKeyStrings = anonKeys.map((k) => JSON.stringify(k));
  assert.ok(anonKeyStrings.includes(JSON.stringify(bondsKeys.poolState(1))));
  assert.ok(
    !anonKeyStrings.some((k) => k.includes("user-pos")),
    "Should not include user position key for anonymous user"
  );
});

test("Full Invalidation Pipeline: DrawSkipped event deterministically produces userPosition query invalidation", async () => {
  const { partitionBroadcastInvalidations, derivePrimaryScope } = await import(
    "../channels"
  );
  const { resolveInvalidationQueryKeys } = await import(
    "../../../hooks/useRealtimeSync"
  );
  const { bondsKeys } = await import("../../query-keys");

  const sampleWallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

  // Step 1: Simulate Webhook receiving on-chain DrawSkipped event
  const webhookBatch = [
    {
      scope: "draws" as const,
      scopes: ["draws", "pool", "clock", "tickets"] as const,
      poolId: 1,
      reason: "webhook:DrawSkipped",
    },
  ];

  // Step 2: Server partitions broadcast items
  const { globalScopes, globalPoolIds } =
    partitionBroadcastInvalidations(webhookBatch);
  const globalScopesArray = Array.from(globalScopes);
  const globalPoolsArray = Array.from(globalPoolIds);

  const globalPayload = {
    scope: derivePrimaryScope(globalScopesArray),
    scopes: globalScopesArray,
    poolId: globalPoolsArray.length === 1 ? globalPoolsArray[0] : undefined,
    poolIds: globalPoolsArray.length > 0 ? globalPoolsArray : undefined,
    reason: "webhook:aggregated_1_events",
    timestamp: Date.now(),
  };

  // Step 3: Client useRealtimeSync receives globalPayload
  const generatedQueryKeys = resolveInvalidationQueryKeys(
    globalPayload,
    1,
    sampleWallet
  );
  const serializedKeys = new Set(
    generatedQueryKeys.map((k) => JSON.stringify(k))
  );

  // Step 4: Verify critical user position invalidation key is present
  const expectedUserPosKey = JSON.stringify(
    bondsKeys.userPosition(1, sampleWallet)
  );
  assert.ok(
    serializedKeys.has(expectedUserPosKey),
    "Pipeline must generate bondsKeys.userPosition so Hero and Pool cards update upon DrawSkipped"
  );
});


