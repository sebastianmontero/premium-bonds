import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPoolState } from "../state/snapshot-classifier";
import { PoolStateSnapshot } from "../types";
import { DrawStatus } from "../../../app/lib/bonds-sdk";
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
      harvestSlot: 100n,
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
      harvestSlot: 100n,
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

  it("should classify as CIRCUIT_BREAKER_HALTED on solvency halt", () => {
    const pool = buildMockPrizePool({ ticketRegistry: mockRegistryAddress });
    const registry = buildMockTicketRegistry();
    const drawCycle = buildMockDrawCycle({
      status: DrawStatus.HaltedInsolvent,
      harvestSlot: 100n,
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
      "Pool must classify as CIRCUIT_BREAKER_HALTED when drawCycle status is HaltedInsolvent"
    );
  });
});
