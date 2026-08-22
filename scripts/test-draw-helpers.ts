import assert from "node:assert";
import {
  formatDrawCycleSummary,
  parseWinnersWithVrf,
  getDrawDateTimestamp,
  resolveDrawCycleTimestamp,
  formatDrawDisplayDate,
  hasDrawVrfRandomness,
  calculatePriorDustApplied,
  buildDrawStatusOptions,
  CANONICAL_DRAW_STATUS_ORDER,
  DRAW_STATUS_TRANSLATION_KEYS,
  getDrawStatusTranslationKey,
  getPayoutTimelockState,
  getClaimWinningsCapability,
  getCrankActionCapability,
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

  // 9. Test buildDrawStatusOptions & Canonical Draw Status Helpers
  console.log(
    "  Testing buildDrawStatusOptions & Canonical Draw Status Helpers..."
  );

  const mockTranslations: Record<string, string> = {
    allStatuses: "All Statuses",
    statusComplete: "Complete",
    statusAwaitingVRF: "Awaiting VRF",
    statusAwaitingYield: "Awaiting Yield",
    statusSkipped: "Skipped",
    statusForceUnlocked: "Force Unlocked",
    statusVoided: "Voided",
    statusHaltedInsolvent: "Halted (Insolvency)",
    statusHaltedYieldSpike: "Halted (Yield Spike)",
  };
  const mockT = (key: string) => mockTranslations[key] || key;

  // 9a. Empty draws list
  const emptyOptions = buildDrawStatusOptions([], mockT);
  assert.strictEqual(emptyOptions.length, 1);
  assert.deepStrictEqual(emptyOptions[0], {
    value: "all",
    label: "All Statuses (0)",
  });

  // 9b. Standard draws dataset (5 Complete, 2 AwaitingRandomness)
  const standardDraws = [
    { status: "Complete" as const },
    { status: "AwaitingRandomness" as const },
    { status: "Complete" as const },
    { status: "Complete" as const },
    { status: "AwaitingRandomness" as const },
    { status: "Complete" as const },
    { status: "Complete" as const },
  ];
  const standardOptions = buildDrawStatusOptions(standardDraws, mockT);
  assert.strictEqual(standardOptions.length, 3);
  assert.deepStrictEqual(standardOptions, [
    { value: "all", label: "All Statuses (7)" },
    { value: "Complete", label: "Complete (5)" },
    { value: "AwaitingRandomness", label: "Awaiting VRF (2)" },
  ]);

  // 9c. Canonical sort order verification (input in reverse order)
  const reverseDraws = [
    { status: "HaltedYieldSpike" as const },
    { status: "HaltedInsolvent" as const },
    { status: "Voided" as const },
    { status: "ForceUnlocked" as const },
    { status: "Skipped" as const },
    { status: "AwaitingYield" as const },
    { status: "AwaitingRandomness" as const },
    { status: "Complete" as const },
  ];
  const sortedOptions = buildDrawStatusOptions(reverseDraws, mockT);
  assert.strictEqual(sortedOptions.length, 9);
  assert.strictEqual(sortedOptions[0].value, "all");
  assert.strictEqual(sortedOptions[1].value, "Complete");
  assert.strictEqual(sortedOptions[2].value, "AwaitingRandomness");
  assert.strictEqual(sortedOptions[3].value, "AwaitingYield");
  assert.strictEqual(sortedOptions[4].value, "Skipped");
  assert.strictEqual(sortedOptions[5].value, "ForceUnlocked");
  assert.strictEqual(sortedOptions[6].value, "Voided");
  assert.strictEqual(sortedOptions[7].value, "HaltedInsolvent");
  assert.strictEqual(sortedOptions[8].value, "HaltedYieldSpike");

  // 9d. Unrecognized status placed deterministically at end with fallback label
  const unknownDraws = [
    { status: "UnknownCustomStatus" as any },
    { status: "Complete" as const },
  ];
  const unknownOptions = buildDrawStatusOptions(unknownDraws, mockT);
  assert.strictEqual(unknownOptions.length, 3);
  assert.strictEqual(unknownOptions[1].value, "Complete");
  assert.deepStrictEqual(unknownOptions[2], {
    value: "UnknownCustomStatus",
    label: "UnknownCustomStatus (1)",
  });

  // 9e. Translation Key Lookup & Canonical Array integrity
  assert.strictEqual(
    getDrawStatusTranslationKey("AwaitingRandomness"),
    "statusAwaitingVRF"
  );
  assert.strictEqual(getDrawStatusTranslationKey("Complete"), "statusComplete");
  assert.strictEqual(
    getDrawStatusTranslationKey("NonExistentStatus"),
    undefined
  );
  assert.strictEqual(CANONICAL_DRAW_STATUS_ORDER.length, 8);

  // 10. Test DrawHistoryStats Calculation Logic & Lifetime Prize Decoupling
  console.log(
    "  Testing DrawHistoryStats calculation logic & lifetime prize decoupling..."
  );
  const mockSummaries = [
    {
      cycleId: 10,
      status: "Complete" as const,
      prizePot: 60_000_000,
      winnersCount: 2,
    },
    {
      cycleId: 9,
      status: "Complete" as const,
      prizePot: 40_000_000,
      winnersCount: 1,
    },
    { cycleId: 8, status: "Skipped" as const, prizePot: 0, winnersCount: 0 },
    {
      cycleId: 7,
      status: "Complete" as const,
      prizePot: 50_000_000,
      winnersCount: 3,
    },
  ];

  // Helper simulating useDrawExplorer stats reducer
  const computeStats = (
    summaries: typeof mockSummaries,
    poolTotalPrizesDistributed?: number
  ) => {
    let completedDraws = 0;
    let batchTotalYield = 0;
    let totalWinningBonds = 0;

    for (const draw of summaries) {
      if (draw.status === "Complete") {
        completedDraws++;
        batchTotalYield += draw.prizePot;
        totalWinningBonds += draw.winnersCount;
      }
    }

    const averagePrizePot =
      completedDraws > 0 ? Math.round(batchTotalYield / completedDraws) : 0;
    const totalYieldDistributed = poolTotalPrizesDistributed ?? batchTotalYield;

    return {
      totalYieldDistributed,
      totalDrawsCompleted: completedDraws,
      totalWinningBonds,
      averagePrizePot,
    };
  };

  // 10a. With explicit on-chain lifetime pool counter (e.g. 500M lifetime across hundreds of draws)
  const statsWithLifetime = computeStats(mockSummaries, 500_000_000);
  assert.strictEqual(statsWithLifetime.totalYieldDistributed, 500_000_000);
  assert.strictEqual(statsWithLifetime.totalDrawsCompleted, 3);
  assert.strictEqual(statsWithLifetime.totalWinningBonds, 6);
  // Average prize pot must be computed on the 3 completed draws in batch: (60M + 40M + 50M) / 3 = 50M
  assert.strictEqual(statsWithLifetime.averagePrizePot, 50_000_000);

  // 10b. Fallback when poolTotalPrizesDistributed is undefined
  const statsFallback = computeStats(mockSummaries, undefined);
  assert.strictEqual(statsFallback.totalYieldDistributed, 150_000_000);
  assert.strictEqual(statsFallback.averagePrizePot, 50_000_000);

  // 11. Test getPayoutTimelockState Calculation Helper
  console.log("  Testing getPayoutTimelockState calculation & formatting...");

  // 11a. Missing or invalid revealedAt
  const noRevealed = getPayoutTimelockState(undefined, 300, 1723900100);
  assert.strictEqual(noRevealed.isTimelocked, false);
  assert.strictEqual(noRevealed.remainingSeconds, 0);
  assert.strictEqual(noRevealed.formattedRemaining, "00:00");
  assert.strictEqual(noRevealed.formattedUnlockTime, "—");
  assert.strictEqual(noRevealed.progressPercent, 100);

  // 11b. Zero timelock seconds
  const zeroTimelock = getPayoutTimelockState(1723900000, 0, 1723900000);
  assert.strictEqual(zeroTimelock.isTimelocked, false);
  assert.strictEqual(zeroTimelock.remainingSeconds, 0);
  assert.strictEqual(zeroTimelock.progressPercent, 100);

  // 11c. Active timelock mid-way (revealedAt: 1000, timelock: 300, now: 1100 -> 200s remaining = 03:20, 33% progress)
  const activeTimelock = getPayoutTimelockState(1000, 300, 1100);
  assert.strictEqual(activeTimelock.isTimelocked, true);
  assert.strictEqual(activeTimelock.remainingSeconds, 200);
  assert.strictEqual(activeTimelock.formattedRemaining, "03:20");
  assert.strictEqual(activeTimelock.progressPercent, 33);
  assert.strictEqual(activeTimelock.timelockExpiresAt, 1300);
  assert.ok(
    activeTimelock.formattedUnlockTime.length > 0 &&
      activeTimelock.formattedUnlockTime !== "—"
  );

  // 11d. Active timelock near completion (5s remaining -> 00:05)
  const nearEndTimelock = getPayoutTimelockState(1000, 300, 1295);
  assert.strictEqual(nearEndTimelock.isTimelocked, true);
  assert.strictEqual(nearEndTimelock.remainingSeconds, 5);
  assert.strictEqual(nearEndTimelock.formattedRemaining, "00:05");
  assert.strictEqual(nearEndTimelock.progressPercent, 98);

  // 11e. Exact expiration boundary (now === revealedAt + 300)
  const exactEndTimelock = getPayoutTimelockState(1000, 300, 1300);
  assert.strictEqual(exactEndTimelock.isTimelocked, false);
  assert.strictEqual(exactEndTimelock.remainingSeconds, 0);
  assert.strictEqual(exactEndTimelock.formattedRemaining, "00:00");
  assert.strictEqual(exactEndTimelock.progressPercent, 100);

  // 11f. Well past expiration (now > revealedAt + 300)
  const pastTimelock = getPayoutTimelockState(1000, 300, 2000);
  assert.strictEqual(pastTimelock.isTimelocked, false);
  assert.strictEqual(pastTimelock.remainingSeconds, 0);
  assert.strictEqual(pastTimelock.formattedRemaining, "00:00");
  assert.strictEqual(pastTimelock.progressPercent, 100);

  // 12. Test getClaimWinningsCapability
  console.log("  Testing getClaimWinningsCapability...");
  // 12a. Claiming in progress
  const capClaiming = getClaimWinningsCapability({
    pool: { isFrozenForDraw: false },
    unclaimedAmount: 10_000_000,
    isClaiming: true,
  });
  assert.strictEqual(capClaiming.canExecute, false);
  assert.strictEqual(capClaiming.disabledReason, "in_progress");
  assert.strictEqual(capClaiming.buttonLabelKey, "claiming");

  // 12b. Frozen for draw
  const capFrozen = getClaimWinningsCapability({
    pool: { isFrozenForDraw: true },
    unclaimedAmount: 10_000_000,
    isClaiming: false,
  });
  assert.strictEqual(capFrozen.canExecute, false);
  assert.strictEqual(capFrozen.disabledReason, "frozen_for_draw");
  assert.strictEqual(capFrozen.buttonLabelKey, "claimingPaused");
  assert.strictEqual(capFrozen.statusBadgeKey, "frozenNotice");
  assert.strictEqual(capFrozen.tooltipKey, "frozenTooltip");

  // 12c. Zero amount
  const capZero = getClaimWinningsCapability({
    pool: { isFrozenForDraw: false },
    unclaimedAmount: 0,
    isClaiming: false,
  });
  assert.strictEqual(capZero.canExecute, false);
  assert.strictEqual(capZero.disabledReason, "zero_amount");
  assert.strictEqual(capZero.buttonLabelKey, "claimNow");

  // 12d. Normal executable claim
  const capReady = getClaimWinningsCapability({
    pool: { isFrozenForDraw: false },
    unclaimedAmount: 5_000_000,
    isClaiming: false,
  });
  assert.strictEqual(capReady.canExecute, true);
  assert.strictEqual(capReady.disabledReason, undefined);
  assert.strictEqual(capReady.buttonLabelKey, "claimNow");

  // 13. Test getCrankActionCapability
  console.log("  Testing getCrankActionCapability...");
  // 13a. Cranking in progress
  const crankInProgress = getCrankActionCapability({
    pool: { isFrozenForDraw: false },
    isTimelocked: false,
    isCranking: true,
  });
  assert.strictEqual(crankInProgress.canExecute, false);
  assert.strictEqual(crankInProgress.disabledReason, "in_progress");
  assert.strictEqual(crankInProgress.buttonLabelKey, "processing");

  // 13b. Frozen for draw
  const crankFrozen = getCrankActionCapability({
    pool: { isFrozenForDraw: true },
    isTimelocked: false,
    isCranking: false,
  });
  assert.strictEqual(crankFrozen.canExecute, false);
  assert.strictEqual(crankFrozen.disabledReason, "frozen_for_draw");
  assert.strictEqual(crankFrozen.buttonLabelKey, "claimingPaused");
  assert.strictEqual(crankFrozen.tooltipKey, "frozenCrankTooltip");

  // 13c. Timelocked
  const crankTimelocked = getCrankActionCapability({
    pool: { isFrozenForDraw: false },
    isTimelocked: true,
    isCranking: false,
  });
  assert.strictEqual(crankTimelocked.canExecute, false);
  assert.strictEqual(crankTimelocked.disabledReason, "timelocked");
  assert.strictEqual(crankTimelocked.buttonLabelKey, "reinvest");

  // 13d. Ready to crank
  const crankReady = getCrankActionCapability({
    pool: { isFrozenForDraw: false },
    isTimelocked: false,
    isCranking: false,
  });
  assert.strictEqual(crankReady.canExecute, true);
  assert.strictEqual(crankReady.disabledReason, undefined);
  assert.strictEqual(crankReady.buttonLabelKey, "reinvest");

  console.log("✅ All Draw Helpers & SDK Unit Tests Passed Successfully!");
}

runTests().catch((err) => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
