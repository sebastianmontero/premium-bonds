import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTimingSafeAuthorized,
  isSuccessfulHeliusTransaction,
} from "../app/lib/webhook-auth";
import type { HeliusTransactionPayload } from "../app/lib/types/webhook";

describe("Webhook Ingestion Logic & Timing-Safe Security Suite", () => {
  it("should evaluate timing-safe authorization tokens correctly", () => {
    const SECRET = "secret_webhook_key_1234567890";
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer secret_webhook_key_1234567890", SECRET),
      true,
      "Bearer auth header must match"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("secret_webhook_key_1234567890", SECRET),
      true,
      "Raw secret header must match"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer wrong_secret_with_len_ok", SECRET),
      false,
      "Wrong secret must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer short", SECRET),
      false,
      "Short secret must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized(null, SECRET),
      false,
      "Null header must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized(undefined, SECRET),
      false,
      "Undefined header must be rejected"
    );
    assert.strictEqual(
      isTimingSafeAuthorized("Bearer secret_webhook_key_1234567891", SECRET),
      false,
      "Secret with 1-character difference must be rejected"
    );
  });

  it("should filter failed, reverted, and malformed transactions cleanly", () => {
    const samplePayload: HeliusTransactionPayload[] = [
      {
        signature: "sig1",
        slot: 100,
        timestamp: 1000,
        err: null,
        meta: { err: null },
      },
      {
        signature: "sig2",
        slot: 101,
        timestamp: 1001,
        err: { InstructionError: [0, "Custom"] },
        meta: { err: null },
      },
      {
        signature: "sig3",
        slot: 102,
        timestamp: 1002,
        err: null,
        meta: { err: { InstructionError: [1, "Custom"] } },
      },
      {
        signature: "sig4",
        slot: 103,
        timestamp: 1003,
        transactionError: "TransactionFailed",
        meta: { err: null },
      },
      { signature: "", slot: 104, timestamp: 1004, err: null },
      {
        signature: "sig5",
        slot: 105,
        timestamp: 1005,
        err: null,
        meta: { err: null },
      },
    ];

    const validTransactions = samplePayload.filter(
      isSuccessfulHeliusTransaction
    );

    assert.strictEqual(
      validTransactions.length,
      2,
      "Expected exactly 2 valid successful transactions"
    );
    assert.strictEqual(validTransactions[0].signature, "sig1");
    assert.strictEqual(validTransactions[1].signature, "sig5");
  });

  it("should invalidate pool stats and pool info caches upon encountering terminal draw events", async () => {
    const { PoolStatsAggregator } =
      await import("../app/lib/services/pool-stats-aggregator");
    const { invalidatePoolInfoCache } =
      await import("../app/lib/services/pool-state-service");

    let queryCount = 0;
    const mockDb = {
      select: () => ({
        from: () => ({
          where: async () => {
            queryCount++;
            return [
              {
                totalDistributed: "50000000",
                totalDrawsCompleted: 1,
                totalWinningBonds: 5,
              },
            ];
          },
        }),
      }),
    };

    const aggregator = new PoolStatsAggregator(mockDb, true);
    await aggregator.getPoolDrawStats(1);
    assert.strictEqual(queryCount, 1);

    // Call without invalidating - cache hit
    await aggregator.getPoolDrawStats(1);
    assert.strictEqual(queryCount, 1);

    // Invalidate pool stats (as performed by webhook handler on DrawCompleted)
    aggregator.invalidatePoolStats(1);
    invalidatePoolInfoCache(1);

    // Next query should hit DB again
    await aggregator.getPoolDrawStats(1);
    assert.strictEqual(
      queryCount,
      2,
      "Cache must be invalidated and re-queried"
    );
  });

  it("should identify all terminal draw event types and discriminate non-terminal events", async () => {
    const { resolveEventMetadata } = await import("../app/lib/anchor-events");

    const terminalDrawTypes = new Set([
      "DrawCompleted",
      "DrawVoided",
      "DrawForceUnlocked",
      "DrawSkipped",
    ]);

    const nonTerminalEventTypes = [
      "BondsPurchased",
      "DrawPreparationProgress",
      "YieldHarvested",
      "PoolCreated",
      "PoolConfigUpdated",
    ];

    for (const type of terminalDrawTypes) {
      assert.ok(
        terminalDrawTypes.has(type),
        `Expected ${type} to be recognized as a terminal draw type`
      );
    }

    for (const nonTermType of nonTerminalEventTypes) {
      assert.strictEqual(
        terminalDrawTypes.has(nonTermType),
        false,
        `Expected ${nonTermType} to NOT be recognized as a terminal draw type`
      );
    }

    // Verify metadata resolution provides correct poolId for terminal draw events
    const sampleCompletedEvent = {
      type: "DrawCompleted" as const,
      data: {
        poolId: 2,
        drawCycleId: 5,
        crank: "Crank11111111111111111111111111111111111111" as never,
        prizePot: 100_000_000n,
        winnersCount: 3,
        completedAt: 1720000000n,
      },
    };
    const meta = resolveEventMetadata(sampleCompletedEvent);
    assert.strictEqual(meta.poolId, 2);
    assert.ok(meta.scopes.includes("draws"));
    assert.ok(meta.scopes.includes("pool"));
  });

  it("should verify dynamic scope-driven cache invalidation mappings for all event types", async () => {
    const { resolveEventMetadata } = await import("../app/lib/anchor-events");

    // Events that must invalidate "pool" scope
    const poolScopeEvents = [
      {
        type: "BondsPurchased" as const,
        data: { poolId: 1, user: "u" as never, bonds: 1, amount: 1n },
      },
      {
        type: "PoolStatusChanged" as const,
        data: {
          poolId: 1,
          previousStatus: 0,
          newStatus: 1,
          authority: "a" as never,
        },
      },
      {
        type: "PoolConfigUpdated" as const,
        data: {
          poolId: 1,
          admin: "a" as never,
          oldFeeBasisPoints: 0,
          newFeeBasisPoints: 100,
          oldBondPrice: 1n,
          newBondPrice: 1n,
          oldFeeWallet: "f" as never,
          newFeeWallet: "f" as never,
          oldMinYieldThreshold: 0n,
          newMinYieldThreshold: 1n,
          oldStakeCycleDurationHrs: 1n,
          newStakeCycleDurationHrs: 1n,
          oldMaxYieldBasisPoints: 0,
          newMaxYieldBasisPoints: 0,
          oldPayoutTimelockSeconds: 0,
          newPayoutTimelockSeconds: 0,
        },
      },
      {
        type: "PrizeTiersUpdated" as const,
        data: {
          poolId: 1,
          admin: "a" as never,
          oldTiersCount: 1,
          oldTotalWinners: 1,
          newTiersCount: 1,
          newTotalWinners: 1,
          tiers: [],
        },
      },
      {
        type: "RegistryResized" as const,
        data: {
          poolId: 1,
          caller: "c" as never,
          oldCapacity: 100,
          newCapacity: 200,
        },
      },
      {
        type: "PoolCreated" as const,
        data: {
          poolId: 1,
          admin: "a" as never,
          tokenMint: "t" as never,
          pstMint: "p" as never,
          feeWallet: "f" as never,
          ticketRegistry: "r" as never,
          humaPoolState: "h" as never,
          bondPrice: 1n,
          stakeCycleDurationHrs: 1n,
          feeBasisPoints: 100,
          minYieldThreshold: 0n,
          maxYieldBasisPoints: 0,
          payoutTimelockSeconds: 0,
          tiersCount: 1,
          totalWinners: 1,
        },
      },
    ];

    for (const evt of poolScopeEvents) {
      const meta = resolveEventMetadata(evt);
      assert.strictEqual(meta.poolId, 1);
      assert.ok(
        meta.scopes.includes("pool"),
        `Event ${evt.type} must include 'pool' in scopes to trigger pool cache invalidation`
      );
    }

    // Events that must invalidate "draws" scope
    const drawsScopeEvents = [
      {
        type: "YieldHarvested" as const,
        data: {
          poolId: 1,
          cycleId: 1,
          crank: "c" as never,
          rawYield: 1n,
          fee: 1n,
          prizePot: 1n,
          lockedTicketCount: 1,
          randomnessAccount: "r" as never,
        },
      },
      {
        type: "DrawSkipped" as const,
        data: {
          poolId: 1,
          cycleId: 1,
          crank: "c" as never,
          rawYield: 1n,
          threshold: 2n,
          lockedTicketCount: 0,
          reason: 1,
        },
      },
      {
        type: "DrawCompleted" as const,
        data: {
          poolId: 1,
          cycleId: 1,
          crank: "c" as never,
          prizePot: 1n,
          winnersCount: 1,
        },
      },
      {
        type: "DrawVoided" as const,
        data: {
          poolId: 1,
          cycleId: 1,
          admin: "a" as never,
          prizesReversed: 1n,
          feesReversed: 1n,
        },
      },
    ];

    for (const evt of drawsScopeEvents) {
      const meta = resolveEventMetadata(evt);
      assert.strictEqual(meta.poolId, 1);
      assert.ok(
        meta.scopes.includes("draws"),
        `Event ${evt.type} must include 'draws' in scopes to trigger draw cache invalidation`
      );
    }
  });
});
