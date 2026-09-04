import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapDrawHistoryRowsToSummaries,
  calculateDrawHistoryStats,
  isTerminalDrawStatus,
  type DrawCycleSummaryDto,
} from "../indexer-mappers";
import type { drawHistory } from "../db/schema";
import { buildDrawCyclesWithPayoutsQuery } from "../../../app/api/indexer/draws/queries";

describe("Draw Payout Progress & Stats Suite", () => {
  it("should accurately map draw rows with 0 payouts completed", () => {
    const mockRows: (typeof drawHistory.$inferSelect & {
      payoutsCompleted: number;
    })[] = [
      {
        poolId: 1,
        cycleId: 1,
        status: "Complete",
        prizePot: BigInt(100_000_000),
        cycleFeeCollected: BigInt(5_000_000),
        lockedTicketCount: BigInt(500),
        harvestSlot: 123456,
        randomnessAccount: "Random1111111111111111111111111111111111111",
        vrfSeedHex: "0x1234567890abcdef",
        winnersCount: 8,
        totalDistributed: BigInt(0),
        winnersSynced: true,
        initiatedAt: 1772500000,
        revealedAt: 1772500300,
        completedAt: 1772500600,
        signature: "Sig1111111111111111111111111111111111111111",
        blockTime: 1772500000,
        createdAt: new Date(),
        payoutsCompleted: 0,
      },
    ];

    const summaries = mapDrawHistoryRowsToSummaries(mockRows);
    assert.strictEqual(summaries.length, 1);
    assert.strictEqual(summaries[0].cycleId, 1);
    assert.strictEqual(summaries[0].winnersCount, 8);
    assert.strictEqual(summaries[0].payoutsCompleted, 0);
    assert.strictEqual(summaries[0].hasPayoutRegistry, true);
    assert.strictEqual(summaries[0].completedAt, 1772500600);
  });

  it("should accurately map partial and fully processed payouts", () => {
    const mockRows: (typeof drawHistory.$inferSelect & {
      payoutsCompleted: number;
    })[] = [
      {
        poolId: 1,
        cycleId: 2,
        status: "Complete",
        prizePot: BigInt(200_000_000),
        cycleFeeCollected: BigInt(10_000_000),
        lockedTicketCount: BigInt(1000),
        harvestSlot: 234567,
        randomnessAccount: "Random2222222222222222222222222222222222222",
        vrfSeedHex: "0xabcdef1234567890",
        winnersCount: 8,
        totalDistributed: BigInt(75_000_000),
        winnersSynced: true,
        initiatedAt: 1772600000,
        revealedAt: 1772600300,
        completedAt: 1772600600,
        signature: "Sig2222222222222222222222222222222222222222",
        blockTime: 1772600000,
        createdAt: new Date(),
        payoutsCompleted: 3,
      },
      {
        poolId: 1,
        cycleId: 3,
        status: "Complete",
        prizePot: BigInt(300_000_000),
        cycleFeeCollected: BigInt(15_000_000),
        lockedTicketCount: BigInt(1500),
        harvestSlot: 345678,
        randomnessAccount: "Random3333333333333333333333333333333333333",
        vrfSeedHex: "0x9876543210fedcba",
        winnersCount: 8,
        totalDistributed: BigInt(300_000_000),
        winnersSynced: true,
        initiatedAt: 1772700000,
        revealedAt: 1772700300,
        completedAt: 1772700600,
        signature: "Sig3333333333333333333333333333333333333333",
        blockTime: 1772700000,
        createdAt: new Date(),
        payoutsCompleted: 8,
      },
    ];

    const summaries = mapDrawHistoryRowsToSummaries(mockRows);
    assert.strictEqual(summaries[0].payoutsCompleted, 3);
    assert.strictEqual(summaries[1].payoutsCompleted, 8);
  });

  it("should defensively clamp payoutsCompleted to [0, winnersCount]", () => {
    const mockRows: (typeof drawHistory.$inferSelect & {
      payoutsCompleted: number;
    })[] = [
      {
        poolId: 1,
        cycleId: 4,
        status: "Complete",
        prizePot: BigInt(50_000_000),
        cycleFeeCollected: BigInt(2_500_000),
        lockedTicketCount: BigInt(250),
        harvestSlot: 456789,
        randomnessAccount: "Random4444444444444444444444444444444444444",
        vrfSeedHex: "0x1122334455667788",
        winnersCount: 5,
        totalDistributed: BigInt(50_000_000),
        winnersSynced: true,
        initiatedAt: 1772800000,
        revealedAt: 1772800300,
        completedAt: 1772800600,
        signature: "Sig4444444444444444444444444444444444444444",
        blockTime: 1772800000,
        createdAt: new Date(),
        payoutsCompleted: 10, // Overflow count from edge case
      },
      {
        poolId: 1,
        cycleId: 5,
        status: "Complete",
        prizePot: BigInt(50_000_000),
        cycleFeeCollected: BigInt(2_500_000),
        lockedTicketCount: BigInt(250),
        harvestSlot: 567890,
        randomnessAccount: "Random5555555555555555555555555555555555555",
        vrfSeedHex: "0x8877665544332211",
        winnersCount: 5,
        totalDistributed: BigInt(0),
        winnersSynced: true,
        initiatedAt: 1772900000,
        revealedAt: 1772900300,
        completedAt: 1772900600,
        signature: "Sig5555555555555555555555555555555555555555",
        blockTime: 1772900000,
        createdAt: new Date(),
        payoutsCompleted: -3, // Negative number edge case
      },
    ];

    const summaries = mapDrawHistoryRowsToSummaries(mockRows);
    assert.strictEqual(summaries[0].payoutsCompleted, 5); // Clamped to winnersCount
    assert.strictEqual(summaries[1].payoutsCompleted, 0); // Clamped to 0
  });

  it("should handle Skipped, Voided, and ForceUnlocked terminal timestamps", () => {
    const mockRows: (typeof drawHistory.$inferSelect & {
      payoutsCompleted: number;
    })[] = [
      {
        poolId: 1,
        cycleId: 6,
        status: "Skipped",
        prizePot: BigInt(0),
        cycleFeeCollected: BigInt(0),
        lockedTicketCount: BigInt(0),
        harvestSlot: 678901,
        randomnessAccount: "",
        vrfSeedHex: "",
        winnersCount: 0,
        totalDistributed: BigInt(0),
        winnersSynced: true,
        initiatedAt: 1773000000,
        revealedAt: null,
        completedAt: null,
        signature: "Sig6666666666666666666666666666666666666666",
        blockTime: 1773000500,
        createdAt: new Date(),
        payoutsCompleted: 0,
      },
      {
        poolId: 1,
        cycleId: 7,
        status: "Voided",
        prizePot: BigInt(10_000_000),
        cycleFeeCollected: BigInt(500_000),
        lockedTicketCount: BigInt(100),
        harvestSlot: 789012,
        randomnessAccount: "Random7777777777777777777777777777777777777",
        vrfSeedHex: "",
        winnersCount: 0,
        totalDistributed: BigInt(0),
        winnersSynced: true,
        initiatedAt: 1773100000,
        revealedAt: null,
        completedAt: 1773100600,
        signature: "Sig7777777777777777777777777777777777777777",
        blockTime: 1773100000,
        createdAt: new Date(),
        payoutsCompleted: 0,
      },
    ];

    const summaries = mapDrawHistoryRowsToSummaries(mockRows);
    assert.strictEqual(summaries[0].status, "Skipped");
    assert.strictEqual(summaries[0].completedAt, 1773000500); // Falls back to blockTime
    assert.strictEqual(summaries[0].hasPayoutRegistry, false);

    assert.strictEqual(summaries[1].status, "Voided");
    assert.strictEqual(summaries[1].completedAt, 1773100600);
  });

  it("should accurately calculate draw history stats across Complete draws only", () => {
    const mockSummaries: DrawCycleSummaryDto[] = [
      {
        poolId: 1,
        cycleId: 1,
        status: "Complete",
        prizePot: 100_000_000,
        cycleFeeCollected: 5_000_000,
        lockedTicketCount: 500,
        harvestSlot: 100,
        randomnessAccount: "",
        vrfSeedHex: "",
        winnersCount: 8,
        payoutsCompleted: 8,
        hasPayoutRegistry: true,
        initiatedAt: 1000,
      },
      {
        poolId: 1,
        cycleId: 2,
        status: "Skipped",
        prizePot: 0,
        cycleFeeCollected: 0,
        lockedTicketCount: 0,
        harvestSlot: 200,
        randomnessAccount: "",
        vrfSeedHex: "",
        winnersCount: 0,
        payoutsCompleted: 0,
        hasPayoutRegistry: false,
        initiatedAt: 2000,
      },
      {
        poolId: 1,
        cycleId: 3,
        status: "Complete",
        prizePot: 200_000_000,
        cycleFeeCollected: 10_000_000,
        lockedTicketCount: 1000,
        harvestSlot: 300,
        randomnessAccount: "",
        vrfSeedHex: "",
        winnersCount: 8,
        payoutsCompleted: 4,
        hasPayoutRegistry: true,
        initiatedAt: 3000,
      },
    ];

    const stats = calculateDrawHistoryStats(mockSummaries);
    assert.strictEqual(stats.totalDrawsCompleted, 2);
    assert.strictEqual(stats.totalYieldDistributed, 300_000_000);
    assert.strictEqual(stats.totalWinningBonds, 16);
    assert.strictEqual(stats.averagePrizePot, 150_000_000);
  });

  it("should return zero stats for empty draw array", () => {
    const stats = calculateDrawHistoryStats([]);
    assert.strictEqual(stats.totalDrawsCompleted, 0);
    assert.strictEqual(stats.totalYieldDistributed, 0);
    assert.strictEqual(stats.totalWinningBonds, 0);
    assert.strictEqual(stats.averagePrizePot, 0);
  });

  it("should evaluate isTerminalDrawStatus correctly", () => {
    assert.strictEqual(isTerminalDrawStatus("Complete"), true);
    assert.strictEqual(isTerminalDrawStatus("Skipped"), true);
    assert.strictEqual(isTerminalDrawStatus("Voided"), true);
    assert.strictEqual(isTerminalDrawStatus("ForceUnlocked"), true);

    assert.strictEqual(isTerminalDrawStatus("AwaitingRandomness"), false);
    assert.strictEqual(isTerminalDrawStatus("AwaitingYield"), false);
    assert.strictEqual(isTerminalDrawStatus("HaltedInsolvent"), false);
    assert.strictEqual(isTerminalDrawStatus("HaltedYieldSpike"), false);
    assert.strictEqual(isTerminalDrawStatus("Unknown"), false);
  });

  it("should compile production draw query with correlated subquery and table-qualified columns", () => {
    const query = buildDrawCyclesWithPayoutsQuery(1, 10);
    const { sql: sqlString, params } = query.toSQL();

    // 1. Positive Assertions: Explicit table-qualified column correlation
    assert.match(
      sqlString,
      /"draw_winners"\."pool_id"\s*=\s*"draw_history"\."pool_id"/,
      "Must qualify pool_id across draw_winners and draw_history"
    );
    assert.match(
      sqlString,
      /"draw_winners"\."cycle_id"\s*=\s*"draw_history"\."cycle_id"/,
      "Must qualify cycle_id across draw_winners and draw_history"
    );
    assert.match(
      sqlString,
      /"draw_winners"\."processed"\s*=\s*true/,
      "Must filter by processed = true"
    );
    assert.match(
      sqlString,
      /coalesce\s*\(\s*\(\s*select count\(\*\)::int/i,
      "Must wrap subquery in COALESCE with integer count"
    );

    // 2. Negative Assertions: Guarantee elimination of subquery tautologies
    assert.doesNotMatch(
      sqlString,
      /WHERE\s+"pool_id"\s*=\s*"pool_id"/i,
      "Must not contain unqualified pool_id self-tautology"
    );
    assert.doesNotMatch(
      sqlString,
      /AND\s+"cycle_id"\s*=\s*"cycle_id"/i,
      "Must not contain unqualified cycle_id self-tautology"
    );

    // 3. Parameter Safety Assertions
    assert.deepStrictEqual(
      params,
      [1, 10],
      "Must parameterize poolId and limit"
    );
  });
});
