import test from "node:test";
import assert from "node:assert/strict";
import { bondsKeys } from "../query-keys";

test("query-keys: verifies hierarchical structure and leaf isolation", () => {
  const poolId = 1;
  const poolRoot = bondsKeys.poolRoot(poolId);
  const poolState = bondsKeys.poolState(poolId);
  const draws = bondsKeys.draws(poolId);
  const activity = bondsKeys.activityFeed(poolId, "test-user");
  const userPos = bondsKeys.userPosition(poolId, "test-user");
  const prizeRoot = bondsKeys.userPrizeLedgerRoot(poolId, "test-user");
  const prizeLedger = bondsKeys.userPrizeLedger(poolId, "test-user", {
    page: 1,
    pageSize: 10,
    status: "all",
  });

  assert.deepEqual(poolRoot, ["yield-bonds", "pools", 1]);
  assert.deepEqual(poolState, ["yield-bonds", "pools", 1, "state"]);
  assert.deepEqual(draws, ["yield-bonds", "pools", 1, "draws"]);
  assert.deepEqual(activity, [
    "yield-bonds",
    "pools",
    1,
    "activity",
    { address: "test-user", type: "all", search: "" },
  ]);
  assert.deepEqual(userPos, [
    "yield-bonds",
    "pools",
    1,
    "users",
    "test-user",
    "position",
  ]);
  assert.deepEqual(prizeRoot, [
    "yield-bonds",
    "pools",
    1,
    "users",
    "test-user",
    "prizes",
    "ledger",
  ]);
  assert.deepEqual(prizeLedger, [
    "yield-bonds",
    "pools",
    1,
    "users",
    "test-user",
    "prizes",
    "ledger",
    { page: 1, pageSize: 10, status: "all" },
  ]);

  // Leaf isolation check: poolState starts with poolRoot, but has distinct leaf element
  assert.equal(poolState.length, poolRoot.length + 1);
  assert.equal(poolState[poolState.length - 1], "state");
  assert.notEqual(poolState[poolState.length - 1], draws[draws.length - 1]);
});
