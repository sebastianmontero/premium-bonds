/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateKeyPairSigner,
  SolanaError,
  SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR,
} from "@solana/kit";
import { AdaptiveCrankScheduler } from "../scheduler/adaptive-scheduler";
import { MetricsServer } from "../metrics/metrics-server";
import { CrankConfig } from "../config";
import { CircuitBreaker } from "../executor/circuit-breaker";
import { AlertNotifier } from "../alerts/alert-notifier";
import {
  PoolStateSnapshot,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
  ICrankTask,
} from "../types";
import { CapacitySentinelWorker } from "../workers/capacity-sentinel.worker";
import { PoolStatus } from "../../../app/lib/bonds-sdk";
import {
  buildMockPrizePool,
  buildMockTicketRegistry,
  TEST_ADDRESSES,
} from "@/app/lib/test-harness";

function createMockHttpSolanaError(
  statusCode: number,
  headers?: any
): SolanaError<typeof SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR> {
  return new SolanaError(SOLANA_ERROR__RPC__TRANSPORT_HTTP_ERROR, {
    statusCode,
    headers: headers ?? {},
    message: `HTTP error (${statusCode})`,
  } as any);
}

function createTestConfig(overrides?: Partial<CrankConfig>): CrankConfig {
  return {
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8899",
    poolIds: [1, 2],
    pollIntervalMs: 15000,
    activeWindowPollIntervalMs: 1000,
    metricsPort: 0,
    enableAutoDisburse: false,
    maxPrepareBatchSize: 500,
    maxReinvestBatchSize: 5,
    instanceIndex: 0,
    instanceJitterMs: 0,
    jitoEnabled: false,
    jitoTipLamports: 10000n,
    maxJitoTipLamports: 100000n,
    humaLenderState: TEST_ADDRESSES.USER_2,
    humaPoolState: TEST_ADDRESSES.HUMA_POOL,
    humaPoolUnderlyingToken: TEST_ADDRESSES.USER,
    dryRun: true,
    allowNonJobsSigner: true,
    ...overrides,
  };
}

