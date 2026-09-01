import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { address, generateKeyPairSigner, KeyPairSigner } from "@solana/kit";
import { HarvestYieldWorker } from "../workers/harvest-yield.worker";
import { PrepareDrawWorker } from "../workers/prepare-draw.worker";
import { RebindRandomnessWorker } from "../workers/rebind-randomness.worker";
import { AtomicRevealWorker } from "../workers/atomic-reveal.worker";
import { ReinvestWinningsWorker } from "../workers/reinvest-winnings.worker";
import { CapacitySentinelWorker } from "../workers/capacity-sentinel.worker";
import { DisburseSentinelWorker } from "../workers/disburse-sentinel.worker";
import { MockVrfProvider } from "../vrf/randomness-provider";
import {
  CrankExecutionContext,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
} from "../types";
import {
  PrizePool,
  TicketRegistry,
  PayoutRegistry,
} from "../../../app/lib/bonds-sdk";

const mockAddress = address("11111111111111111111111111111111");

function createMockContext(signer: KeyPairSigner): CrankExecutionContext {
  return {
    signer,
    rpcUrl: "http://127.0.0.1:8899",
    maxPrepareBatchSize: 200,
    maxReinvestBatchSize: 5,
    enableAutoDisburse: true,
    dryRun: true,
  };
}

describe("Strategy Workers Unit Tests", () => {
  it("HarvestYieldWorker should evaluate due harvest and report 150k CU", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = new MockVrfProvider();
    const worker = new HarvestYieldWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: {} as PrizePool,
      ticketRegistryAddress: mockAddress,
      ticketRegistry: {} as TicketRegistry,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "YIELD_HARVEST_READY" as const,
      currentCycleId: toDrawCycleId(1),
    };

    const decision = worker.evaluate(snapshot, ctx);
    assert.strictEqual(decision.shouldExecute, true);
    assert.match(decision.reason, /ready for yield harvest/);
    assert.strictEqual(worker.getComputeUnitLimit(), 150_000);
  });

  it("PrepareDrawWorker should compute exact batch size and trigger execution", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const worker = new PrepareDrawWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: {} as PrizePool,
      ticketRegistryAddress: mockAddress,
      ticketRegistry: {} as TicketRegistry,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "PREPARE_BATCHING" as const,
      cycleId: toDrawCycleId(1),
      cursor: 100,
      total: 350,
    };

    const decision = worker.evaluate(snapshot, ctx);
    assert.strictEqual(decision.shouldExecute, true);
    assert.match(decision.reason, /200 users/);
    assert.strictEqual(worker.getComputeUnitLimit(), 150_000);
  });

  it("RebindRandomnessWorker should trigger rebind on expired VRF", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = new MockVrfProvider();
    const worker = new RebindRandomnessWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: {} as PrizePool,
      ticketRegistryAddress: mockAddress,
      ticketRegistry: {} as TicketRegistry,
      currentSlot: 1500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "VRF_EXPIRED" as const,
      cycleId: toDrawCycleId(1),
      staleRandomness: mockAddress,
      elapsedSlots: 1100n,
    };

    const decision = worker.evaluate(snapshot, ctx);
    assert.strictEqual(decision.shouldExecute, true);
    assert.match(decision.reason, /expired after 1100 slots/);
    assert.strictEqual(worker.getComputeUnitLimit(), 120_000);
  });

  it("AtomicRevealWorker should evaluate ready draw and report 500k CU", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = new MockVrfProvider();
    const worker = new AtomicRevealWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: {} as PrizePool,
      ticketRegistryAddress: mockAddress,
      ticketRegistry: {} as TicketRegistry,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "READY_TO_DRAW" as const,
      cycleId: toDrawCycleId(1),
      randomnessAccount: mockAddress,
    };

    const decision = worker.evaluate(snapshot, ctx);
    assert.strictEqual(decision.shouldExecute, true);
    assert.match(decision.reason, /ready for atomic reveal/);
    assert.strictEqual(worker.getComputeUnitLimit(), 500_000);
  });

  it("ReinvestWinningsWorker should cap batch size to maxReinvestBatchSize", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const worker = new ReinvestWinningsWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: {} as PrizePool,
      ticketRegistryAddress: mockAddress,
      ticketRegistry: {} as TicketRegistry,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "REINVESTMENT_PENDING" as const,
      cycleId: toDrawCycleId(1),
      payoutRegistryAddress: mockAddress,
      payoutRegistry: {} as PayoutRegistry,
      unprocessedWinners: [
        { winner: mockAddress, winnerIndex: 0 },
        { winner: mockAddress, winnerIndex: 1 },
        { winner: mockAddress, winnerIndex: 2 },
        { winner: mockAddress, winnerIndex: 3 },
        { winner: mockAddress, winnerIndex: 4 },
        { winner: mockAddress, winnerIndex: 5 },
        { winner: mockAddress, winnerIndex: 6 },
      ],
    };

    const decision = worker.evaluate(snapshot, ctx);
    assert.strictEqual(decision.shouldExecute, true);
    assert.match(decision.reason, /batch of 5 winners/);
    assert.strictEqual(worker.getComputeUnitLimit(snapshot), 400_000);
  });

  it("CapacitySentinelWorker should trigger only above 85% utilization when not frozen", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new CapacitySentinelWorker();

    const baseSnapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      ticketRegistryAddress: mockAddress,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    // 80% utilization -> should NOT trigger
    const snapshot80 = {
      ...baseSnapshot,
      pool: { isFrozenForDraw: 0 } as PrizePool,
      ticketRegistry: { userCount: 80, capacity: 100 } as TicketRegistry,
    };
    const decision80 = sentinel.evaluate(snapshot80, ctx);
    assert.strictEqual(decision80.shouldExecute, false);

    // 90% utilization -> should trigger
    const snapshot90 = {
      ...baseSnapshot,
      pool: { isFrozenForDraw: 0 } as PrizePool,
      ticketRegistry: { userCount: 90, capacity: 100 } as TicketRegistry,
    };
    const decision90 = sentinel.evaluate(snapshot90, ctx);
    assert.strictEqual(decision90.shouldExecute, true);
    assert.match(decision90.reason, /90.0%/);

    // 90% utilization but pool is frozen -> should NOT trigger
    const snapshotFrozen = {
      ...baseSnapshot,
      pool: { isFrozenForDraw: 1 } as PrizePool,
      ticketRegistry: { userCount: 90, capacity: 100 } as TicketRegistry,
    };
    const decisionFrozen = sentinel.evaluate(snapshotFrozen, ctx);
    assert.strictEqual(decisionFrozen.shouldExecute, false);
  });

  it("DisburseSentinelWorker should evaluate settled redemptions", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: { tokenMint: mockAddress } as PrizePool,
      ticketRegistryAddress: mockAddress,
      ticketRegistry: {} as TicketRegistry,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    const candidate = {
      redemptionId: 1n,
      user: mockAddress,
      humaRequestId: 5n,
    };

    const decision = sentinel.evaluate(snapshot, ctx, candidate);
    assert.strictEqual(decision.shouldExecute, true);
    assert.match(decision.reason, /Claiming settled redemption #1/);
  });
});
