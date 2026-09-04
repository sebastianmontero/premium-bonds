import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { address } from "@solana/kit";
import { classifyPoolState } from "../state/snapshot-classifier";
import { PoolStateSnapshot } from "../types";
import {
  PrizePool,
  TicketRegistry,
  DrawCycle,
  PayoutRegistry,
  DrawStatus,
  PoolStatus,
} from "../../../app/lib/bonds-sdk";

const mockPoolAddress = address("11111111111111111111111111111111");
const mockRegistryAddress = address(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

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

function createMockPool(overrides: Partial<PrizePool> = {}): PrizePool {
  return {
    discriminator: new Uint8Array(8),
    bondPrice: 1_000_000n,
    stakeCycleDurationHrs: 24n,
    minYieldThreshold: 5_000_000n,
    totalDepositedPrincipal: 100_000_000n,
    currentCycleEndAt: 1000n,
    nextRedemptionId: 1n,
    totalFeesAccrued: 0n,
    totalFeesWithdrawn: 0n,
    totalPrizesAllocated: 0n,
    totalPendingRedemptions: 0n,
    totalPrizesDistributed: 0n,
    poolId: 1,
    currentDrawCycleId: 1,
    feeBasisPoints: 250,
    maxYieldBasisPoints: 500,
    payoutTimelockSeconds: 300,
    vaultAuthorityBump: 254,
    status: PoolStatus.Active,
    isFrozenForDraw: 0,
    version: 1,
    prizeTiersCount: 1,
    padding: new Uint8Array(6),
    feeWallet: mockPoolAddress,
    tokenMint: mockPoolAddress,
    ticketRegistry: mockRegistryAddress,
    prizeTiers: [],
    reserved: new Uint8Array(64),
    ...overrides,
  };
}

function createMockRegistry(
  overrides: Partial<TicketRegistry> = {}
): TicketRegistry {
  return {
    discriminator: new Uint8Array(8),
    poolId: 1,
    drawCycleId: 1,
    version: 1,
    userCount: 10,
    capacity: 100,
    totalActiveTickets: 500,
    totalPendingTickets: 0,
    drawPreparedUpTo: 10,
    padding: new Uint8Array(4),
    reserved: new Uint8Array(64),
    ...overrides,
  };
}

describe("Snapshot Classifier", () => {
  it("should classify as YIELD_HARVEST_READY when cycle is due and not frozen", () => {
    const pool = createMockPool({
      currentCycleEndAt: 1000n,
      isFrozenForDraw: 0,
    });
    const registry = createMockRegistry();

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
    const pool = createMockPool({
      isFrozenForDraw: 1,
    });
    const registry = createMockRegistry({
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
    const pool = createMockPool({
      isFrozenForDraw: 1,
    });
    const registry = createMockRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle = {
      poolId: 1,
      drawCycleId: 1,
      bump: 255,
      version: 1,
      status: DrawStatus.AwaitingRandomness,
      harvestSlot: 100n,
      harvestTimestamp: 1000n,
      prizePot: 50_000_000n,
      eligibleLockedCount: 500,
      totalWinnersCount: 3,
      padding: new Uint8Array(4),
      randomnessAccount: mockPoolAddress,
      randomnessSeed: new Uint8Array(32),
      reserved: new Uint8Array(64),
    } as unknown as DrawCycle;

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
    const pool = createMockPool({
      isFrozenForDraw: 1,
    });
    const registry = createMockRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle = {
      poolId: 1,
      drawCycleId: 1,
      bump: 255,
      version: 1,
      status: DrawStatus.AwaitingRandomness,
      harvestSlot: 100n,
      harvestTimestamp: 1000n,
      prizePot: 50_000_000n,
      eligibleLockedCount: 500,
      totalWinnersCount: 3,
      padding: new Uint8Array(4),
      randomnessAccount: mockPoolAddress,
      randomnessSeed: new Uint8Array(32),
      reserved: new Uint8Array(64),
    } as unknown as DrawCycle;

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
    const pool = createMockPool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      payoutTimelockSeconds: 300,
    });
    const registry = createMockRegistry();
    const payoutRegistry = {
      poolId: 1,
      drawCycleId: 1,
      bump: 255,
      version: 1,
      status: 0,
      revealedAt: 1000n,
      totalPrizesDistributed: 10_000_000n,
      winnersCount: 1,
      padding: new Uint8Array(4),
      winners: [
        {
          winner: mockPoolAddress,
          prizeAmount: 10_000_000n,
          winningTicket: 100n,
          tierIndex: 0,
          isReinvested: 0,
          isClaimed: 0,
          padding: new Uint8Array(6),
        },
      ],
      reserved: new Uint8Array(64),
    } as unknown as PayoutRegistry;

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
    const pool = createMockPool();
    const registry = createMockRegistry();
    const drawCycle = {
      poolId: 1,
      drawCycleId: 1,
      bump: 255,
      version: 1,
      status: DrawStatus.HaltedInsolvent,
      harvestSlot: 100n,
      harvestTimestamp: 1000n,
      prizePot: 0n,
      eligibleLockedCount: 0,
      totalWinnersCount: 0,
      padding: new Uint8Array(4),
      randomnessAccount: mockPoolAddress,
      randomnessSeed: new Uint8Array(32),
      reserved: new Uint8Array(64),
    } as unknown as DrawCycle;

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
