import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
  VALID_DRAW_STATUS_FILTERS,
  sanitizeDrawStatusFilter,
  getDrawStatusTranslationKey,
  getPayoutTimelockState,
  getClaimWinningsCapability,
  getCrankActionCapability,
  getDrawArchetype,
  hasPayoutRegistryPda,
  isHaltedStatus,
  isDrawStatusName,
  getSkippedDrawReason,
  getNoRandomnessExplanationKey,
  invalidateDrawQueries,
  buildDrawWinnerPermalink,
  formatWinnerShareMessage,
} from "../app/lib/draw-helpers";
import { bondsKeys } from "../app/lib/query-keys";
import type { QueryClient } from "@tanstack/react-query";
import {
  chunkArray,
  DrawCycleInfo,
  PayoutRegistryInfo,
} from "../app/lib/bonds-sdk";
import { address } from "@solana/kit";

const mockAddress1 = address("11111111111111111111111111111111");
const mockAddress2 = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const mockAddress3 = address("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function createMockDrawCycle(
  overrides: Partial<DrawCycleInfo> = {}
): DrawCycleInfo {
  return {
    poolId: 1,
    cycleId: 14,
    status: "Complete",
    prizePot: 100_000_000n,
    cycleFeeCollected: 1_000_000n,
    lockedTicketCount: 50_000,
    harvestSlot: 240_500_100n,
    initiatedAt: 1723800000n,
    completedAt: 1723900000n,
    randomnessAccount: mockAddress1,
    randomnessSeed: new Uint8Array(32).fill(7),
    ...overrides,
  };
}

function createMockPayoutRegistry(
  overrides: Partial<PayoutRegistryInfo> = {}
): PayoutRegistryInfo {
  return {
    poolId: 1,
    cycleId: 14,
    status: 0,
    winnersCount: 2,
    payoutsCompleted: 1,
    revealedAt: 1723900000n,
    winners: [
      {
        winner: mockAddress1,
        amountOwed: 50_000_000n,
        bondsBought: 10,
        processed: 1,
        tierIndex: 0,
      },
      {
        winner: mockAddress2,
        amountOwed: 25_000_000n,
        bondsBought: 5,
        processed: 0,
        tierIndex: 1,
      },
    ],
    ...overrides,
  };
}

