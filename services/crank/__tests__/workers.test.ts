import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, KeyPairSigner } from "@solana/kit";
import { HarvestYieldWorker } from "../workers/harvest-yield.worker";
import { PrepareDrawWorker } from "../workers/prepare-draw.worker";
import { RebindRandomnessWorker } from "../workers/rebind-randomness.worker";
import { AtomicRevealWorker } from "../workers/atomic-reveal.worker";
import { ReinvestWinningsWorker } from "../workers/reinvest-winnings.worker";
import { CapacitySentinelWorker } from "../workers/capacity-sentinel.worker";
import { DisburseSentinelWorker } from "../workers/disburse-sentinel.worker";
import { MockVrfProvider } from "../vrf/randomness-provider";
import { RedemptionType, ATA_PROGRAM_ID } from "@/app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
} from "../types";
import {
  buildMockPrizePool,
  buildMockTicketRegistry,
  buildMockPayoutRegistry,
  TEST_ADDRESSES,
} from "@/app/lib/test-harness";

const mockAddress = TEST_ADDRESSES.USER;

function createMockContext(signer: KeyPairSigner): CrankExecutionContext {
  return {
    signer,
    rpcUrl: "http://127.0.0.1:8899",
    maxPrepareBatchSize: 500,
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
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "YIELD_HARVEST_READY" as const,
      currentCycleId: toDrawCycleId(1),
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, true);
    if (outcome.shouldExecute) {
      assert.match(outcome.reason, /ready for yield harvest/);
      assert.strictEqual(outcome.computeUnitLimit, 150_000);
      assert.strictEqual(outcome.instructions.length, 1);
    }
  });

  it("PrepareDrawWorker should compute exact batch size and trigger execution", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const worker = new PrepareDrawWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "PREPARE_BATCHING" as const,
      cycleId: toDrawCycleId(1),
      cursor: 100,
      total: 350,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, true);
    if (outcome.shouldExecute) {
      assert.match(outcome.reason, /250 users/);
      assert.strictEqual(outcome.computeUnitLimit, 100_000);
      assert.strictEqual(outcome.instructions.length, 1);
    }
  });

  it("RebindRandomnessWorker should trigger rebind on expired VRF", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = new MockVrfProvider();
    const worker = new RebindRandomnessWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 1500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "VRF_EXPIRED" as const,
      cycleId: toDrawCycleId(1),
      staleRandomness: mockAddress,
      elapsedSlots: 1100n,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, true);
    if (outcome.shouldExecute) {
      assert.match(outcome.reason, /expired after 1100 slots/);
      assert.strictEqual(outcome.computeUnitLimit, 120_000);
      assert.strictEqual(outcome.instructions.length, 1);
    }
  });

  it("AtomicRevealWorker should evaluate ready draw and report 800k CU", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = new MockVrfProvider();
    const worker = new AtomicRevealWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "READY_TO_DRAW" as const,
      cycleId: toDrawCycleId(1),
      randomnessAccount: mockAddress,
      harvestSlot: 100n,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, true);
    if (outcome.shouldExecute) {
      assert.match(outcome.reason, /ready for atomic reveal/);
      assert.strictEqual(outcome.computeUnitLimit, 800_000);
      assert.strictEqual(outcome.instructions.length, 1);
    }
  });

  it("ReinvestWinningsWorker should cap batch size to maxReinvestBatchSize", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const worker = new ReinvestWinningsWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "REINVESTMENT_PENDING" as const,
      cycleId: toDrawCycleId(1),
      payoutRegistryAddress: mockAddress,
      payoutRegistry: buildMockPayoutRegistry({
        winnersCount: 0,
        payoutsCompleted: 0,
        revealedAt: 0n,
      }),
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

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, true);
    if (outcome.shouldExecute) {
      assert.match(outcome.reason, /batch of 5 winners/);
      assert.strictEqual(outcome.computeUnitLimit, 400_000);
      assert.strictEqual(outcome.instructions.length, 5);
    }
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
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 80,
        capacity: 100,
      }),
    };
    const outcome80 = await sentinel.evaluate(snapshot80, ctx);
    assert.strictEqual(outcome80.shouldExecute, false);

    // 90% utilization -> should trigger
    const snapshot90 = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 90,
        capacity: 100,
      }),
    };
    const outcome90 = await sentinel.evaluate(snapshot90, ctx);
    assert.strictEqual(outcome90.shouldExecute, true);
    if (outcome90.shouldExecute) {
      assert.match(outcome90.reason, /90.0%/);
      assert.strictEqual(outcome90.computeUnitLimit, 80_000);
    }

    // 90% utilization but pool is frozen -> should NOT trigger
    const snapshotFrozen = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 1 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 90,
        capacity: 100,
      }),
    };
    const outcomeFrozen = await sentinel.evaluate(snapshotFrozen, ctx);
    assert.strictEqual(outcomeFrozen.shouldExecute, false);
  });

  it("DisburseSentinelWorker should short circuit on zero pending redemptions", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ totalPendingRedemptions: 0n }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    const outcome = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.match(outcome.reason, /No pending redemptions/);
  });

  it("DisburseSentinelWorker batching should cap at MAX_REDEMPTIONS_PER_TX = 3 and include 800k CU limit", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({
        tokenMint: mockAddress,
        totalPendingRedemptions: 5n,
      }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    const candidates = [
      {
        redemptionId: 1n,
        user: mockAddress,
        humaRequestId: 1n,
        redemptionType: RedemptionType.BondSale,
      },
      {
        redemptionId: 2n,
        user: mockAddress,
        humaRequestId: 2n,
        redemptionType: RedemptionType.BondSale,
      },
      {
        redemptionId: 3n,
        user: mockAddress,
        humaRequestId: 3n,
        redemptionType: RedemptionType.BondSale,
      },
      {
        redemptionId: 4n,
        user: mockAddress,
        humaRequestId: 4n,
        redemptionType: RedemptionType.BondSale,
      },
    ];

    const ixs = await sentinel.buildInstructionsForBatch(
      snapshot,
      ctx,
      candidates.slice(0, 3)
    );
    // Each BondSale redemption has 2 instructions (ATA creation + claim) = 6 instructions
    assert.strictEqual(ixs.length, 6);
    assert.strictEqual(ixs[0].programAddress, ATA_PROGRAM_ID);
    assert.strictEqual(sentinel.getComputeUnitLimit(), 800_000);
  });
});
