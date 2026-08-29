import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { address } from "@solana/kit";
import { classifyPoolState } from "../state/snapshot-classifier";
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

function createMockPool(overrides: Partial<PrizePool> = {}): PrizePool {
  return {
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
    admin: mockPoolAddress,
    tokenMint: mockPoolAddress,
    pstMint: mockPoolAddress,
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
    poolId: 1,
    bump: 255,
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

    assert.equal(snapshot.state, "YIELD_HARVEST_READY");
    if (snapshot.state === "YIELD_HARVEST_READY") {
      assert.equal(snapshot.currentCycleId, 1);
    }
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

    assert.equal(snapshot.state, "PREPARE_BATCHING");
    if (snapshot.state === "PREPARE_BATCHING") {
      assert.equal(snapshot.cursor, 20);
      assert.equal(snapshot.total, 50);
    }
  });

  it("should classify as READY_TO_DRAW when prepared and awaiting randomness within 1000 slots", () => {
    const pool = createMockPool({
      isFrozenForDraw: 1,
    });
    const registry = createMockRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle: DrawCycle = {
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
    };

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

    assert.equal(snapshot.state, "READY_TO_DRAW");
    if (snapshot.state === "READY_TO_DRAW") {
      assert.equal(snapshot.randomnessAccount, mockPoolAddress);
    }
  });

  it("should classify as VRF_EXPIRED when randomness exceeds 1000 slots", () => {
    const pool = createMockPool({
      isFrozenForDraw: 1,
    });
    const registry = createMockRegistry({
      userCount: 50,
      drawPreparedUpTo: 50,
    });
    const drawCycle: DrawCycle = {
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
    };

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

    assert.equal(snapshot.state, "VRF_EXPIRED");
    if (snapshot.state === "VRF_EXPIRED") {
      assert.equal(snapshot.elapsedSlots, 1100n);
    }
  });

  it("should classify as TIMELOCK_WAITING and REINVESTMENT_PENDING accurately", () => {
    const pool = createMockPool({
      isFrozenForDraw: 0,
      currentCycleEndAt: 2000n,
      payoutTimelockSeconds: 300,
    });
    const registry = createMockRegistry();
    const payoutRegistry: PayoutRegistry = {
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
    };

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
    assert.equal(snapshotWaiting.state, "TIMELOCK_WAITING");

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
    assert.equal(snapshotPending.state, "REINVESTMENT_PENDING");
    if (snapshotPending.state === "REINVESTMENT_PENDING") {
      assert.equal(snapshotPending.unprocessedWinners.length, 1);
    }
  });

  it("should classify as CIRCUIT_BREAKER_HALTED on solvency halt", () => {
    const pool = createMockPool();
    const registry = createMockRegistry();
    const drawCycle: DrawCycle = {
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
    };

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

    assert.equal(snapshot.state, "CIRCUIT_BREAKER_HALTED");
  });
});