describe("Draw Helpers & SDK Architecture Suite", () => {
  it("should split items accurately with chunkArray", () => {
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
  });

  it("should format draw cycle summary accurately", () => {
    const dummyDrawCycle = createMockDrawCycle();
    const dummyPayout = createMockPayoutRegistry();

    const summary = formatDrawCycleSummary(dummyDrawCycle, dummyPayout);
    assert.strictEqual(summary.cycleId, 14);
    assert.strictEqual(summary.prizePot, 100_000_000);
    assert.strictEqual(summary.revealedAt, 1723900000);
    assert.strictEqual(summary.winnersCount, 2);
    assert.strictEqual(summary.payoutsCompleted, 1);
    assert.strictEqual(summary.hasPayoutRegistry, true);
  });

  it("should calculate multi-tier slotInTier with parseWinnersWithVrf", async () => {
    const dummyMultiTierPayout = createMockPayoutRegistry({
      winnersCount: 3,
      payoutsCompleted: 0,
      winners: [
        {
          winner: mockAddress1,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 0,
          tierIndex: 0, // slotInTier = 0
        },
        {
          winner: mockAddress2,
          amountOwed: 25_000_000n,
          bondsBought: 5,
          processed: 0,
          tierIndex: 1, // slotInTier = 0 (first runner-up)
        },
        {
          winner: mockAddress3,
          amountOwed: 25_000_000n,
          bondsBought: 5,
          processed: 0,
          tierIndex: 1, // slotInTier = 1 (second runner-up)
        },
      ],
    });

    const dummyDrawCycle = createMockDrawCycle();
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
  });

  it("should resolve draw date timestamp", () => {
    const ts1 = getDrawDateTimestamp(1723900000, 1723950000, 14, 14);
    assert.strictEqual(ts1, 1723900000);

    const ts2 = getDrawDateTimestamp(undefined, 1724000000, 15, 14, 604800);
    assert.strictEqual(ts2, 1724000000 - 604800);
  });

  it("should support Draw Cycle #0 formatting and VRF range generation", async () => {
    const cycle0Draw = createMockDrawCycle({
      cycleId: 0,
      prizePot: 25_000_000n,
      cycleFeeCollected: 250_000n,
      lockedTicketCount: 1_000,
      harvestSlot: 100_000n,
      initiatedAt: 1699990000n,
      completedAt: 1700000000n,
      randomnessSeed: new Uint8Array(32).fill(42),
    });

    const cycle0Payout = createMockPayoutRegistry({
      cycleId: 0,
      winnersCount: 1,
      payoutsCompleted: 1,
      revealedAt: 1700000000n,
      winners: [
        {
          winner: mockAddress1,
          amountOwed: 25_000_000n,
          bondsBought: 5,
          processed: 1,
          tierIndex: 0,
        },
      ],
    });

    const summary0 = formatDrawCycleSummary(cycle0Draw, cycle0Payout);
    assert.strictEqual(summary0.cycleId, 0);
    assert.strictEqual(summary0.prizePot, 25_000_000);
    assert.strictEqual(summary0.status, "Complete");

    const winners0 = await parseWinnersWithVrf(cycle0Payout, cycle0Draw);
    assert.strictEqual(winners0.length, 1);
    assert.ok(winners0[0].winningTicketIndex !== undefined);
    assert.ok(winners0[0].winningTicketIndex! < 1_000);
  });

  it("should resolve draw cycle timestamps and format display dates", () => {
    // Completed draw with completedAt
    const res1 = resolveDrawCycleTimestamp({
      completedAt: 1723900000,
      initiatedAt: 1723800000,
      cycleId: 14,
    });
    assert.strictEqual(res1.timestamp, 1723900000);
    assert.strictEqual(res1.isEstimated, false);

    // In-flight draw with initiatedAt only
    const res2 = resolveDrawCycleTimestamp({
      initiatedAt: 1723800000,
      completedAt: 0,
      cycleId: 15,
    });
    assert.strictEqual(res2.timestamp, 1723800000);
    assert.strictEqual(res2.isEstimated, false);

    // Skipped/Voided draw without PayoutRegistry but with completedAt
    const res3 = resolveDrawCycleTimestamp({
      initiatedAt: 1723800000,
      completedAt: 1723800000,
      cycleId: 12,
    });
    assert.strictEqual(res3.timestamp, 1723800000);
    assert.strictEqual(res3.isEstimated, false);

    // Fallback estimated calculation
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

    // formatDrawDisplayDate formatting
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
  });

  it("should evaluate VRF randomness presence and zero-seed conditions", () => {
    const validSeed = new Uint8Array(32).fill(1);
    const zeroSeed = new Uint8Array(32);

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
  });

  it("should calculate prior dust applied accurately", () => {
    // Winner won 2 USDC, bought 1 bond at 5 USDC -> 3 USDC prior dust used
    assert.strictEqual(
      calculatePriorDustApplied(1, 2_000_000, 5_000_000),
      3_000_000
    );

    // Winner won 10 USDC, bought 2 bonds at 5 USDC -> 0 prior dust used
    assert.strictEqual(calculatePriorDustApplied(2, 10_000_000, 5_000_000), 0);

    // Winner won 7 USDC, bought 2 bonds at 5 USDC -> 3 USDC prior dust used
    assert.strictEqual(
      calculatePriorDustApplied(2, 7_000_000, 5_000_000),
      3_000_000
    );

    // Explicit usedPriorDust parameter override
    assert.strictEqual(
      calculatePriorDustApplied(2, 7_000_000, 5_000_000, 4_500_000),
      4_500_000
    );
  });

  it("should build dynamic faceted draw status options according to domain invariants", () => {
    const mockTranslations: Record<string, string> = {
      allStatuses: "All Statuses",
      statusComplete: "Complete",
      statusAwaitingVRF: "Awaiting VRF",
      statusAwaitingYield: "Awaiting Yield",
      statusSkipped: "Skipped",
      statusForceUnlocked: "Force Unlocked",
      statusVoided: "Voided",
      statusHaltedInsolvent: "Halted: Insolvency",
      statusHaltedYieldSpike: "Halted: Yield Spike",
    };
    const mockT = (key: string) => mockTranslations[key] || key;

    // 1. Empty / Undefined Fallback: returns "All Statuses" without crashing when statusCounts is undefined or {}
    const undefinedOptions = buildDrawStatusOptions({
      statusCounts: undefined,
      currentFilter: "all",
      t: mockT,
    });
    assert.strictEqual(undefinedOptions.length, 1);
    assert.deepStrictEqual(undefinedOptions[0], {
      value: "all",
      label: "All Statuses",
    });

    const emptyCountsOptions = buildDrawStatusOptions({
      statusCounts: {},
      currentFilter: "all",
      t: mockT,
    });
    assert.strictEqual(emptyCountsOptions.length, 1);
    assert.deepStrictEqual(emptyCountsOptions[0], {
      value: "all",
      label: "All Statuses\u00A0(0)",
    });

    // 2. Zero-Count Omission: only statuses with count > 0 appear (dormant intervention states excluded)
    const sparseCounts = {
      Complete: 42,
      Skipped: 3,
      ForceUnlocked: 0,
      Voided: 0,
      HaltedInsolvent: 0,
    };
    const sparseOptions = buildDrawStatusOptions({
      statusCounts: sparseCounts,
      currentFilter: "all",
      t: mockT,
    });
    assert.strictEqual(sparseOptions.length, 3);
    assert.deepStrictEqual(sparseOptions, [
      { value: "all", label: "All Statuses\u00A0(45)" },
      { value: "Complete", label: "Complete\u00A0(42)" },
      { value: "Skipped", label: "Skipped\u00A0(3)" },
    ]);

    // 3. Deep-Link Zero-Count Invariant: active filter with count = 0 is appended with \u00A0(0)
    const deepLinkZeroOptions = buildDrawStatusOptions({
      statusCounts: { Complete: 10 },
      currentFilter: "Voided",
      t: mockT,
    });
    assert.strictEqual(deepLinkZeroOptions.length, 3);
    assert.deepStrictEqual(deepLinkZeroOptions, [
      { value: "all", label: "All Statuses\u00A0(10)" },
      { value: "Complete", label: "Complete\u00A0(10)" },
      { value: "Voided", label: "Voided\u00A0(0)" },
    ]);

    // 4. Active Filter with Count: active filter with count > 0 is not duplicated
    const deepLinkWithCountOptions = buildDrawStatusOptions({
      statusCounts: { Complete: 10, Skipped: 2 },
      currentFilter: "Skipped",
      t: mockT,
    });
    assert.strictEqual(deepLinkWithCountOptions.length, 3);
    assert.deepStrictEqual(deepLinkWithCountOptions, [
      { value: "all", label: "All Statuses\u00A0(12)" },
      { value: "Complete", label: "Complete\u00A0(10)" },
      { value: "Skipped", label: "Skipped\u00A0(2)" },
    ]);

    // 5. Canonical Ordering: order follows CANONICAL_DRAW_STATUS_ORDER regardless of object key order
    const reverseOrderCounts = {
      HaltedYieldSpike: 1,
      Voided: 2,
      Skipped: 3,
      Complete: 4,
    };
    const orderedOptions = buildDrawStatusOptions({
      statusCounts: reverseOrderCounts,
      currentFilter: "all",
      t: mockT,
    });
    assert.deepStrictEqual(
      orderedOptions.map((o) => o.value),
      ["all", "Complete", "Skipped", "Voided", "HaltedYieldSpike"]
    );

    // 6. Granular Halts: HaltedInsolvent and HaltedYieldSpike render independently
    const haltsOptions = buildDrawStatusOptions({
      statusCounts: { HaltedInsolvent: 1, HaltedYieldSpike: 2 },
      currentFilter: "all",
      t: mockT,
    });
    assert.deepStrictEqual(haltsOptions, [
      { value: "all", label: "All Statuses\u00A0(3)" },
      { value: "HaltedInsolvent", label: "Halted: Insolvency\u00A0(1)" },
      { value: "HaltedYieldSpike", label: "Halted: Yield Spike\u00A0(2)" },
    ]);

    // 7. en-US Number Formatting: large counts format with commas
    const largeCountOptions = buildDrawStatusOptions({
      statusCounts: { Complete: 1234567, Skipped: 1000 },
      currentFilter: "all",
      t: mockT,
    });
    assert.deepStrictEqual(largeCountOptions, [
      { value: "all", label: "All Statuses\u00A0(1,235,567)" },
      { value: "Complete", label: "Complete\u00A0(1,234,567)" },
      { value: "Skipped", label: "Skipped\u00A0(1,000)" },
    ]);

    // 8. Deterministic Unknown Status Fallback: unknown future statuses appear at end, sorted alphabetically
    const unknownStatusOptions = buildDrawStatusOptions({
      statusCounts: {
        Complete: 5,
        ZetaUpgrade: 2,
        AlphaUpgrade: 1,
      },
      currentFilter: "BetaUpgrade",
      t: mockT,
    });
    assert.deepStrictEqual(
      unknownStatusOptions.map((o) => o.value),
      ["all", "Complete", "AlphaUpgrade", "ZetaUpgrade", "BetaUpgrade"]
    );
    assert.deepStrictEqual(
      unknownStatusOptions.map((o) => o.label),
      [
        "All Statuses\u00A0(8)",
        "Complete\u00A0(5)",
        "AlphaUpgrade\u00A0(1)",
        "ZetaUpgrade\u00A0(2)",
        "BetaUpgrade\u00A0(0)",
      ]
    );

    // 9. Derived Array Parity & Single Source of Truth
    assert.strictEqual(VALID_DRAW_STATUS_FILTERS[0], "all");
    assert.deepStrictEqual(VALID_DRAW_STATUS_FILTERS.slice(1), [
      ...CANONICAL_DRAW_STATUS_ORDER,
    ]);
    assert.strictEqual(VALID_DRAW_STATUS_FILTERS.length, 9);

    // 10. Sanitization Helper: sanitizeDrawStatusFilter
    assert.strictEqual(sanitizeDrawStatusFilter("Complete"), "Complete");
    assert.strictEqual(sanitizeDrawStatusFilter("all"), "all");
    assert.strictEqual(
      sanitizeDrawStatusFilter("HaltedInsolvent"),
      "HaltedInsolvent"
    );
    assert.strictEqual(
      sanitizeDrawStatusFilter("HaltedYieldSpike"),
      "HaltedYieldSpike"
    );
    assert.strictEqual(sanitizeDrawStatusFilter("Halted"), "all"); // Legacy alias rejected
    assert.strictEqual(sanitizeDrawStatusFilter("MaliciousStatus"), "all");
    assert.strictEqual(sanitizeDrawStatusFilter(""), "all");
    assert.strictEqual(sanitizeDrawStatusFilter(null), "all");
    assert.strictEqual(sanitizeDrawStatusFilter(undefined), "all");
    assert.strictEqual(sanitizeDrawStatusFilter(123), "all");
    assert.strictEqual(sanitizeDrawStatusFilter({}), "all");

    // Translation Key Lookup & Canonical Array integrity
    assert.strictEqual(
      getDrawStatusTranslationKey("AwaitingRandomness"),
      "statusAwaitingVRF"
    );
    assert.strictEqual(
      getDrawStatusTranslationKey("Complete"),
      "statusComplete"
    );
    assert.strictEqual(
      getDrawStatusTranslationKey("NonExistentStatus"),
      undefined
    );
    assert.strictEqual(CANONICAL_DRAW_STATUS_ORDER.length, 8);
  });

  it("should calculate payout timelock state correctly", () => {
    // Missing or invalid revealedAt
    const noRevealed = getPayoutTimelockState(undefined, 300, 1723900100);
    assert.strictEqual(noRevealed.isTimelocked, false);
    assert.strictEqual(noRevealed.remainingSeconds, 0);
    assert.strictEqual(noRevealed.formattedRemaining, "00:00");
    assert.strictEqual(noRevealed.formattedUnlockTime, "—");
    assert.strictEqual(noRevealed.progressPercent, 100);

    // Active timelock mid-way
    const activeTimelock = getPayoutTimelockState(1000, 300, 1100);
    assert.strictEqual(activeTimelock.isTimelocked, true);
    assert.strictEqual(activeTimelock.remainingSeconds, 200);
    assert.strictEqual(activeTimelock.formattedRemaining, "03:20");
    assert.strictEqual(activeTimelock.progressPercent, 33);
    assert.strictEqual(activeTimelock.timelockExpiresAt, 1300);

    // Exact expiration boundary
    const exactEndTimelock = getPayoutTimelockState(1000, 300, 1300);
    assert.strictEqual(exactEndTimelock.isTimelocked, false);
    assert.strictEqual(exactEndTimelock.remainingSeconds, 0);
    assert.strictEqual(exactEndTimelock.progressPercent, 100);
  });

  it("should evaluate claim winnings and crank action capabilities", () => {
    // Claiming in progress
    const capClaiming = getClaimWinningsCapability({
      pool: { isFrozenForDraw: false },
      unclaimedAmount: 10_000_000,
      isClaiming: true,
    });
    assert.strictEqual(capClaiming.canExecute, false);
    assert.strictEqual(capClaiming.disabledReason, "in_progress");

    // Frozen for draw
    const capFrozen = getClaimWinningsCapability({
      pool: { isFrozenForDraw: true },
      unclaimedAmount: 10_000_000,
      isClaiming: false,
    });
    assert.strictEqual(capFrozen.canExecute, false);
    assert.strictEqual(capFrozen.disabledReason, "frozen_for_draw");

    // Ready to claim
    const capReady = getClaimWinningsCapability({
      pool: { isFrozenForDraw: false },
      unclaimedAmount: 5_000_000,
      isClaiming: false,
    });
    assert.strictEqual(capReady.canExecute, true);

    // Cranking capability
    const crankReady = getCrankActionCapability({
      pool: { isFrozenForDraw: false },
      isTimelocked: false,
      isCranking: false,
    });
    assert.strictEqual(crankReady.canExecute, true);

    const crankTimelocked = getCrankActionCapability({
      pool: { isFrozenForDraw: false },
      isTimelocked: true,
      isCranking: false,
    });
    assert.strictEqual(crankTimelocked.canExecute, false);
    assert.strictEqual(crankTimelocked.disabledReason, "timelocked");
  });

  it("should classify all 8 draw statuses into canonical domain archetypes", () => {
    // Archetype 1: payout-bearing
    assert.strictEqual(getDrawArchetype("Complete"), "payout-bearing");
    assert.strictEqual(getDrawArchetype("Voided"), "payout-bearing");

    // Archetype 2: skipped
    assert.strictEqual(getDrawArchetype("Skipped"), "skipped");

    // Archetype 3: in-flight
    assert.strictEqual(getDrawArchetype("AwaitingYield"), "in-flight");
    assert.strictEqual(getDrawArchetype("AwaitingRandomness"), "in-flight");

    // Archetype 4: intervention
    assert.strictEqual(getDrawArchetype("ForceUnlocked"), "intervention");
    assert.strictEqual(getDrawArchetype("HaltedInsolvent"), "intervention");
    assert.strictEqual(getDrawArchetype("HaltedYieldSpike"), "intervention");
  });

  it("should determine PayoutRegistry PDA presence accurately", () => {
    assert.strictEqual(hasPayoutRegistryPda("Complete"), true);
    assert.strictEqual(hasPayoutRegistryPda("Voided"), true);
    assert.strictEqual(hasPayoutRegistryPda("Skipped"), false);
    assert.strictEqual(hasPayoutRegistryPda("AwaitingYield"), false);
    assert.strictEqual(hasPayoutRegistryPda("AwaitingRandomness"), false);
    assert.strictEqual(hasPayoutRegistryPda("ForceUnlocked"), false);
    assert.strictEqual(hasPayoutRegistryPda("HaltedInsolvent"), false);
    assert.strictEqual(hasPayoutRegistryPda("HaltedYieldSpike"), false);
  });

  it("should identify circuit breaker halted statuses", () => {
    assert.strictEqual(isHaltedStatus("HaltedInsolvent"), true);
    assert.strictEqual(isHaltedStatus("HaltedYieldSpike"), true);
    assert.strictEqual(isHaltedStatus("Complete"), false);
    assert.strictEqual(isHaltedStatus("Skipped"), false);
    assert.strictEqual(isHaltedStatus("ForceUnlocked"), false);
  });

  it("should validate DrawStatusName at runtime with isDrawStatusName", () => {
    for (const status of CANONICAL_DRAW_STATUS_ORDER) {
      assert.strictEqual(isDrawStatusName(status), true);
    }
    assert.strictEqual(isDrawStatusName("UnknownStatus"), false);
    assert.strictEqual(isDrawStatusName(123), false);
    assert.strictEqual(isDrawStatusName(null), false);
    assert.strictEqual(isDrawStatusName(undefined), false);
  });

  it("should correctly classify skipped draw reasons and explanation keys", () => {
    // Pure count classification
    assert.strictEqual(
      getSkippedDrawReason({ lockedTicketCount: 0 }),
      "zero-tickets"
    );
    assert.strictEqual(
      getSkippedDrawReason({ lockedTicketCount: 0n }),
      "zero-tickets"
    );
    assert.strictEqual(
      getSkippedDrawReason({ lockedTicketCount: undefined }),
      "zero-tickets"
    );
    assert.strictEqual(
      getSkippedDrawReason({ lockedTicketCount: -5 }),
      "zero-tickets"
    );
    assert.strictEqual(
      getSkippedDrawReason({ lockedTicketCount: 50 }),
      "below-threshold"
    );
    assert.strictEqual(getSkippedDrawReason(undefined), "zero-tickets");

    // Status boundary checks
    assert.strictEqual(
      getSkippedDrawReason({ status: "Complete", lockedTicketCount: 50 }),
      undefined
    );
    assert.strictEqual(
      getSkippedDrawReason({ status: "Skipped", lockedTicketCount: 0 }),
      "zero-tickets"
    );
    assert.strictEqual(
      getSkippedDrawReason({ status: "Skipped", lockedTicketCount: 100 }),
      "below-threshold"
    );

    // No-randomness translation key resolution
    assert.strictEqual(
      getNoRandomnessExplanationKey({
        status: "Skipped",
        lockedTicketCount: 0,
      }),
      "noRandomnessSkippedNoTicketsSub"
    );
    assert.strictEqual(
      getNoRandomnessExplanationKey({
        status: "Skipped",
        lockedTicketCount: 500,
      }),
      "noRandomnessSkippedSub"
    );
    assert.strictEqual(
      getNoRandomnessExplanationKey({
        status: "Complete",
        lockedTicketCount: 500,
      }),
      "noRandomnessGeneralSub"
    );
    assert.strictEqual(
      getNoRandomnessExplanationKey({
        status: "HaltedInsolvent",
        lockedTicketCount: 500,
      }),
      "noRandomnessGeneralSub"
    );
  });

  it("should invalidate both draws and poolState queries immediately and after trailing debounce", async () => {
    const invalidatedKeys: unknown[] = [];
    const mockQueryClient = {
      invalidateQueries: (options: { queryKey: readonly unknown[] }) => {
        invalidatedKeys.push(options.queryKey);
      },
    } as unknown as QueryClient;

    invalidateDrawQueries(mockQueryClient, 1, { trailingGracePeriodMs: 25 });

    // Immediate check
    assert.strictEqual(invalidatedKeys.length, 2);
    assert.deepStrictEqual(invalidatedKeys[0], bondsKeys.draws(1));
    assert.deepStrictEqual(invalidatedKeys[1], bondsKeys.poolState(1));

    // Wait for trailing debounce timer
    await new Promise((r) => setTimeout(r, 40));

    assert.strictEqual(invalidatedKeys.length, 4);
    assert.deepStrictEqual(invalidatedKeys[2], bondsKeys.draws(1));
    assert.deepStrictEqual(invalidatedKeys[3], bondsKeys.poolState(1));
  });

  it("should build draw winner permalink with fallback or origin", () => {
    const link = buildDrawWinnerPermalink(14, 2);
    assert.ok(link.includes("/dashboard/draws?cycle=14&winner=2"));
  });

  it("should format winner share message with ticket number and amount", () => {
    const msg = formatWinnerShareMessage(
      14,
      {
        winnerIndex: 0,
        tierIndex: 0,
        amountOwed: 25_000_000,
        bondsBought: 5,
        winnerAddress: "11111111111111111111111111111111",
        processed: true,
        winningTicketIndex: 42,
      },
      6,
      "USDC"
    );
    assert.ok(msg.includes("Draw #14"));
    assert.ok(msg.includes("bond #42"));
    assert.ok(msg.includes("won 25.00 USDC"));
    assert.ok(msg.includes("/dashboard/draws?cycle=14&winner=0"));
  });

  it("should correctly handle filter resets and validate status options", () => {
    // Validate sanitizeDrawStatusFilter on valid, invalid, and reset values
    assert.strictEqual(sanitizeDrawStatusFilter("Complete"), "Complete");
    assert.strictEqual(sanitizeDrawStatusFilter("all"), "all");
    assert.strictEqual(sanitizeDrawStatusFilter(null), "all");
    assert.strictEqual(sanitizeDrawStatusFilter("InvalidStatus"), "all");

    // Validate buildDrawStatusOptions with status counts and reset filter
    const statusCounts = {
      Complete: 5,
      AwaitingRandomness: 2,
    };
    const mockT = ((key: string) => key) as any;
    const options = buildDrawStatusOptions({
      statusCounts,
      currentFilter: "all",
      t: mockT,
    });

    assert.ok(options.length > 0);
    assert.strictEqual(options[0].value, "all");
    assert.strictEqual(options[1].value, "Complete");
    assert.ok(options[1].label.includes("(5)"));
  });
});