describe("AdaptiveCrankScheduler Rate Limiting & Error Isolation Unit Tests", () => {
  it("should catch snapshot 429 errors, apply rate limit cooldown, and NOT trip CircuitBreaker", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const scheduler = new AdaptiveCrankScheduler(config, signer, metrics);

    // Mock fetchPoolStateSnapshot by replacing internal rpc or injecting error
    const err429 = createMockHttpSolanaError(429);

    // Replace scheduler's rpc with a failing one for getAccountInfo
    (scheduler as any).rpc = {
      getAccountInfo: () => ({
        send: async () => {
          throw err429;
        },
      }),
      getBalance: () => ({
        send: async () => ({ value: 1000000000n }),
      }),
    };

    const breaker = (scheduler as any).breaker;
    assert.strictEqual(
      breaker.canExecute(1),
      true,
      "Breaker should start CLOSED"
    );

    // Process pool directly
    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(result, false);

    // Verify CircuitBreaker was NOT tripped
    assert.strictEqual(
      breaker.canExecute(1),
      true,
      "Breaker must remain CLOSED after RPC 429"
    );
    assert.strictEqual(
      breaker.getState(1),
      "CLOSED",
      "Breaker state must remain CLOSED"
    );

    // Verify cooldown is active
    const nextTick = (scheduler as any).nextEligibleTickMs.get(1) || 0;
    assert.ok(
      nextTick > Date.now(),
      "Pool nextEligibleTick must be set in future"
    );
    assert.ok(
      (scheduler as any).globalRpcCooldownUntil > Date.now(),
      "Global cooldown must be active"
    );
  });

  it("should respect Retry-After header duration in rate limit cooldown", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const scheduler = new AdaptiveCrankScheduler(config, signer, metrics);

    const err429 = createMockHttpSolanaError(429, { "retry-after": "10" });

    const now = Date.now();
    (scheduler as any).applyRateLimitCooldown(1, err429);

    const cooldownTarget = (scheduler as any).nextEligibleTickMs.get(1);
    // Base is 10,000ms + jitter [0, 2500ms]
    assert.ok(
      cooldownTarget >= now + 9900,
      "Cooldown target should be at least ~10s in future"
    );
    assert.ok(
      cooldownTarget <= now + 13000,
      "Cooldown target should not exceed 10s + max jitter"
    );
  });

  it("should catch transient errors in task.evaluate, apply cooldown, and NOT trip CircuitBreaker", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const breaker = new CircuitBreaker(5, 60_000);

    const mockSnapshot: PoolStateSnapshot = {
      poolId: toPoolId(1),
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Active,
        currentDrawCycleId: 1,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.USER,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 100n,
      currentTimestamp: toUnixTimestamp(1000n),
      state: "YIELD_HARVEST_READY",
      currentCycleId: toDrawCycleId(1),
    };

    const socketErr: any = new Error("fetch failed");
    socketErr.code = "UND_ERR_SOCKET";

    const failingTask: ICrankTask = {
      name: "TestFailingWorker",
      canHandle: () => true,
      evaluate: async () => {
        throw socketErr;
      },
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      undefined,
      breaker,
      undefined,
      async () => mockSnapshot
    );
    (scheduler as any).tasks = [failingTask];

    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(
      result,
      false,
      "processPool should return false on transient evaluation error"
    );
    assert.strictEqual(
      breaker.canExecute(1),
      true,
      "Breaker must stay CLOSED after evaluate error"
    );
    assert.strictEqual(
      breaker.getState(1),
      "CLOSED",
      "Breaker state must remain CLOSED"
    );
    assert.ok(
      (scheduler as any).globalRpcCooldownUntil > Date.now(),
      "Global cooldown must be activated"
    );
  });

  it("should isolate TxExecutor RPC transport failures, invoke task.onError, and NOT trip CircuitBreaker", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const rpcErr = createMockHttpSolanaError(429);
    const breaker = new CircuitBreaker(5, 60_000);

    // Mock executor returning an ERROR outcome caused by 429
    const mockExecutor = {
      executeInstructions: async () => ({
        workerName: "HarvestYieldWorker",
        executed: false,
        reason: "HTTP error (429): Too Many Requests",
        outcome: {
          status: "ERROR" as const,
          reason: "HTTP error (429): Too Many Requests",
          error: rpcErr,
        },
      }),
    };

    const mockSnapshot: PoolStateSnapshot = {
      poolId: toPoolId(1),
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Active,
        currentDrawCycleId: 1,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.USER,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 100n,
      currentTimestamp: toUnixTimestamp(1000n),
      state: "YIELD_HARVEST_READY",
      currentCycleId: toDrawCycleId(1),
    };

    let onErrorCalled = false;
    let errorPassedToHook: unknown = null;
    let poolPassedToHook: number | null = null;

    const mockTask: ICrankTask = {
      name: "HarvestYieldWorker",
      canHandle: () => true,
      evaluate: async () => ({
        shouldExecute: true as const,
        reason: "Harvest due",
        instructions: [],
        computeUnitLimit: 150000,
      }),
      onError: (poolId: number, err?: unknown) => {
        onErrorCalled = true;
        poolPassedToHook = poolId;
        errorPassedToHook = err;
      },
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      mockExecutor as any,
      breaker,
      undefined,
      async () => mockSnapshot
    );

    (scheduler as any).tasks = [mockTask];

    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(
      result,
      false,
      "processPool should return false on transport failure"
    );
    assert.strictEqual(
      onErrorCalled,
      true,
      "task.onError must be invoked on retryable RPC error"
    );
    assert.strictEqual(
      poolPassedToHook,
      1,
      "task.onError must receive target poolId"
    );
    assert.strictEqual(
      errorPassedToHook,
      rpcErr,
      "task.onError must receive original RPC error"
    );
    assert.strictEqual(breaker.canExecute(1), true, "Breaker must stay CLOSED");
    assert.strictEqual(
      breaker.getState(1),
      "CLOSED",
      "Breaker state must remain CLOSED"
    );
    assert.ok(
      (scheduler as any).globalRpcCooldownUntil > Date.now(),
      "Global cooldown must be activated"
    );
    assert.ok(
      ((scheduler as any).nextEligibleTickMs.get(1) ?? 0) > Date.now(),
      "Pool-specific nextEligibleTick must be set in the future"
    );
  });

  it("should trip CircuitBreaker on legitimate smart contract revert errors via real processPool", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const breaker = new CircuitBreaker(5, 60_000);

    const contractError = new Error(
      "custom program error: 0x1770 (6000 PoolNotActive)"
    );

    const mockExecutor = {
      executeInstructions: async () => ({
        workerName: "HarvestYieldWorker",
        executed: false,
        reason: "custom program error: 0x1770",
        outcome: {
          status: "ERROR" as const,
          reason: "custom program error: 0x1770",
          error: contractError,
        },
      }),
    };

    const mockSnapshot: PoolStateSnapshot = {
      poolId: toPoolId(1),
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Active,
        currentDrawCycleId: 1,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.USER,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 100n,
      currentTimestamp: toUnixTimestamp(1000n),
      state: "YIELD_HARVEST_READY",
      currentCycleId: toDrawCycleId(1),
    };

    const mockTask: ICrankTask = {
      name: "HarvestYieldWorker",
      canHandle: () => true,
      evaluate: async () => ({
        shouldExecute: true as const,
        reason: "Harvest due",
        instructions: [],
        computeUnitLimit: 150000,
      }),
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      mockExecutor as any,
      breaker,
      undefined,
      async () => mockSnapshot
    );
    (scheduler as any).tasks = [mockTask];

    // Execute 5 contract revert failures directly via processPool
    for (let i = 0; i < 5; i++) {
      await (scheduler as any).processPool(1);
    }

    assert.strictEqual(
      breaker.canExecute(1),
      false,
      "Contract failure reaching threshold must trip breaker to OPEN"
    );
    assert.strictEqual(breaker.getState(1), "OPEN");
  });

  it("should cleanly purge CapacitySentinelWorker pending target capacity when scheduler encounters retryable RPC error", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const rpcErr = createMockHttpSolanaError(429);
    const breaker = new CircuitBreaker(5, 60_000);

    const mockExecutor = {
      executeInstructions: async () => ({
        workerName: "CapacitySentinelWorker",
        executed: false,
        reason: "HTTP error (429): Rate Limited",
        outcome: {
          status: "ERROR" as const,
          reason: "HTTP error (429): Rate Limited",
          error: rpcErr,
        },
      }),
    };

    const sentinel = new CapacitySentinelWorker(
      undefined,
      { headroomSlots: 320, rpcCooldownMs: 10_000 },
      () => 1_000_000
    );

    const deficitSnapshot: PoolStateSnapshot = {
      poolId: toPoolId(1),
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Active,
        currentDrawCycleId: 1,
        isFrozenForDraw: 0,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.USER,
      ticketRegistry: buildMockTicketRegistry({
        capacity: 4096,
        userCount: 4000,
      }),
      currentSlot: 100n,
      currentTimestamp: toUnixTimestamp(1000n),
      state: "IDLE",
      nextDrawAt: toUnixTimestamp(2000n),
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      mockExecutor as any,
      breaker,
      undefined,
      async () => deficitSnapshot
    );
    (scheduler as any).tasks = [sentinel];

    // Run processPool: sentinel triggers, executor fails with 429, scheduler dispatches onError
    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(result, false);

    // Verify throttler did NOT record a false expansion and is NOT awaiting propagation
    assert.strictEqual(
      sentinel.getThrottler().isAwaitingRpcPropagation(1, 4096),
      false,
      "Throttler must not await propagation since expansion was aborted"
    );
    assert.strictEqual(
      breaker.getState(1),
      "CLOSED",
      "Breaker must remain CLOSED"
    );
  });

  it("should break concurrent worker queue when a sibling pool triggers global cooldown", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1, 2, 3] });
    const scheduler = new AdaptiveCrankScheduler(config, signer, metrics);

    const processedPools: number[] = [];

    // Pool 1 triggers 429 and sets globalRpcCooldownUntil
    (scheduler as any).processPool = async (poolId: number) => {
      processedPools.push(poolId);
      if (poolId === 1) {
        (scheduler as any).globalRpcCooldownUntil = Date.now() + 10000;
        return false;
      }
      return true;
    };

    const hadActiveWork = await scheduler.tickOnce();
    assert.strictEqual(hadActiveWork, false);

    // Only pool 1 should have been processed; pool 2 & 3 should be skipped due to queue break
    assert.deepStrictEqual(
      processedPools,
      [1],
      "Sibling pools must not run once cooldown is active"
    );

    // Immediate next tickOnce() call returns false without processing any pools
    const nextTick = await scheduler.tickOnce();
    assert.strictEqual(
      nextTick,
      false,
      "tickOnce() must return false while global cooldown is active"
    );
  });
});

