import assert from "node:assert";
import {
  formatDrawCycleSummary,
  parseWinnersWithVrf,
  getDrawDateTimestamp,
} from "../app/lib/draw-helpers";
import {
  chunkArray,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../app/lib/bonds-sdk";
import { address } from "@solana/kit";

async function runTests() {
  console.log("▶ Running Draw Helpers & SDK Unit Tests...");

  // 1. Test chunkArray
  console.log("  Testing chunkArray helper...");
  const items = Array.from({ length: 185 }, (_, i) => i);
  const chunks = chunkArray(items, 80);
  assert.strictEqual(
    chunks.length,
    3,
    "Expected 3 chunks for 185 items with chunk size 80"
  );
  assert.strictEqual(chunks[0].length, 80);
  assert.strictEqual(chunks[1].length, 80);
  assert.strictEqual(chunks[2].length, 25);
  assert.strictEqual(chunks.flat().length, 185);

  // 2. Test formatDrawCycleSummary
  console.log("  Testing formatDrawCycleSummary...");
  const dummyDrawCycle: DrawCycleInfo = {
    poolId: 1,
    cycleId: 14,
    status: "Complete",
    prizePot: 100_000_000n,
    cycleFeeCollected: 1_000_000n,
    lockedTicketCount: 50_000,
    harvestSlot: 240_500_100n,
    randomnessAccount: address("11111111111111111111111111111111"),
    randomnessSeed: new Uint8Array(32).fill(7),
  };

  const dummyPayout: PayoutRegistryInfo = {
    poolId: 1,
    cycleId: 14,
    status: 0,
    winnersCount: 2,
    payoutsCompleted: 1,
    revealedAt: 1723900000n,
    winners: [
      {
        winner: address("11111111111111111111111111111111"),
        amountOwed: 50_000_000n,
        bondsBought: 10,
        processed: 1,
        tierIndex: 0,
      },
      {
        winner: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        amountOwed: 25_000_000n,
        bondsBought: 5,
        processed: 0,
        tierIndex: 1,
      },
    ],
  };

  const summary = formatDrawCycleSummary(dummyDrawCycle, dummyPayout);
  assert.strictEqual(summary.cycleId, 14);
  assert.strictEqual(summary.prizePot, 100_000_000);
  assert.strictEqual(summary.revealedAt, 1723900000);
  assert.strictEqual(summary.winnersCount, 2);
  assert.strictEqual(summary.payoutsCompleted, 1);
  assert.strictEqual(summary.hasPayoutRegistry, true);

  // 3. Test parseWinnersWithVrf & multi-tier slotInTier
  console.log(
    "  Testing parseWinnersWithVrf & multi-tier slotInTier calculation..."
  );
  const dummyMultiTierPayout: PayoutRegistryInfo = {
    poolId: 1,
    cycleId: 14,
    status: 0,
    winnersCount: 3,
    payoutsCompleted: 0,
    revealedAt: 1723900000n,
    winners: [
      {
        winner: address("11111111111111111111111111111111"),
        amountOwed: 50_000_000n,
        bondsBought: 10,
        processed: 0,
        tierIndex: 0, // slotInTier = 0
      },
      {
        winner: address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
        amountOwed: 25_000_000n,
        bondsBought: 5,
        processed: 0,
        tierIndex: 1, // slotInTier = 0 (first runner-up)
      },
      {
        winner: address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"),
        amountOwed: 25_000_000n,
        bondsBought: 5,
        processed: 0,
        tierIndex: 1, // slotInTier = 1 (second runner-up)
      },
    ],
  };

  const parsedWinners = await parseWinnersWithVrf(
    dummyMultiTierPayout,
    dummyDrawCycle
  );
  assert.strictEqual(parsedWinners.length, 3);
  assert.strictEqual(parsedWinners[0].slotInTier, 0);
  assert.strictEqual(parsedWinners[1].slotInTier, 0);
  assert.strictEqual(parsedWinners[2].slotInTier, 1);
  assert.ok(parsedWinners[0].winningTicketIndex !== undefined);
  assert.ok(parsedWinners[1].winningTicketIndex !== undefined);
  assert.ok(parsedWinners[2].winningTicketIndex !== undefined);
  assert.ok(parsedWinners[0].winningTicketIndex! < 50_000);

  // 4. Test getDrawDateTimestamp
  console.log("  Testing getDrawDateTimestamp...");
  const ts1 = getDrawDateTimestamp(1723900000, 1723950000, 14, 14);
  assert.strictEqual(ts1, 1723900000);

  const ts2 = getDrawDateTimestamp(undefined, 1724000000, 15, 14, 604800);
  assert.strictEqual(ts2, 1724000000 - 604800);

  // 5. Test Draw Cycle #0 Support & Range Generation
  console.log("  Testing Draw Cycle #0 format, VRF, and range generation...");
  const cycle0Draw: DrawCycleInfo = {
    poolId: 1,
    cycleId: 0,
    status: "Complete",
    prizePot: 25_000_000n,
    cycleFeeCollected: 250_000n,
    lockedTicketCount: 1_000,
    harvestSlot: 100_000n,
    randomnessAccount: address("11111111111111111111111111111111"),
    randomnessSeed: new Uint8Array(32).fill(42),
  };

  const cycle0Payout: PayoutRegistryInfo = {
    poolId: 1,
    cycleId: 0,
    status: 0,
    winnersCount: 1,
    payoutsCompleted: 1,
    revealedAt: 1700000000n,
    winners: [
      {
        winner: address("11111111111111111111111111111111"),
        amountOwed: 25_000_000n,
        bondsBought: 5,
        processed: 1,
        tierIndex: 0,
      },
    ],
  };

  const summary0 = formatDrawCycleSummary(cycle0Draw, cycle0Payout);
  assert.strictEqual(summary0.cycleId, 0);
  assert.strictEqual(summary0.prizePot, 25_000_000);
  assert.strictEqual(summary0.status, "Complete");

  const winners0 = await parseWinnersWithVrf(cycle0Payout, cycle0Draw);
  assert.strictEqual(winners0.length, 1);
  assert.ok(winners0[0].winningTicketIndex !== undefined);
  assert.ok(winners0[0].winningTicketIndex! < 1_000);

  // Test timestamp calculation when cycleId = 0 and currentCycleId = 1
  const tsCycle0 = getDrawDateTimestamp(undefined, 1700604800, 1, 0, 604800);
  assert.strictEqual(tsCycle0, 1700000000);

  // Test range derivation for useDrawExplorer when currentDrawCycleId = 0
  const cycleIdsAt0: number[] = [];
  const maxCycles = 100;
  const current0 = 0;
  for (let cId = current0; cId >= 0 && cId > current0 - maxCycles; cId--) {
    cycleIdsAt0.push(cId);
  }
  assert.deepStrictEqual(cycleIdsAt0, [0], "Expected cycleIds to contain [0]");

  // Test range derivation when currentDrawCycleId = 1 (after cycle 0 resolved)
  const cycleIdsAt1: number[] = [];
  const current1 = 1;
  for (let cId = current1; cId >= 0 && cId > current1 - maxCycles; cId--) {
    cycleIdsAt1.push(cId);
  }
  assert.deepStrictEqual(
    cycleIdsAt1,
    [1, 0],
    "Expected cycleIds to include both cycle 1 and cycle 0"
  );

  console.log("✅ All Draw Helpers & SDK Unit Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
