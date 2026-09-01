import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateReinvestmentBreakdown,
  getWinnerKey,
  RPC_PROPAGATION_GRACE_PERIOD_MS,
} from "../app/lib/draw-helpers";
import {
  fetchUserAtaBalance,
  fetchPoolYieldOnChainState,
  resolveWinnerAddress,
  USDC_MINT,
} from "../app/lib/bonds-sdk";
import type { PrizeHistoryEntry } from "../app/types";

describe("Winner Crank Status & Ledger Sync Suite", () => {
  it("should calculate reinvestment breakdown matching on-chain parity", () => {
    // 1a. Exact multiple of bond price: $25 prize with $5 bond price, $0 prior dust
    const res1 = calculateReinvestmentBreakdown(25_000_000, 0, 5_000_000);
    assert.strictEqual(
      res1.bondsBought,
      5,
      "25 USDC should buy exactly 5 bonds"
    );
    assert.strictEqual(res1.usedPriorDust, 0, "No prior dust should be used");
    assert.strictEqual(res1.dustAccumulated, 0, "No dust should remain");
    assert.strictEqual(
      res1.totalAvailable,
      25_000_000,
      "Total available is 25 USDC"
    );

    // 1b. Fractional prize generating dust: $13 prize with $5 bond price, $0 prior dust
    const res2 = calculateReinvestmentBreakdown(13_000_000, 0, 5_000_000);
    assert.strictEqual(
      res2.bondsBought,
      2,
      "13 USDC should buy 2 bonds (10 USDC)"
    );
    assert.strictEqual(res2.usedPriorDust, 0, "No prior dust used");
    assert.strictEqual(
      res2.dustAccumulated,
      3_000_000,
      "3 USDC leftover dust accumulated"
    );

    // 1c. Pooling prior dust to unlock bonus bond: $3 prize with $2 prior dust ($5 total)
    const res3 = calculateReinvestmentBreakdown(
      3_000_000,
      2_000_000,
      5_000_000
    );
    assert.strictEqual(
      res3.bondsBought,
      1,
      "3 USDC + 2 USDC prior dust should buy 1 bond"
    );
    assert.strictEqual(
      res3.usedPriorDust,
      2_000_000,
      "2 USDC prior dust should be used"
    );
    assert.strictEqual(res3.dustAccumulated, 0, "0 dust should remain");

    // 1d. Pooling prior dust with partial leftover: $4 prize with $3 prior dust ($7 total)
    const res4 = calculateReinvestmentBreakdown(
      4_000_000,
      3_000_000,
      5_000_000
    );
    assert.strictEqual(
      res4.bondsBought,
      1,
      "4 USDC + 3 USDC dust should buy 1 bond (5 USDC)"
    );
    assert.strictEqual(res4.usedPriorDust, 1_000_000, "1 USDC prior dust used");
    assert.strictEqual(
      res4.dustAccumulated,
      0,
      "0 dust accumulated from current prize"
    );

    // 1e. Explicit bonds bought override
    const res5 = calculateReinvestmentBreakdown(20_000_000, 0, 5_000_000, 4);
    assert.strictEqual(
      res5.bondsBought,
      4,
      "Explicit bonds bought should be 4"
    );
  });

  it("should validate winner composite key generator and constants", () => {
    assert.strictEqual(
      getWinnerKey(10, 0),
      "10-0",
      "getWinnerKey(10, 0) must return '10-0'"
    );
    assert.strictEqual(
      getWinnerKey(42, 3),
      "42-3",
      "getWinnerKey(42, 3) must return '42-3'"
    );
    assert.strictEqual(
      RPC_PROPAGATION_GRACE_PERIOD_MS,
      1200,
      "RPC_PROPAGATION_GRACE_PERIOD_MS must be 1200ms"
    );
  });

  it("should handle dynamic modal selector derivation across lifecycle transitions", () => {
    const initialEntries: PrizeHistoryEntry[] = [
      {
        drawCycleId: 8,
        winnerIndex: 0,
        amount: 10_000_000,
        status: "processing",
        date: new Date().toISOString(),
        tierIndex: 1,
        bondsBought: 0,
      },
      {
        drawCycleId: 8,
        winnerIndex: 1,
        amount: 5_000_000,
        status: "processing",
        date: new Date().toISOString(),
        tierIndex: 2,
        bondsBought: 0,
      },
    ];

    const selectedPrizeKey = { drawCycleId: 8, winnerIndex: 0 };

    // Initial derived modal entry
    let derivedModalEntry =
      initialEntries.find(
        (p) =>
          p.drawCycleId === selectedPrizeKey.drawCycleId &&
          p.winnerIndex === selectedPrizeKey.winnerIndex
      ) ?? null;

    assert.notStrictEqual(derivedModalEntry, null, "Modal entry must be found");
    assert.strictEqual(
      derivedModalEntry?.status,
      "processing",
      "Initial status must be processing"
    );

    // State updates after crank execution (optimistic update)
    const updatedEntries: PrizeHistoryEntry[] = initialEntries.map((p) => {
      if (p.drawCycleId === 8 && p.winnerIndex === 0) {
        return {
          ...p,
          status: "reinvested",
          bondsBought: 2,
          reinvestedTickets: 2,
        };
      }
      return p;
    });

    // Re-derive modal entry dynamically
    derivedModalEntry =
      updatedEntries.find(
        (p) =>
          p.drawCycleId === selectedPrizeKey.drawCycleId &&
          p.winnerIndex === selectedPrizeKey.winnerIndex
      ) ?? null;

    assert.notStrictEqual(derivedModalEntry, null, "Modal entry must be found");
    assert.strictEqual(
      derivedModalEntry?.status,
      "reinvested",
      "Derived modal entry must automatically transition to 'reinvested'"
    );
    assert.strictEqual(
      derivedModalEntry?.bondsBought,
      2,
      "Derived modal entry must reflect 2 bonus bonds"
    );
  });

  it("should pass explicit 'confirmed' commitment across RPC methods", async () => {
    let capturedCommitment = "";

    const mockRpc = {
      getAccountInfo: (_addr: unknown, opts?: { commitment?: string }) => {
        capturedCommitment = opts?.commitment ?? "";
        return {
          send: async () => ({ value: null }),
        };
      },
    };

    // fetchUserAtaBalance
    await fetchUserAtaBalance(
      mockRpc,
      "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m",
      USDC_MINT
    );
    assert.strictEqual(
      capturedCommitment,
      "confirmed",
      `fetchUserAtaBalance must pass commitment: 'confirmed', received: '${capturedCommitment}'`
    );

    // resolveWinnerAddress
    capturedCommitment = "";
    const dummyFallback = "4rQzK5R2YQ2m1bL5x1eK5y9b1P6m1V2b5Q8m2V1b4Q9m";
    await resolveWinnerAddress(mockRpc, 1, 1, 0, undefined, dummyFallback);
    assert.strictEqual(
      capturedCommitment,
      "confirmed",
      `resolveWinnerAddress must pass commitment: 'confirmed', received: '${capturedCommitment}'`
    );

    // fetchPoolYieldOnChainState
    capturedCommitment = "";
    await fetchPoolYieldOnChainState(mockRpc, { poolId: 1 });
    assert.strictEqual(
      capturedCommitment,
      "confirmed",
      `fetchPoolYieldOnChainState must pass commitment: 'confirmed', received: '${capturedCommitment}'`
    );
  });
});