describe("AdaptiveCrankScheduler Circuit Breaker & Unpause Deadlock Recovery", () => {
  it("should handle on-chain CIRCUIT_BREAKER_HALTED without tripping executor CircuitBreaker", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const breaker = new CircuitBreaker(5, 60_000);
    const alertNotifier = new AlertNotifier(config);
    let alerted = false;
    alertNotifier.notifyAlert = async () => {
      alerted = true;
    };

    const haltedSnapshot: PoolStateSnapshot = {
      poolId: 1 as any,
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Paused,
        currentDrawCycleId: 5,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 1000n,
      currentTimestamp: 2000n as any,
      state: "CIRCUIT_BREAKER_HALTED",
      reason: "HaltedYieldSpike",
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      undefined,
      breaker,
      alertNotifier,
      async () => haltedSnapshot
    );

    const now = Date.now();
    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(result, false);

    assert.strictEqual(breaker.canExecute(1), true);
    assert.strictEqual(breaker.getState(1), "CLOSED");
    assert.strictEqual(alerted, true, "Should trigger alert notification");

    const nextTick = (scheduler as any).nextEligibleTickMs.get(1);
    assert.ok(
      nextTick >= now + 59_000 && nextTick <= now + 61_000,
      "Should set 60s quarantine"
    );
  });

  it("should proactively reset CircuitBreaker to CLOSED when pool is Active and IDLE", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const breaker = new CircuitBreaker(5, 60_000);

    // Trip breaker to OPEN with 5 failures
    for (let i = 0; i < 5; i++) {
      breaker.recordPoolFailure(1, "RPC failure");
    }
    assert.strictEqual(breaker.getState(1), "OPEN");

    // Set HALF_OPEN state
    (breaker as any).poolStates.set(1, {
      state: "HALF_OPEN",
      consecutiveFailures: 5,
      nextProbeTime: 0,
    });
    assert.strictEqual(breaker.getState(1), "HALF_OPEN");

    const activeIdleSnapshot: PoolStateSnapshot = {
      poolId: 1 as any,
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Active,
        currentDrawCycleId: 5,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 1000n,
      currentTimestamp: 2000n as any,
      state: "IDLE",
      nextDrawAt: 3000n as any,
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      undefined,
      breaker,
      undefined,
      async () => activeIdleSnapshot
    );

    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(result, false);
    assert.strictEqual(
      breaker.getState(1),
      "CLOSED",
      "Breaker must be recovered to CLOSED on Active pool without executing transactions"
    );
  });

  it("should treat manual pause in cycle N as POOL_PAUSED after cycle N was unpaused", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const alertNotifier = new AlertNotifier(config);
    let alertCount = 0;
    alertNotifier.notifyAlert = async () => {
      alertCount++;
    };

    let currentSnapshot: PoolStateSnapshot = {
      poolId: 1 as any,
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Active,
        currentDrawCycleId: 5,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 1000n,
      currentTimestamp: 2000n as any,
      state: "IDLE",
      nextDrawAt: 3000n as any,
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      undefined,
      undefined,
      alertNotifier,
      async () => currentSnapshot
    );

    // Step 1: Process active pool in cycle 5
    await (scheduler as any).processPool(1);
    assert.strictEqual(
      (scheduler as any).activeCyclesObserved.get(1),
      5,
      "Should register cycle 5 as observed active"
    );

    // Step 2: Pool is manually paused in cycle 5 while previous cycle was halted
    currentSnapshot = {
      poolId: 1 as any,
      poolAddress: TEST_ADDRESSES.USER,
      pool: buildMockPrizePool({
        status: PoolStatus.Paused,
        currentDrawCycleId: 5,
      }),
      ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
      ticketRegistry: buildMockTicketRegistry(),
      currentSlot: 1000n,
      currentTimestamp: 2000n as any,
      state: "CIRCUIT_BREAKER_HALTED",
      reason: "HaltedYieldSpike",
    };

    const result = await (scheduler as any).processPool(1);
    assert.strictEqual(result, false);
    assert.strictEqual(
      alertCount,
      0,
      "Should not send alert for manual pause on previously unpaused cycle"
    );
  });

  it("should maintain multi-pool isolation for activeCyclesObserved", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1, 2] });
    const alertNotifier = new AlertNotifier(config);
    const alertedPools: number[] = [];
    alertNotifier.notifyAlert = async (_type, _msg, poolId) => {
      if (poolId !== undefined) alertedPools.push(poolId);
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      undefined,
      undefined,
      alertNotifier,
      async (_rpc, poolId) => {
        if (poolId === 1) {
          return {
            poolId: 1 as any,
            poolAddress: TEST_ADDRESSES.USER,
            pool: buildMockPrizePool({
              status: PoolStatus.Active,
              currentDrawCycleId: 5,
            }),
            ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
            ticketRegistry: buildMockTicketRegistry(),
            currentSlot: 1000n,
            currentTimestamp: 2000n as any,
            state: "IDLE",
            nextDrawAt: 3000n as any,
          };
        }
        return {
          poolId: 2 as any,
          poolAddress: TEST_ADDRESSES.USER_2,
          pool: buildMockPrizePool({
            status: PoolStatus.Paused,
            currentDrawCycleId: 5,
          }),
          ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
          ticketRegistry: buildMockTicketRegistry(),
          currentSlot: 1000n,
          currentTimestamp: 2000n as any,
          state: "CIRCUIT_BREAKER_HALTED",
          reason: "HaltedInsolvent",
        };
      }
    );

    // Process Pool 1 (Active)
    await (scheduler as any).processPool(1);
    assert.strictEqual((scheduler as any).activeCyclesObserved.get(1), 5);
    assert.strictEqual(
      (scheduler as any).activeCyclesObserved.get(2),
      undefined
    );

    // Process Pool 2 (Halted)
    await (scheduler as any).processPool(2);
    assert.deepStrictEqual(
      alertedPools,
      [2],
      "Pool 2 should trigger alert independently of Pool 1"
    );
  });

  it("should deduplicate halt alerts across multiple probe ticks", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const alertNotifier = new AlertNotifier(config);
    let alertCount = 0;
    alertNotifier.notifyAlert = async () => {
      alertCount++;
    };

    let cycleId = 5;
    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      undefined,
      undefined,
      alertNotifier,
      async () => ({
        poolId: 1 as any,
        poolAddress: TEST_ADDRESSES.USER,
        pool: buildMockPrizePool({
          status: PoolStatus.Paused,
          currentDrawCycleId: cycleId,
        }),
        ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
        ticketRegistry: buildMockTicketRegistry(),
        currentSlot: 1000n,
        currentTimestamp: 2000n as any,
        state: "CIRCUIT_BREAKER_HALTED",
        reason: "HaltedYieldSpike",
      })
    );

    // Tick 1 for cycle 5
    await (scheduler as any).processPool(1);
    assert.strictEqual(alertCount, 1, "First tick should alert");

    // Tick 2 for cycle 5 (repeated probe)
    await (scheduler as any).processPool(1);
    assert.strictEqual(
      alertCount,
      1,
      "Repeated tick for same cycle should not alert again"
    );

    // Tick 3 for cycle 6 (new halted cycle)
    cycleId = 6;
    await (scheduler as any).processPool(1);
    assert.strictEqual(alertCount, 2, "New halted cycle should alert");
  });

  it("should classify VENUE_LIQUIDITY_DEFICIT as deferred and NOT trip CircuitBreaker", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const breaker = new CircuitBreaker(5, 60_000);

    let onDeferredCalled = false;
    let deferredStatus = "";

    // Mock task that triggers and yields VENUE_LIQUIDITY_DEFICIT simulation error
    const mockDeficitTask = {
      name: "MockDisburseWorker",
      canHandle: () => true,
      evaluate: async () => ({
        shouldExecute: true as const,
        reason: "Claiming redemption",
        instructions: [],
        computeUnitLimit: 200_000,
      }),
      onDeferred: (_poolId: number, outcome: any) => {
        onDeferredCalled = true;
        deferredStatus = outcome.status;
      },
    };

    // Mock executor that returns VENUE_LIQUIDITY_DEFICIT
    const mockExecutor = {
      executeInstructions: async () => ({
        workerName: "MockDisburseWorker",
        executed: false,
        reason: "Pool vault has insufficient balance to settle redemption",
        outcome: {
          status: "VENUE_LIQUIDITY_DEFICIT" as const,
          reason: "Pool vault has insufficient balance to settle redemption",
          code: 6066,
        },
      }),
    };

    const scheduler = new AdaptiveCrankScheduler(
      config,
      signer,
      metrics,
      undefined,
      mockExecutor as any,
      breaker,
      undefined,
      async () => ({
        poolId: 1 as any,
        poolAddress: TEST_ADDRESSES.USER,
        pool: buildMockPrizePool({ status: PoolStatus.Active }),
        ticketRegistryAddress: TEST_ADDRESSES.ATA_PROGRAM,
        ticketRegistry: buildMockTicketRegistry(),
        currentSlot: 1000n,
        currentTimestamp: 2000n as any,
        state: "IDLE",
        nextDrawAt: 3000n as any,
      })
    );

    // Replace tasks with our mock deficit task
    (scheduler as any).tasks = [mockDeficitTask];

    // Execute 5 consecutive times
    for (let i = 0; i < 5; i++) {
      await (scheduler as any).processPool(1);
    }

    // Verify CircuitBreaker remains CLOSED and healthy
    assert.strictEqual(
      breaker.canExecute(1),
      true,
      "CircuitBreaker must remain CLOSED after 5 consecutive venue liquidity deficits"
    );
    assert.strictEqual(breaker.getState(1), "CLOSED");
    assert.strictEqual(onDeferredCalled, true);
    assert.strictEqual(deferredStatus, "VENUE_LIQUIDITY_DEFICIT");
  });
});
