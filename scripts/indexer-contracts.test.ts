import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatActivityDescription } from "../app/lib/activity-helpers";
import { hasDrawVrfRandomness } from "../app/lib/draw-helpers";
import type { DrawCycleSummary } from "../app/types";

function parseSeedFromHex(hex?: string): Uint8Array {
  if (!hex || hex.length !== 64) return new Uint8Array(32);
  const arr = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16) || 0;
  }
  return arr;
}

describe("Indexer Contracts & Helpers Suite", () => {
  it("should format activity descriptions for deposit, withdraw, and reinvest accurately", () => {
    const depositDesc = formatActivityDescription({
      activityType: "deposit",
      bonds: 10,
      amountUsdc: 50000000n,
    });
    assert.strictEqual(
      depositDesc,
      "Deposited 50.00 USDC → +10 tickets",
      "Deposit description format mismatch"
    );

    const withdrawDesc = formatActivityDescription({
      activityType: "withdraw",
      bonds: 5,
      amountUsdc: 25000000n,
    });
    assert.strictEqual(
      withdrawDesc,
      "Sold 5 bonds (25.00 USDC) · Pending settle",
      "Withdraw description format mismatch"
    );

    const reinvestDesc = formatActivityDescription({
      activityType: "auto-reinvest",
      bonds: 2,
      amountUsdc: 10000000n,
      cycleId: 3,
    });
    assert.strictEqual(
      reinvestDesc,
      "Draw #3 reinvested: +2 tickets from 10.00 USDC",
      "Auto-reinvest description format mismatch"
    );
  });

  it("should hydrate VRF seeds and evaluate provable fairness compatibility", () => {
    const mockDrawZeroSeed: DrawCycleSummary = {
      poolId: 1,
      cycleId: 1,
      status: "Complete",
      prizePot: 100000000,
      cycleFeeCollected: 2500000,
      lockedTicketCount: 100,
      harvestSlot: 1000,
      randomnessAccount: "Rand111111111111111111111111111111111111111",
      randomnessSeed: parseSeedFromHex(""),
      vrfSeedHex: "",
      winnersCount: 1,
      payoutsCompleted: 1,
      hasPayoutRegistry: true,
    };

    assert.strictEqual(
      hasDrawVrfRandomness(mockDrawZeroSeed),
      false,
      "Zero seed draw must not report VRF randomness"
    );

    const mockVrfHex =
      "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90";
    const mockDrawWithVrf: DrawCycleSummary = {
      ...mockDrawZeroSeed,
      vrfSeedHex: mockVrfHex,
      randomnessSeed: parseSeedFromHex(mockVrfHex),
    };

    assert.strictEqual(
      hasDrawVrfRandomness(mockDrawWithVrf),
      true,
      "Draw with valid VRF seed must report true"
    );
    assert.strictEqual(
      mockDrawWithVrf.randomnessSeed instanceof Uint8Array,
      true
    );
    assert.strictEqual(mockDrawWithVrf.randomnessSeed.length, 32);
    assert.strictEqual(mockDrawWithVrf.randomnessSeed[0], 0xa1);
  });
});
