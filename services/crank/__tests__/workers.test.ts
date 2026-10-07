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
import { MockVrfProvider, IVrfProvider } from "../vrf/randomness-provider";
import {
  RedemptionType,
  ATA_PROGRAM_ID,
  PendingRedemptionCandidate,
} from "@/app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
  toSlot,
} from "../types";
import { createResilientRpc } from "@/app/lib/rpc-transport";
import {
  buildMockPrizePool,
  buildMockTicketRegistry,
  buildMockPayoutRegistry,
  TEST_ADDRESSES,
  createMockHumaAddresses,
} from "@/app/lib/test-harness";

const mockAddress = TEST_ADDRESSES.USER;

function createMockContext(
  signer: KeyPairSigner,
  configOverrides?: Partial<CrankExecutionContext["config"]>,
  rpcOverrides?: Record<string, unknown>
): CrankExecutionContext {
  const rpcUrl = configOverrides?.rpcUrl ?? "http://127.0.0.1:8899";
  const mockHuma = createMockHumaAddresses();
  const baseRpc = createResilientRpc(rpcUrl);
  const rpc = new Proxy(baseRpc, {
    get(target, prop, receiver) {
      if (rpcOverrides && prop in rpcOverrides) {
        return (rpcOverrides as Record<string | symbol, unknown>)[prop];
      }
      if (prop === "getBalance") {
        return () => ({
          send: async () => ({ value: 10_000_000_000n }),
        });
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return {
    signer,
    rpcUrl,
    rpc,
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
      humaLenderState: mockHuma.lenderState,
      humaPoolState: mockHuma.poolState,
      humaPoolUnderlyingToken: mockHuma.poolUnderlyingToken,
      humaConfig: mockHuma.config,
      humaPoolConfig: mockHuma.poolConfig,
      humaModeConfig: mockHuma.modeConfig,
      pstMint: mockHuma.modeMint,
      dryRun: true,
      ...configOverrides,
    },
  };
}

describe("Strategy Workers Unit Tests", () => {
  it("HarvestYieldWorker should evaluate due harvest and report 200k CU", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = new MockVrfProvider();
    const worker = new HarvestYieldWorker(vrf, ctx.config);

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
      assert.strictEqual(outcome.computeUnitLimit, 200_000);
      assert.strictEqual(outcome.instructions.length, 1);
    }
  });

  it("HarvestYieldWorker should skip before VRF preparation if PST mint or Huma pool state is missing", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer, { pstMint: undefined });
    let vrfCalled = false;
    const vrf = {
      async prepareHarvestRandomness() {
        vrfCalled = true;
        return {
          randomnessAccount: mockAddress,
          instructions: [],
          signers: [],
        };
      },
    } as unknown as IVrfProvider;
    const worker = new HarvestYieldWorker(vrf, {
      ...ctx.config!,
      pstMint: undefined,
    });

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ humaPoolState: undefined }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "YIELD_HARVEST_READY" as const,
      currentCycleId: toDrawCycleId(1),
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.match(
      outcome.reason,
      /Harvest skipped: PST mint or Huma pool state unconfigured/
    );
    assert.strictEqual(
      vrfCalled,
      false,
      "VRF preparation must not be called when unconfigured"
    );
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

  it("RebindRandomnessWorker should trigger rebind on expired VRF with 375k CU and propagate signers", async () => {
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
      assert.strictEqual(outcome.computeUnitLimit, 375_000);
      assert.strictEqual(outcome.instructions.length, 1);
      assert.ok(
        outcome.additionalSigners && outcome.additionalSigners.length > 0
      );
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
      vrfSeedSlot: 100n,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, true);
    if (outcome.shouldExecute) {
      assert.match(outcome.reason, /ready for atomic reveal/);
      assert.strictEqual(outcome.computeUnitLimit, 800_000);
      assert.strictEqual(outcome.instructions.length, 2);
    }
  });

  it("AtomicRevealWorker should handle pending_oracle with retryAfterMs: 2000", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = {
      prepareHarvestRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareRebindRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareReveal: async () => ({
        status: "pending_oracle" as const,
        reason: "Awaiting gateway oracle signature",
        retryAfterMs: 2000,
      }),
    };
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
      vrfSeedSlot: 100n,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.strictEqual(outcome.retryAfterMs, 2000);
    assert.match(outcome.reason, /Awaiting oracle proof/);
  });

  it("AtomicRevealWorker should retry on uncommitted randomness with 3s RPC retry", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = {
      prepareHarvestRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareRebindRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareReveal: async () => ({
        status: "uncommitted" as const,
        seedSlot: toSlot(0n),
        committedSeedSlot: toSlot(100n),
        reason: "seed_slot = 0",
      }),
    };
    const worker = new AtomicRevealWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 200n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "READY_TO_DRAW" as const,
      cycleId: toDrawCycleId(1),
      randomnessAccount: mockAddress,
      vrfSeedSlot: 100n,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.strictEqual(outcome.retryAfterMs, 3000);
    assert.match(outcome.reason, /Randomness uncommitted/);
  });

  it("AtomicRevealWorker should retry on transient mismatch then back off after MAX_RPC_MISMATCH_RETRIES", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = {
      prepareHarvestRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareRebindRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareReveal: async () => ({
        status: "mismatch" as const,
        seedSlot: toSlot(99n),
        committedSeedSlot: toSlot(100n),
        reason: "mismatch",
      }),
    };
    const worker = new AtomicRevealWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 200n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "READY_TO_DRAW" as const,
      cycleId: toDrawCycleId(1),
      randomnessAccount: mockAddress,
      vrfSeedSlot: 100n,
    };

    // Retry 1 (transient)
    const outcome1 = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome1.shouldExecute, false);
    assert.strictEqual(outcome1.retryAfterMs, 3000);
    assert.match(outcome1.reason, /retry 1\/2/);

    // Retry 2 (transient)
    const outcome2 = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome2.shouldExecute, false);
    assert.strictEqual(outcome2.retryAfterMs, 3000);
    assert.match(outcome2.reason, /retry 2\/2/);

    // Retry 3 (persistent mismatch -> backoff)
    const outcome3 = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome3.shouldExecute, false);
    // deltaSlots = 100 + 1000 + 1 - 200 = 901 slots -> 901 * 400 = 360400ms
    assert.strictEqual(outcome3.retryAfterMs, 901 * 400);
    assert.match(outcome3.reason, /Persistent randomness mismatch/);
  });

  it("AtomicRevealWorker should return shouldExecute: false on expired randomness", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const vrf = {
      prepareHarvestRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareRebindRandomness: async () => ({
        randomnessAccount: mockAddress,
        instructions: [],
      }),
      prepareReveal: async () => ({
        status: "expired" as const,
        elapsedSlots: toSlot(1100n),
        reason: "Window exceeded 1000 slots",
      }),
    };
    const worker = new AtomicRevealWorker(vrf);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool(),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 1500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "READY_TO_DRAW" as const,
      cycleId: toDrawCycleId(1),
      randomnessAccount: mockAddress,
      vrfSeedSlot: 100n,
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.match(outcome.reason, /Randomness expired/);
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
      payoutRegistry: {
        address: mockAddress,
        account: buildMockPayoutRegistry({
          winnersCount: 0,
          payoutsCompleted: 0,
          revealedAt: 0n,
        }),
      },
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

  it("ReinvestWinningsWorker should reject execution if payoutRegistry is voided", async () => {
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
      payoutRegistry: {
        address: mockAddress,
        account: buildMockPayoutRegistry({
          status: 1, // Voided
          winnersCount: 1,
          payoutsCompleted: 0,
          revealedAt: 100n,
        }),
      },
      unprocessedWinners: [{ winner: mockAddress, winnerIndex: 0 }],
    };

    const outcome = await worker.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.match(outcome.reason, /PayoutRegistry is voided/);
  });

  it("CapacitySentinelWorker should trigger when remainingSlots <= headroomThreshold", async () => {
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

    // Capacity 4,096, userCount 3,700 (remaining: 396 > 320 default threshold) -> should NOT trigger
    const snapshot3700 = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3700,
        capacity: 4096,
      }),
    };
    const outcome3700 = await sentinel.evaluate(snapshot3700, ctx);
    assert.strictEqual(outcome3700.shouldExecute, false);
    assert.match(
      outcome3700.reason,
      /Registry headroom is healthy: 396 slots remaining/
    );

    // Capacity 4,096, userCount 3,800 (remaining: 296 <= 320 threshold) -> should trigger
    const snapshot3800 = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3800,
        capacity: 4096,
      }),
    };
    const outcome3800 = await sentinel.evaluate(snapshot3800, ctx);
    assert.strictEqual(outcome3800.shouldExecute, true);
    if (outcome3800.shouldExecute) {
      assert.match(
        outcome3800.reason,
        /Registry headroom deficit: 296 slots remaining/
      );
      assert.match(outcome3800.reason, /\+160 slots/);
      assert.strictEqual(outcome3800.computeUnitLimit, 80_000);
      assert.strictEqual(outcome3800.retryAfterMs, undefined);
    }

    // Large scale: Capacity 100,000, userCount 85,000 (85% utilization, remaining 15,000 > 320)
    // Percentage model would have triggered; headroom model does NOT trigger!
    const snapshot85k = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 85_000,
        capacity: 100_000,
      }),
    };
    const outcome85k = await sentinel.evaluate(snapshot85k, ctx);
    assert.strictEqual(outcome85k.shouldExecute, false);
    assert.match(
      outcome85k.reason,
      /Registry headroom is healthy: 15000 slots remaining/
    );

    // Large scale: Capacity 100,000, userCount 99,700 (remaining: 300 <= 320) -> should trigger
    const snapshot99700 = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 99_700,
        capacity: 100_000,
      }),
    };
    const outcome99700 = await sentinel.evaluate(snapshot99700, ctx);
    assert.strictEqual(outcome99700.shouldExecute, true);

    // Deficit but pool is frozen for draw -> should NOT trigger
    const snapshotFrozen = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 1 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3800,
        capacity: 4096,
      }),
    };
    const outcomeFrozen = await sentinel.evaluate(snapshotFrozen, ctx);
    assert.strictEqual(outcomeFrozen.shouldExecute, false);
    assert.match(outcomeFrozen.reason, /Pool is frozen for draw/);
  });

  it("CapacitySentinelWorker should wait for RPC settle cooldown and never set retryAfterMs", async () => {
    let mockTime = 1_000_000;
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new CapacitySentinelWorker(
      undefined,
      undefined,
      () => mockTime
    );

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3900,
        capacity: 4096,
      }),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    // First eval -> triggers
    const outcome1 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome1.shouldExecute, true);

    // Crank executor succeeds -> commits target capacity 4256
    sentinel.onSuccess(1, "sig_123");

    // Second eval immediately with stale capacity 4096 -> awaiting RPC propagation
    const outcome2 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome2.shouldExecute, false);
    assert.strictEqual(
      outcome2.retryAfterMs,
      undefined,
      "Must NOT set retryAfterMs to avoid scheduler starvation"
    );
    assert.match(
      outcome2.reason,
      /Awaiting RPC propagation for recent expansion/
    );

    // Advance clock by 16s -> can trigger again
    mockTime += 16_000;
    const outcome3 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome3.shouldExecute, true);
  });

  it("CapacitySentinelWorker should skip and alert when hourly rate limit is reached without setting retryAfterMs", async () => {
    let mockTime = 1_000_000;
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const alerts: { eventType: string; message: string; severity?: string }[] =
      [];
    const mockNotifier = {
      notifyAlert: async (
        eventType: string,
        message: string,
        _poolId?: number,
        severity?: string
      ) => {
        alerts.push({ eventType, message, severity });
      },
      notifyLowBalance: async () => {},
    };

    // Configured max 3 expansions per hour, headroom threshold 160 (dynamic limit: 1 + 4 = 5)
    const sentinel = new CapacitySentinelWorker(
      mockNotifier,
      { maxExpansionsPerHour: 3, headroomSlots: 160, rpcCooldownMs: 1000 },
      () => mockTime
    );

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry({
        userCount: 4000,
        capacity: 4096,
      }),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    // Record 5 expansions to hit the hourly limit
    const throttler = sentinel.getThrottler();
    for (let i = 0; i < 5; i++) {
      throttler.recordExpansion(1, 4096 + (i + 1) * 160);
      mockTime += 2000; // pass RPC cooldown each time
    }

    // Now evaluate: should return false due to hourly rate limit, emit alert, and omit retryAfterMs
    const outcome = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.strictEqual(
      outcome.retryAfterMs,
      undefined,
      "Must NOT set retryAfterMs on rate limit"
    );
    assert.match(
      outcome.reason,
      /Hourly expansion rate limit exceeded for pool #1/
    );
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(
      alerts[0].eventType,
      "REGISTRY_EXPANSION_RATE_LIMIT_EXCEEDED"
    );
    assert.strictEqual(alerts[0].severity, "error");
  });

  it("CapacitySentinelWorker should cleanly purge pending state on onError, onDeferred, and reset", async () => {
    const mockTime = 1_000_000;
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new CapacitySentinelWorker(
      undefined,
      undefined,
      () => mockTime
    );

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3900,
        capacity: 4096,
      }),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    // 1. Evaluate triggers -> records pending target capacity
    const outcome1 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome1.shouldExecute, true);

    // 2. Transaction fails with onError -> purges pending state without recording expansion in throttler
    sentinel.onError(1, new Error("Tx simulation failure"));

    // Stale capacity 4096 is NOT awaiting RPC propagation because onError purged pending target before recording
    assert.strictEqual(
      sentinel.getThrottler().isAwaitingRpcPropagation(1, 4096),
      false
    );

    // 3. Evaluate triggers again -> records pending target capacity
    const outcome2 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome2.shouldExecute, true);

    // 4. Transaction is deferred with onDeferred -> purges pending state without recording expansion
    sentinel.onDeferred(1, {
      status: "CONCURRENCY_RACE_LOST",
      reason: "Blockhash expired",
    });
    assert.strictEqual(
      sentinel.getThrottler().isAwaitingRpcPropagation(1, 4096),
      false
    );

    // 5. Reset clears both pending map and throttler state
    sentinel.reset(1);
    assert.strictEqual(
      sentinel.getThrottler().isAwaitingRpcPropagation(1, 4096),
      false
    );
  });

  it("CapacitySentinelWorker should skip and alert when signer balance is below 0.15 SOL", async () => {
    const signer = await generateKeyPairSigner();
    const alerts: { eventType: string; message: string; severity?: string }[] =
      [];
    const mockNotifier = {
      notifyAlert: async (
        eventType: string,
        message: string,
        _poolId?: number,
        severity?: string
      ) => {
        alerts.push({ eventType, message, severity });
      },
      notifyLowBalance: async () => {},
    };

    // Signer balance is 0.05 SOL (50,000,000 lamports < 150,000,000 lamports)
    const ctx = createMockContext(signer, undefined, {
      getBalance: () => ({
        send: async () => ({ value: 50_000_000n }),
      }),
    });

    const sentinel = new CapacitySentinelWorker(mockNotifier);

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3900,
        capacity: 4096,
      }),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    const outcome = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.strictEqual(outcome.retryAfterMs, undefined);
    assert.match(
      outcome.reason,
      /Signer SOL balance insufficient for expansion rent/
    );
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(
      alerts[0].eventType,
      "CRANK_INSUFFICIENT_SOL_FOR_EXPANSION"
    );
    assert.strictEqual(alerts[0].severity, "warning");
  });

  it("CapacitySentinelWorker should defer safely if balance check fails with RPC error", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer, undefined, {
      getBalance: () => ({
        send: async () => {
          throw new Error("RPC network timeout");
        },
      }),
    });

    const sentinel = new CapacitySentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry({
        userCount: 3900,
        capacity: 4096,
      }),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    const outcome = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome.shouldExecute, false);
    assert.match(
      outcome.reason,
      /Failed to verify signer SOL balance; deferring expansion/
    );
  });

  it("CapacitySentinelWorker should allow expansion at N=997 capacity (163,616 users) but halt and alert at N=998 max ceiling (163,776 users)", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);

    const alerts: { eventType: string; message: string; severity?: string }[] =
      [];
    const mockNotifier = {
      notifyAlert: async (
        eventType: string,
        message: string,
        _poolId?: number,
        severity?: string
      ) => {
        alerts.push({ eventType, message, severity });
      },
      notifyLowBalance: async () => {},
    };

    const sentinel = new CapacitySentinelWorker(mockNotifier);

    const baseSnapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      ticketRegistryAddress: mockAddress,
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    // Capacity = 163,616 (N=997), userCount = 163,400 (remaining: 216 <= 320)
    // 104 + 163,616 * 64 + 10,240 = 10,481,768 <= 10,485,760 -> can expand
    const snapshotNearCeiling = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 163_400,
        capacity: 163_616,
      }),
    };
    const outcomeNearCeiling = await sentinel.evaluate(
      snapshotNearCeiling,
      ctx
    );
    assert.strictEqual(outcomeNearCeiling.shouldExecute, true);
    assert.strictEqual(alerts.length, 0);

    // Capacity = 163,776 (N=998 max ceiling), userCount = 163,600 (remaining: 176 <= 320)
    // 104 + 163,776 * 64 + 10,240 = 10,492,008 > 10,485,760 -> cannot expand
    const snapshotAtMaxCeiling = {
      ...baseSnapshot,
      pool: buildMockPrizePool({ isFrozenForDraw: 0 }),
      ticketRegistry: buildMockTicketRegistry({
        userCount: 163_600,
        capacity: 163_776,
      }),
    };
    const outcomeAtMaxCeiling = await sentinel.evaluate(
      snapshotAtMaxCeiling,
      ctx
    );
    assert.strictEqual(outcomeAtMaxCeiling.shouldExecute, false);
    assert.match(
      outcomeAtMaxCeiling.reason,
      /maximum SVM account size limit \(10MB, 163776 users\)/
    );
    assert.strictEqual(alerts.length, 1);
    assert.strictEqual(alerts[0].eventType, "REGISTRY_CAPACITY_CRITICAL");
    assert.strictEqual(alerts[0].severity, "critical");
    assert.match(alerts[0].message, /10481768 bytes, 163776 users/);

    // Cooldown verification: evaluate again immediately, alert should NOT be resent
    const outcomeCooldown = await sentinel.evaluate(snapshotAtMaxCeiling, ctx);
    assert.strictEqual(outcomeCooldown.shouldExecute, false);
    assert.strictEqual(alerts.length, 1); // Still 1

    // Verify graceful execution when alertNotifier is undefined
    const sentinelNoNotifier = new CapacitySentinelWorker();
    const outcomeNoNotifier = await sentinelNoNotifier.evaluate(
      snapshotAtMaxCeiling,
      ctx
    );
    assert.strictEqual(outcomeNoNotifier.shouldExecute, false);
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
    assert.match(
      outcome.reason,
      /missing required Huma address\(es\).*lenderState/
    );
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

  it("DisburseSentinelWorker should quarantine deficient candidate and exclude from next evaluation", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({
        tokenMint: mockAddress,
        totalPendingRedemptions: 2n,
      }),
      ticketRegistryAddress: mockAddress,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 500n,
      currentTimestamp: toUnixTimestamp(1000),
      state: "IDLE" as const,
      nextDrawAt: toUnixTimestamp(2000),
    };

    const candidate0 = {
      redemptionId: 0n,
      user: mockAddress,
      humaRequestId: 0n,
      redemptionType: RedemptionType.BondSale,
    };
    const candidate1 = {
      redemptionId: 1n,
      user: TEST_ADDRESSES.USER_2,
      humaRequestId: 1n,
      redemptionType: RedemptionType.BondSale,
    };

    interface SentinelInternalState {
      candidateCache: Map<
        number,
        { candidates: PendingRedemptionCandidate[]; cachedAt: number }
      >;
      lastEvaluatedBatch: Map<number, PendingRedemptionCandidate[]>;
    }
    const internal = sentinel as unknown as SentinelInternalState;

    // Inject cached candidates
    internal.candidateCache.set(1, {
      candidates: [candidate0, candidate1],
      cachedAt: Date.now(),
    });

    // 1. Initial evaluate batches candidate 0 & 1
    const outcome1 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome1.shouldExecute, true);

    // 2. Simulate single-candidate failure with VENUE_LIQUIDITY_DEFICIT
    internal.lastEvaluatedBatch.set(1, [candidate0]);
    sentinel.onDeferred(1, {
      status: "VENUE_LIQUIDITY_DEFICIT",
      reason: "InsufficientVaultBalance",
      code: 6066,
    });

    assert.strictEqual(
      sentinel.isCandidateQuarantined(1, 0n),
      true,
      "Candidate #0 must be quarantined"
    );
    assert.strictEqual(
      sentinel.isCandidateQuarantined(1, 1n),
      false,
      "Candidate #1 must not be quarantined"
    );

    // 3. Re-inject candidates into cache to evaluate candidate #1
    internal.candidateCache.set(1, {
      candidates: [candidate0, candidate1],
      cachedAt: Date.now(),
    });

    const outcome2 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome2.shouldExecute, true);
    if (outcome2.shouldExecute) {
      assert.match(
        outcome2.reason,
        /IDs: \[#1\]/,
        "Must evaluate candidate #1 while candidate #0 is quarantined"
      );
    }

    // 4. Quarantine candidate #1 as well
    internal.lastEvaluatedBatch.set(1, [candidate1]);
    sentinel.onDeferred(1, {
      status: "VENUE_LIQUIDITY_DEFICIT",
      reason: "InsufficientVaultBalance",
      code: 6066,
    });

    // 5. When all candidates are quarantined, evaluate returns shouldExecute: false WITHOUT retryAfterMs
    internal.candidateCache.set(1, {
      candidates: [candidate0, candidate1],
      cachedAt: Date.now(),
    });

    const outcome3 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome3.shouldExecute, false);
    assert.strictEqual(
      outcome3.retryAfterMs,
      undefined,
      "Must not set retryAfterMs on pool scheduler"
    );
    assert.match(
      outcome3.reason,
      /All 2 pending redemptions currently quarantined/
    );
  });

  it("DisburseSentinelWorker should fallback to single candidate when multi-candidate batch fails", async () => {
    const signer = await generateKeyPairSigner();
    const ctx = createMockContext(signer);
    const sentinel = new DisburseSentinelWorker();

    const snapshot = {
      poolId: toPoolId(1),
      poolAddress: mockAddress,
      pool: buildMockPrizePool({
        tokenMint: mockAddress,
        totalPendingRedemptions: 3n,
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
        redemptionId: 10n,
        user: mockAddress,
        humaRequestId: 10n,
        redemptionType: RedemptionType.BondSale,
      },
      {
        redemptionId: 11n,
        user: TEST_ADDRESSES.USER_2,
        humaRequestId: 11n,
        redemptionType: RedemptionType.BondSale,
      },
    ];

    interface SentinelInternalState {
      candidateCache: Map<
        number,
        { candidates: PendingRedemptionCandidate[]; cachedAt: number }
      >;
      lastEvaluatedBatch: Map<number, PendingRedemptionCandidate[]>;
    }
    const internal = sentinel as unknown as SentinelInternalState;

    internal.candidateCache.set(1, {
      candidates,
      cachedAt: Date.now(),
    });

    // 1. First evaluation batches 2 candidates
    const outcome1 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome1.shouldExecute, true);

    // 2. Multi-candidate batch fails with VENUE_LIQUIDITY_DEFICIT
    sentinel.onDeferred(1, {
      status: "VENUE_LIQUIDITY_DEFICIT",
      reason: "InsufficientVaultBalance",
      code: 6066,
    });

    // 3. Next evaluation forces single candidate fallback
    internal.candidateCache.set(1, {
      candidates,
      cachedAt: Date.now(),
    });

    const outcome2 = await sentinel.evaluate(snapshot, ctx);
    assert.strictEqual(outcome2.shouldExecute, true);
    if (outcome2.shouldExecute) {
      assert.match(
        outcome2.reason,
        /Claiming batch of 1 settled redemptions \(IDs: \[#10\]\)/
      );
    }
  });
});
