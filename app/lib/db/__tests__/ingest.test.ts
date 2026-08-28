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

test("resolveEventMetadata accurately resolves event scope and user address", () => {
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
  assert.strictEqual(buyMeta.scope, "user");
  assert.strictEqual(buyMeta.poolId, 1);
  assert.strictEqual(
    buyMeta.userAddress,
    "User111111111111111111111111111111111111111"
  );

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
  assert.strictEqual(drawMeta.poolId, 1);
  assert.strictEqual(drawMeta.userAddress, undefined);

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
  assert.strictEqual(harvestMeta.poolId, 2);

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
  assert.strictEqual(skipMeta.poolId, 1);
});
