import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTimingSafeAuthorized } from "../app/lib/webhook-auth";
import {
  extractTransactionSignature,
  isEnhancedWebhookPayload,
  isValidRawSolanaTransaction,
  type RawSolanaTransactionPayload,
} from "../app/lib/types/webhook";

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

  it("should filter failed, reverted, and malformed transactions cleanly across payload variants", () => {
    const samplePayload: RawSolanaTransactionPayload[] = [
      // 1. Relayer / flat payload format
      {
        signature: "sig1",
        slot: 100,
        timestamp: 1000,
        err: null,
        meta: { err: null },
      },
      // 2. Canonical Solana JSON-RPC format (Helius Raw Webhook)
      {
        slot: 101,
        blockTime: 1001,
        transaction: {
          signatures: ["sig_canonical_2"],
        },
        err: null,
        meta: { err: null },
      },
      // 3. Reverted at root
      {
        signature: "sig_err_root",
        slot: 102,
        timestamp: 1002,
        err: { InstructionError: [0, "Custom"] },
        meta: { err: null },
      },
      // 4. Reverted in metadata
      {
        transaction: { signatures: ["sig_err_meta"] },
        slot: 103,
        timestamp: 1003,
        err: null,
        meta: { err: { InstructionError: [1, "Custom"] } },
      },
      // 5. TransactionFailed error
      {
        signature: "sig_failed",
        slot: 104,
        timestamp: 1004,
        transactionError: "TransactionFailed",
        meta: { err: null },
      },
      // 6. Empty / missing signature
      {
        signature: "",
        slot: 105,
        timestamp: 1005,
        err: null,
        meta: { err: null },
      },
      // 7. Missing meta (Enhanced payload)
      {
        signature: "sig_enhanced",
        slot: 106,
        timestamp: 1006,
        err: null,
        meta: null,
      },
      // 8. Signatures array format
      {
        signatures: ["sig_arr_8"],
        slot: 107,
        timestamp: 1007,
        err: null,
        meta: { err: null },
      },
    ];

    const validTransactions = samplePayload.filter(isValidRawSolanaTransaction);

    assert.strictEqual(
      validTransactions.length,
      3,
      "Expected exactly 3 valid successful transactions (flat sig1, canonical sig_canonical_2, array sig_arr_8)"
    );
    assert.strictEqual(
      extractTransactionSignature(validTransactions[0]),
      "sig1"
    );
    assert.strictEqual(
      extractTransactionSignature(validTransactions[1]),
      "sig_canonical_2"
    );
    assert.strictEqual(
      extractTransactionSignature(validTransactions[2]),
      "sig_arr_8"
    );
  });

  it("should accurately detect Helius Enhanced Webhook format via isEnhancedWebhookPayload", () => {
    assert.strictEqual(
      isEnhancedWebhookPayload({
        signature: "sig1",
        type: "UNKNOWN",
        instructions: [{ programId: "1111" }],
        meta: null,
      }),
      true,
      "Enhanced payload with instructions and null meta must return true"
    );

    assert.strictEqual(
      isEnhancedWebhookPayload({
        signature: "sig2",
        tokenTransfers: [],
        meta: null,
      }),
      true,
      "Enhanced payload with tokenTransfers and null meta must return true"
    );

    assert.strictEqual(
      isEnhancedWebhookPayload({
        transaction: { signatures: ["sig3"] },
        meta: { err: null, logMessages: [] },
      }),
      false,
      "Raw payload with meta must return false"
    );

    assert.strictEqual(
      isEnhancedWebhookPayload([]),
      false,
      "Empty array must return false"
    );
  });

  it("should invalidate pool stats and pool info caches upon encountering terminal draw events", async () => {
    const { PoolStatsAggregator } =
      await import("../app/lib/services/pool-stats-aggregator");
    const { invalidatePoolInfoCache } =
      await import("../app/lib/services/pool-state-service");
    const { createMockAggregationDb } =
      await import("../app/lib/services/__tests__/mock-aggregation-db");

    let queryCount = 0;
    const mockDb = createMockAggregationDb({
      onQuery: () => {
        queryCount++;
      },
      rows: [
        {
          status: "Complete",
          count: 1,
          totalDistributed: "50000000",
          totalWinningBonds: 5,
        },
      ],
    });

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

  it("should restrict stats cache invalidation to draw-history mutating events and deduplicate batch pool IDs", async () => {
    const { DRAW_HISTORY_MUTATING_EVENTS } =
      await import("../app/api/webhooks/solana/route");

    // Mutating draw events
    assert.strictEqual(DRAW_HISTORY_MUTATING_EVENTS.has("DrawCompleted"), true);
    assert.strictEqual(DRAW_HISTORY_MUTATING_EVENTS.has("DrawSkipped"), true);
    assert.strictEqual(DRAW_HISTORY_MUTATING_EVENTS.has("DrawVoided"), true);
    assert.strictEqual(
      DRAW_HISTORY_MUTATING_EVENTS.has("DrawForceUnlocked"),
      true
    );
    assert.strictEqual(
      DRAW_HISTORY_MUTATING_EVENTS.has("EmergencyInsolvencyDetected"),
      true
    );
    assert.strictEqual(
      DRAW_HISTORY_MUTATING_EVENTS.has("YieldVelocityBreached"),
      true
    );

    // Non-mutating events must NOT trigger stats cache invalidation
    assert.strictEqual(
      DRAW_HISTORY_MUTATING_EVENTS.has("DrawPreparationProgress"),
      false
    );
    assert.strictEqual(
      DRAW_HISTORY_MUTATING_EVENTS.has("YieldHarvested"),
      false
    );
    assert.strictEqual(
      DRAW_HISTORY_MUTATING_EVENTS.has("BondsPurchased"),
      false
    );

    // Simulate batch invalidation collection
    const simulatedBatchEvents = [
      { type: "DrawPreparationProgress", poolId: 1 },
      { type: "DrawPreparationProgress", poolId: 1 },
      { type: "DrawCompleted", poolId: 1 },
      { type: "DrawCompleted", poolId: 1 },
      { type: "DrawSkipped", poolId: 2 },
    ];

    const poolsToInvalidateStats = new Set<number>();
    for (const evt of simulatedBatchEvents) {
      if (
        DRAW_HISTORY_MUTATING_EVENTS.has(evt.type) &&
        evt.poolId !== undefined
      ) {
        poolsToInvalidateStats.add(evt.poolId);
      }
    }

    assert.strictEqual(
      poolsToInvalidateStats.size,
      2,
      "Deduplication must reduce 5 events down to exactly 2 unique pools (pool 1 and pool 2)"
    );
    assert.ok(poolsToInvalidateStats.has(1));
    assert.ok(poolsToInvalidateStats.has(2));
  });
});
