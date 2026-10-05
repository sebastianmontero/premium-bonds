import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPoolState, isPoolStatus } from "../state/snapshot-classifier";
import { PoolStateSnapshot, toDrawCycleId } from "../types";
import { DrawStatus, PoolStatus } from "../../../app/lib/bonds-sdk";
import {
  buildMockPrizePool,
  buildMockTicketRegistry,
  buildMockDrawCycle,
  buildMockPayoutRegistry,
  TEST_ADDRESSES,
} from "@/app/lib/test-harness";

const mockPoolAddress = TEST_ADDRESSES.USER;
const mockRegistryAddress = TEST_ADDRESSES.ATA_PROGRAM;

function assertSnapshotState<TState extends PoolStateSnapshot["state"]>(
  snapshot: PoolStateSnapshot,
  expectedState: TState,
  message?: string
): asserts snapshot is Extract<PoolStateSnapshot, { state: TState }> {
  assert.strictEqual(
    snapshot.state,
    expectedState,
    message ||
      `Expected snapshot state to be ${expectedState}, got ${snapshot.state}`
  );
}

describe("Snapshot Classifier", () => {
  it("should classify as YIELD_HARVEST_READY when cycle is due and not frozen", () => {
    const pool = buildMockPrizePool({
      currentCycleEndAt: 1000n,
      isFrozenForDraw: 0,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      currentSlot: 500n,
      currentTimestamp: 1050n,
    });

    assertSnapshotState(
      snapshot,
      "YIELD_HARVEST_READY",
      "Pool must classify as YIELD_HARVEST_READY when currentTimestamp >= currentCycleEndAt"
    );
    assert.strictEqual(
      snapshot.currentCycleId,
      1,
      "Harvest snapshot must preserve active currentCycleId"
    );
  });

  it("should classify as PREPARE_BATCHING when frozen and drawPreparedUpTo < userCount", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 1,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry({
      userCount: 50,
      drawPreparedUpTo: 20,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(
      snapshot,
      "PREPARE_BATCHING",
      "Pool must classify as PREPARE_BATCHING when frozen with incomplete user batches"
    );
    assert.strictEqual(
      snapshot.cursor,
      20,
      "PREPARE_BATCHING snapshot must accurately reflect batch cursor"
    );
    assert.strictEqual(
      snapshot.total,
      50,
      "PREPARE_BATCHING snapshot must accurately reflect total users"
    );
  });

  it("should classify as READY_TO_DRAW when prepared and awaiting randomness within 1000 slots", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 1,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.AwaitingRandomness,
      vrfSeedSlot: 100n,
      randomnessAccount: mockPoolAddress,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 600n, // elapsed: 500 slots <= 1000
      currentTimestamp: 1000n,
    });

    assertSnapshotState(
      snapshot,
      "READY_TO_DRAW",
      "Pool must classify as READY_TO_DRAW when all users prepared and VRF within 1000 slots"
    );
    assert.strictEqual(
      snapshot.randomnessAccount,
      mockPoolAddress,
      "READY_TO_DRAW snapshot must propagate randomness account address"
    );
  });

  it("should classify as VRF_EXPIRED when randomness exceeds 1000 slots", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 1,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.AwaitingRandomness,
      vrfSeedSlot: 100n,
      randomnessAccount: mockPoolAddress,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 1200n, // elapsed: 1100 slots > 1000
      currentTimestamp: 1000n,
    });

    assertSnapshotState(
      snapshot,
      "VRF_EXPIRED",
      "Pool must classify as VRF_EXPIRED when randomness elapsed slots exceed 1000"
    );
    assert.strictEqual(
      snapshot.elapsedSlots,
      1100n,
      "VRF_EXPIRED snapshot must report correct elapsed slots"
    );
  });

  it("should accurately respect the exact 1000-slot freshness window boundary", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 1,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.AwaitingRandomness,
      vrfSeedSlot: 100n,
      randomnessAccount: mockPoolAddress,
    });

    // Boundary: Exactly 1000 slots elapsed (1100 - 100 = 1000) -> NOT expired (READY_TO_DRAW)
    const readySnapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 1100n,
      currentTimestamp: 1000n,
    });
    assertSnapshotState(readySnapshot, "READY_TO_DRAW");

    // Boundary: 1001 slots elapsed (1101 - 100 = 1001) -> EXPIRED (VRF_EXPIRED)
    const expiredSnapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 1101n,
      currentTimestamp: 1000n,
    });
    assertSnapshotState(expiredSnapshot, "VRF_EXPIRED");
  });

  it("should classify as TIMELOCK_WAITING and REINVESTMENT_PENDING accurately", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      payoutTimelockSeconds: 300,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const payoutRegistry = buildMockPayoutRegistry({
      revealedAt: 1000n,
      winnersCount: 1,
    });

    // Before timelock elapsed (1000 + 300 = 1300)
    const snapshotWaiting = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1200n, // < 1300n
    });
    assertSnapshotState(
      snapshotWaiting,
      "TIMELOCK_WAITING",
      "Snapshot must be TIMELOCK_WAITING before payoutTimelockSeconds expires"
    );

    // After timelock elapsed
    const snapshotPending = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1350n, // >= 1300n
    });
    assertSnapshotState(
      snapshotPending,
      "REINVESTMENT_PENDING",
      "Snapshot must be REINVESTMENT_PENDING after timelock expires with unclaimed winners"
    );
    assert.strictEqual(
      snapshotPending.unprocessedWinners.length,
      1,
      "REINVESTMENT_PENDING snapshot must include unprocessed winners count"
    );
  });

  it("should classify as CIRCUIT_BREAKER_HALTED on solvency halt when pool is paused", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Paused,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.HaltedInsolvent,
      vrfSeedSlot: 100n,
      prizePot: 0n,
      randomnessAccount: mockPoolAddress,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(
      snapshot,
      "CIRCUIT_BREAKER_HALTED",
      "Pool must classify as CIRCUIT_BREAKER_HALTED when paused and drawCycle status is HaltedInsolvent"
    );
    assert.strictEqual(snapshot.reason, "HaltedInsolvent");
  });

  it("should classify as CIRCUIT_BREAKER_HALTED on yield spike halt when pool is paused", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Paused,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.HaltedYieldSpike,
      vrfSeedSlot: 100n,
      prizePot: 0n,
      randomnessAccount: mockPoolAddress,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(
      snapshot,
      "CIRCUIT_BREAKER_HALTED",
      "Pool must classify as CIRCUIT_BREAKER_HALTED when paused and drawCycle status is HaltedYieldSpike"
    );
    assert.strictEqual(snapshot.reason, "HaltedYieldSpike");
  });

  it("should classify as POOL_PAUSED when pool is Paused and previous drawCycle is Complete", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Paused,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.Complete,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(snapshot, "POOL_PAUSED");
  });

  it("should classify as POOL_PAUSED when pool is Paused and drawCycle is null (unstarted cycle)", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Paused,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle: null,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(snapshot, "POOL_PAUSED");
  });

  it("should classify as YIELD_HARVEST_READY when pool is unpaused (Active) even if previous draw cycle was HaltedYieldSpike", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Active,
      currentCycleEndAt: 1000n,
      isFrozenForDraw: 0,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.HaltedYieldSpike,
      cycleId: 0,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1050n,
    });

    assertSnapshotState(
      snapshot,
      "YIELD_HARVEST_READY",
      "Unpaused Active pool must classify as YIELD_HARVEST_READY even if previous draw cycle recorded HaltedYieldSpike"
    );
  });

  it("should classify as IDLE when pool is unpaused (Active) and current cycle duration has not elapsed", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Active,
      currentCycleEndAt: 2000n,
      isFrozenForDraw: 0,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.HaltedInsolvent,
      cycleId: 0,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1050n,
    });

    assertSnapshotState(
      snapshot,
      "IDLE",
      "Active pool awaiting cycle duration must classify as IDLE regardless of past halted draw cycle"
    );
  });

  it("should prioritize REINVESTMENT_PENDING over YIELD_HARVEST_READY when harvest is due but winners remain unprocessed", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 1000n, // Harvest is due!
      payoutTimelockSeconds: 300,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const payoutRegistry = buildMockPayoutRegistry({
      revealedAt: 500n, // Timelock ready at 800n
      winners: [
        {
          winner: mockPoolAddress,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 0,
          tierIndex: 0,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
        {
          winner: mockRegistryAddress,
          amountOwed: 25_000_000n,
          bondsBought: 5,
          processed: 0,
          tierIndex: 1,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
      ],
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1500n, // Both timelock ready (1500 >= 800) and harvest due (1500 >= 1000)
    });

    assertSnapshotState(
      snapshot,
      "REINVESTMENT_PENDING",
      "Pending reinvestments must take priority over new yield harvest to prevent winner starvation"
    );
    assert.strictEqual(
      snapshot.unprocessedWinners.length,
      2,
      "Should have 2 unprocessed winners"
    );
  });

  it("should classify as POOL_PAUSED when pool.status is Paused", () => {
    const pool = buildMockPrizePool({
      status: PoolStatus.Paused,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(snapshot, "POOL_PAUSED");
  });

  it("should classify as IDLE or YIELD_HARVEST_READY when payoutRegistry is voided even with unprocessed winners", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const payoutRegistry = buildMockPayoutRegistry({
      status: 1, // Voided
      revealedAt: 500n,
      winners: [
        {
          winner: mockPoolAddress,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 0,
          tierIndex: 0,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
      ],
    });

    // Case A: cycle duration not elapsed -> IDLE
    const snapshotIdle = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1000n, // < 2000n
    });
    assertSnapshotState(snapshotIdle, "IDLE");

    // Case B: cycle duration elapsed -> YIELD_HARVEST_READY
    const snapshotHarvest = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 2500n, // >= 2000n
    });
    assertSnapshotState(snapshotHarvest, "YIELD_HARVEST_READY");
  });

  it("should classify as IDLE or YIELD_HARVEST_READY when matching drawCycle status is Voided", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      cycleId: 1,
      status: DrawStatus.Voided,
    });
    const payoutRegistry = buildMockPayoutRegistry({
      cycleId: 1,
      status: 0, // Active in registry, but drawCycle is Voided
      revealedAt: 500n,
      winners: [
        {
          winner: mockPoolAddress,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 0,
          tierIndex: 0,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
      ],
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });
    assertSnapshotState(snapshot, "IDLE");
  });

  it("should NOT treat prevPayoutPda as voided if only latestCycleId drawCycle was voided", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentDrawCycleId: 2,
      currentCycleEndAt: 2000n,
      payoutTimelockSeconds: 0,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      cycleId: 2, // Latest draw cycle is voided
      status: DrawStatus.Voided,
    });
    const payoutRegistry = buildMockPayoutRegistry({
      cycleId: 1, // Previous cycle payout registry is active
      status: 0,
      revealedAt: 500n,
      winners: [
        {
          winner: mockPoolAddress,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 0,
          tierIndex: 0,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
      ],
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });
    assertSnapshotState(snapshot, "REINVESTMENT_PENDING");
  });

  it("should attach latestPayoutRegistry to BaseSnapshot across IDLE and YIELD_HARVEST_READY states", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 1000n,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const payoutRegistry = buildMockPayoutRegistry({
      cycleId: 1,
      status: 0,
      revealedAt: 500n,
      winnersCount: 1,
      payoutsCompleted: 1,
      winners: [
        {
          winner: mockPoolAddress,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 1,
          tierIndex: 0,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
      ],
    });

    // IDLE state (currentTimestamp < currentCycleEndAt)
    const snapshotIdle = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 800n,
    });
    assertSnapshotState(snapshotIdle, "IDLE");
    assert.ok(snapshotIdle.latestPayoutRegistry);
    assert.strictEqual(
      snapshotIdle.latestPayoutRegistry.address,
      mockPoolAddress
    );

    // YIELD_HARVEST_READY state (currentTimestamp >= currentCycleEndAt)
    const snapshotHarvest = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1200n,
    });
    assertSnapshotState(snapshotHarvest, "YIELD_HARVEST_READY");
    assert.ok(snapshotHarvest.latestPayoutRegistry);
    assert.strictEqual(
      snapshotHarvest.latestPayoutRegistry.address,
      mockPoolAddress
    );
  });

  it("should never classify as YIELD_HARVEST_READY or REINVESTMENT_PENDING when pool.isFrozenForDraw === 1", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 1,
      currentCycleEndAt: 500n, // Timestamp is past due
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry({
      userCount: 10,
      drawPreparedUpTo: 10,
    });
    // DrawCycle in non-standard or complete status while frozen
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.Complete,
    });
    const payoutRegistry = buildMockPayoutRegistry({
      revealedAt: 100n,
      winners: [
        {
          winner: mockPoolAddress,
          amountOwed: 50_000_000n,
          bondsBought: 10,
          processed: 0,
          tierIndex: 0,
          version: 1,
          padding: new Uint8Array(1),
          reserved: new Uint8Array(8),
        },
      ],
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      payoutRegistryAddress: mockPoolAddress,
      payoutRegistry,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    // Must be sealed in IDLE and NEVER fall through to REINVESTMENT_PENDING or YIELD_HARVEST_READY
    assertSnapshotState(snapshot, "IDLE");
  });

  it("should classify as IDLE when drawCycle status is Skipped and not frozen", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.Skipped,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1000n, // < 2000n
    });

    assertSnapshotState(snapshot, "IDLE");
  });

  it("should classify as IDLE when previous draw was ForceUnlocked", () => {
    const pool = buildMockPrizePool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      ticketRegistry: mockRegistryAddress,
    });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.ForceUnlocked,
    });

    const snapshot = classifyPoolState({
      poolId: 1,
      poolAddress: mockPoolAddress,
      pool,
      ticketRegistryAddress: mockRegistryAddress,
      ticketRegistry: registry,
      drawCycle,
      currentSlot: 500n,
      currentTimestamp: 1000n,
    });

    assertSnapshotState(snapshot, "IDLE");
  });
});

