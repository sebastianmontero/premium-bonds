import assert from "node:assert";
import {
  formatDrawCycleSummary,
  parseWinnersWithVrf,
  getDrawDateTimestamp,
  resolveDrawCycleTimestamp,
  formatDrawDisplayDate,
  hasDrawVrfRandomness,
  calculatePriorDustApplied,
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

  // 7. Test hasDrawVrfRandomness
  console.log(
    "  Testing hasDrawVrfRandomness across draw states & seed variants..."
  );
  const validSeed = new Uint8Array(32).fill(9);
  const zeroSeed = new Uint8Array(32).fill(0);

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "Complete",
      randomnessSeed: validSeed,
      lockedTicketCount: 1000,
    }),
    true,
    "Complete draw with valid seed and tickets should have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "Complete",
      randomnessSeed: zeroSeed,
      lockedTicketCount: 1000,
    }),
    false,
    "Complete draw with all-zero seed should NOT have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "Complete",
      randomnessSeed: validSeed,
      lockedTicketCount: 0,
    }),
    false,
    "Complete draw with 0 locked tickets should NOT have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "Skipped",
      randomnessSeed: validSeed,
      lockedTicketCount: 1000,
    }),
    false,
    "Skipped draw should NOT have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "HaltedInsolvent",
      randomnessSeed: validSeed,
      lockedTicketCount: 1000,
    }),
    false,
    "HaltedInsolvent draw should NOT have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "HaltedYieldSpike",
      randomnessSeed: validSeed,
      lockedTicketCount: 1000,
    }),
    false,
    "HaltedYieldSpike draw should NOT have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness({
      status: "ForceUnlocked",
      randomnessSeed: validSeed,
      lockedTicketCount: 1000,
    }),
    false,
    "ForceUnlocked draw should NOT have VRF randomness"
  );

  assert.strictEqual(
    hasDrawVrfRandomness(undefined),
    false,
    "Undefined draw should NOT have VRF randomness"
  );

  // 7b. Test zero-seed regex filter used in VrfSeedBadge
  const isZeroSeed = (seedHex?: string) =>
    !seedHex || /^(?:0x)?0+$/i.test(seedHex.trim());
  assert.strictEqual(
    isZeroSeed(
      "0000000000000000000000000000000000000000000000000000000000000000"
    ),
    true,
    "All-zero seed hex should be detected as zero seed"
  );
  assert.strictEqual(
    isZeroSeed(
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    ),
    true,
    "0x-prefixed all-zero seed hex should be detected as zero seed"
  );
  assert.strictEqual(
    isZeroSeed(
      "6156ec686156ec686156ec686156ec686156ec686156ec686156ec68de3f9d00"
    ),
    false,
    "Valid non-zero seed hex should NOT be detected as zero seed"
  );
  assert.strictEqual(isZeroSeed(""), true, "Empty seed should be zero seed");
  assert.strictEqual(
    isZeroSeed(undefined),
    true,
    "Undefined seed should be zero seed"
  );

  // 8. Test calculatePriorDustApplied
  console.log("  Testing calculatePriorDustApplied...");
  // 8a. Winner won 2 USDC, bought 1 bond at 5 USDC -> 3 USDC prior dust used
  assert.strictEqual(
    calculatePriorDustApplied(1, 2_000_000, 5_000_000),
    3_000_000
  );

  // 8b. Winner won 10 USDC, bought 2 bonds at 5 USDC -> 0 prior dust used
  assert.strictEqual(calculatePriorDustApplied(2, 10_000_000, 5_000_000), 0);

  // 8c. Winner won 7 USDC, bought 2 bonds at 5 USDC -> 3 USDC prior dust used
  assert.strictEqual(
    calculatePriorDustApplied(2, 7_000_000, 5_000_000),
    3_000_000
  );

  // 8d. Explicit usedPriorDust parameter override
  assert.strictEqual(
    calculatePriorDustApplied(2, 7_000_000, 5_000_000, 4_500_000),
    4_500_000
  );

  // 8e. Zero bonds bought or zero bond price
  assert.strictEqual(calculatePriorDustApplied(0, 7_000_000, 5_000_000), 0);
  assert.strictEqual(calculatePriorDustApplied(2, 7_000_000, 0), 0);

  console.log("✅ All Draw Helpers & SDK Unit Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
