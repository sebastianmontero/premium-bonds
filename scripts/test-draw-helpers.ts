import assert from "node:assert";
import {
  formatDrawCycleSummary,
  parseWinnersWithVrf,
  getDrawDateTimestamp,
  resolveDrawCycleTimestamp,
  formatDrawDisplayDate,
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
    initiatedAt: 1723800000n,
    completedAt: 1723900000n,
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
    initiatedAt: 1699990000n,
    completedAt: 1700000000n,
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

  // 6. Test resolveDrawCycleTimestamp & formatDrawDisplayDate
  console.log("  Testing resolveDrawCycleTimestamp & formatDrawDisplayDate...");
  // 6a. Completed draw with completedAt
  const res1 = resolveDrawCycleTimestamp({
    completedAt: 1723900000,
    initiatedAt: 1723800000,
    cycleId: 14,
  });
  assert.strictEqual(res1.timestamp, 1723900000);
  assert.strictEqual(res1.isEstimated, false);

  // 6b. In-flight draw with initiatedAt only
  const res2 = resolveDrawCycleTimestamp({
    initiatedAt: 1723800000,
    completedAt: 0,
    cycleId: 15,
  });
  assert.strictEqual(res2.timestamp, 1723800000);
  assert.strictEqual(res2.isEstimated, false);

  // 6c. Skipped/Voided draw without PayoutRegistry but with completedAt
  const res3 = resolveDrawCycleTimestamp({
    initiatedAt: 1723800000,
    completedAt: 1723800000,
    cycleId: 12,
  });
  assert.strictEqual(res3.timestamp, 1723800000);
  assert.strictEqual(res3.isEstimated, false);

  // 6d. Fallback estimated calculation
  const res4 = resolveDrawCycleTimestamp(
    { cycleId: 10 },
    {
      currentCycleEndAt: 1724000000,
      currentCycleId: 15,
      stakeCycleDurationHrs: 168,
    }
  );
  assert.strictEqual(res4.timestamp, 1724000000 - 5 * 168 * 3600);
  assert.strictEqual(res4.isEstimated, true);

  // 6e. formatDrawDisplayDate formatting
  const formattedExact = formatDrawDisplayDate(
    { completedAt: 1700000000 },
    undefined,
    { estimatedPrefix: "Est." }
  );
  assert.strictEqual(formattedExact, "Nov 14, 2023");

  const formattedEst = formatDrawDisplayDate(
    { cycleId: 0 },
    {
      currentCycleEndAt: 1700604800,
      currentCycleId: 1,
      stakeCycleDurationHrs: 168,
    },
    { estimatedPrefix: "Est." }
  );
  assert.strictEqual(formattedEst, "Est. Nov 14, 2023");

  console.log("✅ All Draw Helpers & SDK Unit Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