describe("toDrawCycleId Validation", () => {
  it("should accept valid non-negative integers", () => {
    assert.strictEqual(toDrawCycleId(0), 0);
    assert.strictEqual(toDrawCycleId(1), 1);
    assert.strictEqual(toDrawCycleId(100), 100);
  });

  it("should throw RangeError for negative numbers or non-integers", () => {
    assert.throws(() => toDrawCycleId(-1), RangeError);
    assert.throws(() => toDrawCycleId(-10), RangeError);
    assert.throws(() => toDrawCycleId(1.5), RangeError);
    assert.throws(() => toDrawCycleId(NaN), RangeError);
  });
});

describe("isPoolStatus Helper", () => {
  it("should handle numeric, string, and __kind object status representations", () => {
    assert.strictEqual(
      isPoolStatus(PoolStatus.Active, PoolStatus.Active),
      true
    );
    assert.strictEqual(
      isPoolStatus(PoolStatus.Paused, PoolStatus.Active),
      false
    );
    assert.strictEqual(isPoolStatus("Active", PoolStatus.Active), true);
    assert.strictEqual(isPoolStatus("Paused", PoolStatus.Active), false);
    assert.strictEqual(
      isPoolStatus({ __kind: "Active" }, PoolStatus.Active),
      true
    );
    assert.strictEqual(
      isPoolStatus({ __kind: "Paused" }, PoolStatus.Active),
      false
    );
    assert.strictEqual(isPoolStatus(null, PoolStatus.Active), false);
    assert.strictEqual(isPoolStatus(undefined, PoolStatus.Active), false);
  });
});
