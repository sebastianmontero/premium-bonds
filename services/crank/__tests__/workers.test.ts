import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSigner, KeyPairSigner, AccountRole } from "@solana/kit";
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

function createMockContext(
  signer: KeyPairSigner,
  configOverrides?: Partial<CrankExecutionContext["config"]>
): CrankExecutionContext {
  return {
    signer,
    rpcUrl: "http://127.0.0.1:8899",
    maxPrepareBatchSize: 500,
    maxReinvestBatchSize: 5,
    enableAutoDisburse: true,
    dryRun: true,
    config: {
      rpcUrl: "http://127.0.0.1:8899",
      wsUrl: "ws://127.0.0.1:8899",
      poolIds: [1],
      pollIntervalMs: 15000,
      activeWindowPollIntervalMs: 1000,
      metricsPort: 9090,
      enableAutoDisburse: true,
      maxPrepareBatchSize: 500,
      maxReinvestBatchSize: 5,
      instanceIndex: 0,
      instanceJitterMs: 1200,
      jitoEnabled: false,
      jitoTipLamports: 10000n,
      maxJitoTipLamports: 100000n,
      humaLenderState: TEST_ADDRESSES.USER_2,
      humaPoolState: TEST_ADDRESSES.HUMA_POOL,
      humaPoolUnderlyingToken: TEST_ADDRESSES.USER,
      dryRun: true,
      ...configOverrides,
    },
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

    // Same-user batch: 1 ATA creation + 3 claims = 4 instructions
    const ixsSameUser = await sentinel.buildInstructionsForBatch(
      snapshot,
      ctx,
      candidates.slice(0, 3)
    );
    assert.strictEqual(ixsSameUser.length, 4);
    assert.strictEqual(ixsSameUser[0].programAddress, ATA_PROGRAM_ID);
    assert.strictEqual(sentinel.getComputeUnitLimit(), 800_000);

    // Multi-user batch: 3 distinct users -> 3 ATA creations + 3 claims = 6 instructions
    const user2 = (await generateKeyPairSigner()).address;
    const user3 = (await generateKeyPairSigner()).address;
    const multiUserCandidates = [
      {
        redemptionId: 1n,
        user: mockAddress,
        humaRequestId: 1n,
        redemptionType: RedemptionType.BondSale,
      },
      {
        redemptionId: 2n,
        user: user2,
        humaRequestId: 2n,
        redemptionType: RedemptionType.BondSale,
      },
      {
        redemptionId: 3n,
        user: user3,
        humaRequestId: 3n,
        redemptionType: RedemptionType.BondSale,
      },
    ];

    const ixsMultiUser = await sentinel.buildInstructionsForBatch(
      snapshot,
      ctx,
      multiUserCandidates
    );
    assert.strictEqual(ixsMultiUser.length, 6);
  });

  it("DisburseSentinelWorker should allow invalidating candidate cache", () => {
    const sentinel = new DisburseSentinelWorker();
    sentinel.invalidateCandidateCache(1);
    sentinel.invalidateCandidateCache();
  });

  it("DisburseSentinelWorker should short circuit before RPC candidate fetch if humaLenderState is unconfigured or SYSTEM_PROGRAM_ID", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer, {
      humaLenderState: undefined,
      poolHumaLenderStates: {},
    });
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

    const outcome = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.match(outcome.reason, /Huma lender state is not configured/);
  });

  it("DisburseSentinelWorker should select pool-specific humaLenderState from poolHumaLenderStates if configured", async () => {
    const signer = await generateKeyPairSigner();
    const poolSpecificLender = (await generateKeyPairSigner()).address;
    const ctx = createMockContext(signer, {
      humaLenderState: TEST_ADDRESSES.USER_2,
      poolHumaLenderStates: { 1: poolSpecificLender },
    });
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({
        tokenMint: mockAddress,
        totalPendingRedemptions: 1n,
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
    ];

    const ixs = await sentinel.buildInstructionsForBatch(
      snapshot,
      ctx,
      candidates
    );
    // Claim ix is index 1 (after ATA creation)
    const claimIx = ixs.find((ix) => ix.programAddress !== ATA_PROGRAM_ID);
    assert.ok(claimIx, "Claim instruction must be generated");
    const lenderMeta = claimIx.accounts?.find(
      (a) => a.address === poolSpecificLender
    );
    assert.ok(
      lenderMeta,
      "Claim instruction must contain pool-specific humaLenderState"
    );
    assert.strictEqual(lenderMeta.role, AccountRole.WRITABLE);
  });

  it("DisburseSentinelWorker should pass configured humaLenderState with AccountRole.WRITABLE in instruction accounts", async () => {
    const signer = await generateKeyPairSigner();
    const configuredLender = TEST_ADDRESSES.USER_2;
    const ctx = createMockContext(signer, {
      humaLenderState: configuredLender,
    });
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({
        tokenMint: mockAddress,
        totalPendingRedemptions: 1n,
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
    ];

    const ixs = await sentinel.buildInstructionsForBatch(
      snapshot,
      ctx,
      candidates
    );
    const claimIx = ixs.find((ix) => ix.programAddress !== ATA_PROGRAM_ID);
    assert.ok(claimIx, "Claim instruction must be generated");
    const lenderMeta = claimIx.accounts?.find(
      (a) => a.address === configuredLender
    );
    assert.ok(
      lenderMeta,
      "Claim instruction must contain configured humaLenderState"
    );
    assert.strictEqual(lenderMeta.role, AccountRole.WRITABLE);
  });
});
