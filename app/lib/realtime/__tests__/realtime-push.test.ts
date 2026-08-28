import test from "node:test";
import assert from "node:assert/strict";
import {
  notifyProtocolUpdate,
  subscribeProtocolUpdate,
  ProtocolSyncDetail,
} from "../../protocol-sync-bus";

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
