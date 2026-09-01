import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeForJsonb } from "../ingest";
import { resolveEventMetadata, ParsedProgramEvent } from "../../anchor-events";
import { address } from "@solana/kit";

const userAddr = address("11111111111111111111111111111111");
const randAddr = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

describe("Database Ingestion & Event Metadata Resolution", () => {
  it("should convert BigInts to string recursively in sanitizeForJsonb", () => {
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
    assert.strictEqual(output.amount, "1000000", "Top-level BigInt sanitized");
    assert.strictEqual(output.nested.fee, "250", "Nested BigInt sanitized");
    assert.deepStrictEqual(
      output.nested.items,
      ["10", "20", { count: "50" }],
      "Array BigInts sanitized"
    );
    assert.strictEqual(output.normalNumber, 42, "Regular numbers preserved");
    assert.strictEqual(output.str, "hello", "Strings preserved");
  });

  describe("Event Metadata Resolution per Event Type", () => {
    it("should resolve metadata for BondsPurchased", () => {
      const buyEvent: ParsedProgramEvent = {
        type: "BondsPurchased",
        data: {
          user: userAddr,
          poolId: 1,
          bonds: 10,
          amount: 50000000n,
        },
      };
      const meta = resolveEventMetadata(buyEvent);
      assert.strictEqual(meta.scope, "pool");
      assert.deepStrictEqual(meta.scopes, ["pool", "user"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for BondsSold", () => {
      const sellEvent: ParsedProgramEvent = {
        type: "BondsSold",
        data: {
          user: userAddr,
          poolId: 1,
          bonds: 5,
          principal: 25000000n,
          redemptionId: 100n,
        },
      };
      const meta = resolveEventMetadata(sellEvent);
      assert.strictEqual(meta.scope, "pool");
      assert.deepStrictEqual(meta.scopes, ["pool", "user", "redemptions"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for WinningsReinvested", () => {
      const reinvestEvent: ParsedProgramEvent = {
        type: "WinningsReinvested",
        data: {
          winner: userAddr,
          poolId: 1,
          cycleId: 3,
          bondsBought: 2,
          amountReinvested: 10000000n,
        },
      };
      const meta = resolveEventMetadata(reinvestEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "user", "pool"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for WinningsClaimed", () => {
      const winClaimEvent: ParsedProgramEvent = {
        type: "WinningsClaimed",
        data: {
          user: userAddr,
          poolId: 1,
          amount: 15000000n,
          redemptionId: 101n,
        },
      };
      const meta = resolveEventMetadata(winClaimEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, [
        "draws",
        "user",
        "pool",
        "redemptions",
      ]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for RedemptionClaimed", () => {
      const redClaimEvent: ParsedProgramEvent = {
        type: "RedemptionClaimed",
        data: {
          user: userAddr,
          poolId: 1,
          amount: 25000000n,
          redemptionId: 100n,
        },
      };
      const meta = resolveEventMetadata(redClaimEvent);
      assert.strictEqual(meta.scope, "pool");
      assert.deepStrictEqual(meta.scopes, ["pool", "user", "redemptions"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, userAddr.toString());
    });

    it("should resolve metadata for YieldHarvested", () => {
      const harvestEvent: ParsedProgramEvent = {
        type: "YieldHarvested",
        data: {
          poolId: 2,
          cycleId: 5,
          rawYield: 10000000n,
          fee: 250000n,
          prizePot: 9750000n,
          lockedTicketCount: 500,
          randomnessAccount: randAddr,
        },
      };
      const meta = resolveEventMetadata(harvestEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool", "clock"]);
      assert.strictEqual(meta.poolId, 2);
    });

    it("should resolve metadata for DrawCompleted", () => {
      const drawEvent: ParsedProgramEvent = {
        type: "DrawCompleted",
        data: {
          poolId: 1,
          cycleId: 4,
          prizePot: 250000000n,
          winnersCount: 3,
        },
      };
      const meta = resolveEventMetadata(drawEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool"]);
      assert.strictEqual(meta.poolId, 1);
      assert.strictEqual(meta.userAddress, undefined);
    });

    it("should resolve metadata for DrawForceUnlocked", () => {
      const forceUnlockEvent: ParsedProgramEvent = {
        type: "DrawForceUnlocked",
        data: {
          poolId: 1,
          cycleId: 4,
          admin: userAddr,
          prizePot: 250000000n,
          cycleFeeCollected: 5000000n,
        },
      };
      const meta = resolveEventMetadata(forceUnlockEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool"]);
      assert.strictEqual(meta.poolId, 1);
    });

    it("should resolve metadata for DrawVoided", () => {
      const voidEvent: ParsedProgramEvent = {
        type: "DrawVoided",
        data: {
          poolId: 1,
          cycleId: 4,
          admin: userAddr,
          prizesReversed: 250000000n,
          feesReversed: 5000000n,
        },
      };
      const meta = resolveEventMetadata(voidEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool"]);
      assert.strictEqual(meta.poolId, 1);
    });

    it("should resolve metadata for DrawSkipped", () => {
      const skipEvent: ParsedProgramEvent = {
        type: "DrawSkipped",
        data: {
          poolId: 1,
          cycleId: 6,
          rawYield: 100n,
          threshold: 1000000n,
        },
      };
      const meta = resolveEventMetadata(skipEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws", "pool", "clock"]);
      assert.strictEqual(meta.poolId, 1);
    });

    it("should resolve metadata for DrawPreparationProgress", () => {
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
      const meta = resolveEventMetadata(prepEvent);
      assert.strictEqual(meta.scope, "draws");
      assert.deepStrictEqual(meta.scopes, ["draws"]);
      assert.strictEqual(meta.poolId, 1);
    });
  });
});
