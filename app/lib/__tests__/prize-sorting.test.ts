import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  comparePrizeHistoryEntries,
  sortPrizeHistoryEntries,
} from "../draw-helpers";
import type { PrizeHistoryEntry } from "../../types";

function createMockPrize(
  overrides: Partial<PrizeHistoryEntry> = {}
): PrizeHistoryEntry {
  return {
    drawCycleId: 1,
    date: "2026-09-01T12:00:00.000Z",
    tierIndex: 0,
    amount: 100_000_000,
    winnerIndex: 0,
    status: "processing",
    ...overrides,
  };
}

describe("Prize History Ledger Sorting Suite", () => {
  it("should sort primary key by draw cycle descending (newest draws first)", () => {
    const p1 = createMockPrize({
      drawCycleId: 1,
      tierIndex: 0,
      amount: 50_000_000,
    });
    const p2 = createMockPrize({
      drawCycleId: 3,
      tierIndex: 0,
      amount: 50_000_000,
    });
    const p3 = createMockPrize({
      drawCycleId: 2,
      tierIndex: 0,
      amount: 50_000_000,
    });

    const sorted = sortPrizeHistoryEntries([p1, p2, p3]);

    assert.deepStrictEqual(
      sorted.map((p) => p.drawCycleId),
      [3, 2, 1]
    );
  });

  it("should sort secondary key by tier ascending (biggest prizes first: Tier 0 > Tier 1 > Tier 2)", () => {
    const grandPrize = createMockPrize({
      drawCycleId: 5,
      tierIndex: 0,
      amount: 500_000_000,
      winnerIndex: 0,
    });
    const runnerUp = createMockPrize({
      drawCycleId: 5,
      tierIndex: 1,
      amount: 100_000_000,
      winnerIndex: 1,
    });
    const consolation = createMockPrize({
      drawCycleId: 5,
      tierIndex: 2,
      amount: 10_000_000,
      winnerIndex: 2,
    });

    // Feed in reverse tier order
    const sorted = sortPrizeHistoryEntries([consolation, grandPrize, runnerUp]);

    assert.deepStrictEqual(
      sorted.map((p) => p.tierIndex),
      [0, 1, 2]
    );
  });

  it("should sort tertiary key by prize amount descending (largest amount first within same tier)", () => {
    const consolationLow = createMockPrize({
      drawCycleId: 4,
      tierIndex: 2,
      amount: 5_000_000,
      winnerIndex: 5,
    });
    const consolationHigh = createMockPrize({
      drawCycleId: 4,
      tierIndex: 2,
      amount: 25_000_000,
      winnerIndex: 3,
    });

    const sorted = sortPrizeHistoryEntries([consolationLow, consolationHigh]);

    assert.strictEqual(sorted[0].amount, 25_000_000);
    assert.strictEqual(sorted[1].amount, 5_000_000);
  });

  it("should use winner index ascending as stable quaternary tie-breaker", () => {
    const winA = createMockPrize({
      drawCycleId: 2,
      tierIndex: 2,
      amount: 10_000_000,
      winnerIndex: 2,
    });
    const winB = createMockPrize({
      drawCycleId: 2,
      tierIndex: 2,
      amount: 10_000_000,
      winnerIndex: 1,
    });

    const sorted = sortPrizeHistoryEntries([winA, winB]);

    assert.strictEqual(sorted[0].winnerIndex, 1);
    assert.strictEqual(sorted[1].winnerIndex, 2);
  });

  it("should accurately sort a realistic multi-draw, multi-tier prize ledger", () => {
    const draw1Consolation = createMockPrize({
      drawCycleId: 1,
      tierIndex: 2,
      amount: 10_000_000,
      winnerIndex: 4,
    });
    const draw2RunnerUp = createMockPrize({
      drawCycleId: 2,
      tierIndex: 1,
      amount: 150_000_000,
      winnerIndex: 2,
    });
    const draw2GrandPrize = createMockPrize({
      drawCycleId: 2,
      tierIndex: 0,
      amount: 500_000_000,
      winnerIndex: 0,
    });
    const draw2Consolation = createMockPrize({
      drawCycleId: 2,
      tierIndex: 2,
      amount: 20_000_000,
      winnerIndex: 5,
    });
    const draw3Consolation = createMockPrize({
      drawCycleId: 3,
      tierIndex: 2,
      amount: 15_000_000,
      winnerIndex: 3,
    });

    // Jumbled order
    const raw = [
      draw1Consolation,
      draw2Consolation,
      draw3Consolation,
      draw2RunnerUp,
      draw2GrandPrize,
    ];

    const sorted = sortPrizeHistoryEntries(raw);

    // Expected order:
    // 1. Draw 3 Consolation (Draw 3 newest)
    // 2. Draw 2 Grand Prize (Draw 2, Tier 0)
    // 3. Draw 2 Runner-up (Draw 2, Tier 1)
    // 4. Draw 2 Consolation (Draw 2, Tier 2)
    // 5. Draw 1 Consolation (Draw 1 oldest)
    assert.deepStrictEqual(
      sorted.map((p) => ({
        cycle: p.drawCycleId,
        tier: p.tierIndex,
        amount: p.amount,
      })),
      [
        { cycle: 3, tier: 2, amount: 15_000_000 },
        { cycle: 2, tier: 0, amount: 500_000_000 },
        { cycle: 2, tier: 1, amount: 150_000_000 },
        { cycle: 2, tier: 2, amount: 20_000_000 },
        { cycle: 1, tier: 2, amount: 10_000_000 },
      ]
    );
  });

  it("should guard against undefined or missing numeric values without throwing or NaN corruption", () => {
    const completePrize = createMockPrize({
      drawCycleId: 2,
      tierIndex: 0,
      amount: 100_000_000,
      winnerIndex: 0,
    });
    // Create malformed entry missing fields
    const malformedPrize = {
      ...createMockPrize(),
      drawCycleId: undefined as unknown as number,
      tierIndex: undefined as unknown as number,
      amount: undefined as unknown as number,
      winnerIndex: undefined as unknown as number,
    };

    assert.doesNotThrow(() => {
      const cmp = comparePrizeHistoryEntries(completePrize, malformedPrize);
      assert.strictEqual(typeof cmp, "number");
      assert.ok(!Number.isNaN(cmp));
    });

    const sorted = sortPrizeHistoryEntries([malformedPrize, completePrize]);
    assert.strictEqual(sorted[0], completePrize);
  });

  it("should return a new array without mutating the original input array", () => {
    const p1 = createMockPrize({ drawCycleId: 1 });
    const p2 = createMockPrize({ drawCycleId: 2 });
    const original = [p1, p2];

    const sorted = sortPrizeHistoryEntries(original);

    assert.notStrictEqual(sorted, original);
    assert.strictEqual(original[0].drawCycleId, 1);
    assert.strictEqual(original[1].drawCycleId, 2);
    assert.strictEqual(sorted[0].drawCycleId, 2);
    assert.strictEqual(sorted[1].drawCycleId, 1);
  });

  it("should handle empty array and single-item array", () => {
    assert.deepStrictEqual(sortPrizeHistoryEntries([]), []);

    const single = [createMockPrize({ drawCycleId: 7 })];
    const sortedSingle = sortPrizeHistoryEntries(single);
    assert.deepStrictEqual(sortedSingle, single);
    assert.notStrictEqual(sortedSingle, single);
  });
});
