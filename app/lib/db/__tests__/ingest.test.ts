import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeForJsonb } from "../ingest";
import { resolveEventMetadata, ParsedProgramEvent } from "../../anchor-events";

test("sanitizeForJsonb converts BigInts to string recursively", () => {
  const input = {
    amount: 1000000n,
    nested: {
      fee: 250n,
      items: [10n, 20n, { count: 50n }],
    },
    normalNumber: 42,
    str: "hello",
  };

  const output = sanitizeForJsonb(input) as {
    amount: string;
    nested: { fee: string; items: unknown[] };
    normalNumber: number;
    str: string;
  };
  assert.strictEqual(output.amount, "1000000");
  assert.strictEqual(output.nested.fee, "250");
  assert.deepStrictEqual(output.nested.items, ["10", "20", { count: "50" }]);
  assert.strictEqual(output.normalNumber, 42);
  assert.strictEqual(output.str, "hello");
});

test("resolveEventMetadata accurately resolves event scopes and user address across all 11 event types", () => {
  const buyEvent: ParsedProgramEvent = {
    type: "BondsPurchased",
    data: {
      user: "User111111111111111111111111111111111111111",
      poolId: 1,
      bonds: 10,
      amount: 50000000n,
    },
  };
  const buyMeta = resolveEventMetadata(buyEvent);
  assert.strictEqual(buyMeta.scope, "pool");
  assert.deepStrictEqual(buyMeta.scopes, ["pool", "user"]);
  assert.strictEqual(buyMeta.poolId, 1);
  assert.strictEqual(
    buyMeta.userAddress,
    "User111111111111111111111111111111111111111"
  );

  const sellEvent: ParsedProgramEvent = {
    type: "BondsSold",
    data: {
      user: "User111111111111111111111111111111111111111",
      poolId: 1,
      bonds: 5,
      principal: 25000000n,
      redemptionId: 100n,
    },
  };
  const sellMeta = resolveEventMetadata(sellEvent);
  assert.strictEqual(sellMeta.scope, "pool");
  assert.deepStrictEqual(sellMeta.scopes, ["pool", "user", "redemptions"]);
  assert.strictEqual(sellMeta.poolId, 1);
  assert.strictEqual(
    sellMeta.userAddress,
    "User111111111111111111111111111111111111111"
  );

  const reinvestEvent: ParsedProgramEvent = {
    type: "WinningsReinvested",
    data: {
      winner: "Winner1111111111111111111111111111111111111",
      poolId: 1,
      cycleId: 3,
      bondsBought: 2,
      amountReinvested: 10000000n,
    },
  };
  const reinvestMeta = resolveEventMetadata(reinvestEvent);
  assert.strictEqual(reinvestMeta.scope, "draws");
  assert.deepStrictEqual(reinvestMeta.scopes, ["draws", "user", "pool"]);
  assert.strictEqual(reinvestMeta.poolId, 1);
  assert.strictEqual(
    reinvestMeta.userAddress,
    "Winner1111111111111111111111111111111111111"
  );

  const winClaimEvent: ParsedProgramEvent = {
    type: "WinningsClaimed",
    data: {
      user: "User111111111111111111111111111111111111111",
      poolId: 1,
      amount: 15000000n,
      redemptionId: 101n,
    },
  };
  const winClaimMeta = resolveEventMetadata(winClaimEvent);
  assert.strictEqual(winClaimMeta.scope, "draws");
  assert.deepStrictEqual(winClaimMeta.scopes, [
    "draws",
    "user",
    "pool",
    "redemptions",
  ]);

  const redClaimEvent: ParsedProgramEvent = {
    type: "RedemptionClaimed",
    data: {
      user: "User111111111111111111111111111111111111111",
      poolId: 1,
      amount: 25000000n,
      redemptionId: 100n,
    },
  };
  const redClaimMeta = resolveEventMetadata(redClaimEvent);
  assert.strictEqual(redClaimMeta.scope, "pool");
  assert.deepStrictEqual(redClaimMeta.scopes, ["pool", "user", "redemptions"]);

  const harvestEvent: ParsedProgramEvent = {
    type: "YieldHarvested",
    data: {
      poolId: 2,
      cycleId: 5,
      rawYield: 10000000n,
      fee: 250000n,
      prizePot: 9750000n,
      lockedTicketCount: 500,
      randomnessAccount: "Rand111111111111111111111111111111111111111",
    },
  };
  const harvestMeta = resolveEventMetadata(harvestEvent);
  assert.strictEqual(harvestMeta.scope, "draws");
  assert.deepStrictEqual(harvestMeta.scopes, ["draws", "pool", "clock"]);
  assert.strictEqual(harvestMeta.poolId, 2);

  const drawEvent: ParsedProgramEvent = {
    type: "DrawCompleted",
    data: {
      poolId: 1,
      cycleId: 4,
      prizePot: 250000000n,
      winnersCount: 3,
    },
  };
  const drawMeta = resolveEventMetadata(drawEvent);
  assert.strictEqual(drawMeta.scope, "draws");
  assert.deepStrictEqual(drawMeta.scopes, ["draws", "pool"]);
  assert.strictEqual(drawMeta.poolId, 1);
  assert.strictEqual(drawMeta.userAddress, undefined);

  const forceUnlockEvent: ParsedProgramEvent = {
    type: "DrawForceUnlocked",
    data: {
      poolId: 1,
      cycleId: 4,
      admin: "Admin11111111111111111111111111111111111111",
      prizePot: 250000000n,
      cycleFeeCollected: 5000000n,
    },
  };
  const forceUnlockMeta = resolveEventMetadata(forceUnlockEvent);
  assert.strictEqual(forceUnlockMeta.scope, "draws");
  assert.deepStrictEqual(forceUnlockMeta.scopes, ["draws", "pool"]);

  const voidEvent: ParsedProgramEvent = {
    type: "DrawVoided",
    data: {
      poolId: 1,
      cycleId: 4,
      admin: "Admin11111111111111111111111111111111111111",
      prizesReversed: 250000000n,
      feesReversed: 5000000n,
    },
  };
  const voidMeta = resolveEventMetadata(voidEvent);
  assert.strictEqual(voidMeta.scope, "draws");
  assert.deepStrictEqual(voidMeta.scopes, ["draws", "pool"]);

  const skipEvent: ParsedProgramEvent = {
    type: "DrawSkipped",
    data: {
      poolId: 1,
      cycleId: 6,
      rawYield: 100n,
      threshold: 1000000n,
    },
  };
  const skipMeta = resolveEventMetadata(skipEvent);
  assert.strictEqual(skipMeta.scope, "draws");
  assert.deepStrictEqual(skipMeta.scopes, ["draws", "pool", "clock"]);
  assert.strictEqual(skipMeta.poolId, 1);

  const prepEvent: ParsedProgramEvent = {
    type: "DrawPreparationProgress",
    data: {
      poolId: 1,
      cycleId: 7,
      batchStart: 0,
      batchEnd: 50,
      userCount: 50,
      isComplete: false,
    },
  };
  const prepMeta = resolveEventMetadata(prepEvent);
  assert.strictEqual(prepMeta.scope, "draws");
  assert.deepStrictEqual(prepMeta.scopes, ["draws"]);
});
