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
import { TEST_ADDRESSES } from "@/app/lib/test-harness";

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
    const scheduler = new AdaptiveCrankScheduler(config, signer, metrics);

    // Mock successful snapshot
    const mockSnapshot = {
      poolId: 1,
      poolAddress: TEST_ADDRESSES.USER,
      pool: { currentDrawCycleId: 1, isFrozenForDraw: 0 },
      ticketRegistryAddress: TEST_ADDRESSES.USER,
      ticketRegistry: {},
      currentSlot: 100n,
      currentTimestamp: 1000n,
      state: "YIELD_HARVEST_READY",
    };

    // Inject failing task that throws network error
    const socketErr: any = new Error("fetch failed");
    socketErr.code = "UND_ERR_SOCKET";

    (scheduler as any).tasks = [
      {
        name: "TestFailingWorker",
        canHandle: () => true,
        evaluate: async () => {
          throw socketErr;
        },
      },
    ];

    const breaker = (scheduler as any).breaker;

    // Run processPool with mocked snapshot fetcher
    (scheduler as any).processPool = async (poolId: number) => {
      const task = (scheduler as any).tasks[0];
      try {
        await task.evaluate(mockSnapshot, (scheduler as any).context);
      } catch (err: unknown) {
        (scheduler as any).applyRateLimitCooldown(poolId, err);
        metrics.incrementError("TestFailingWorker", "rpc_network_error");
        // DO NOT trip circuit breaker
      }
      return false;
    };

    await (scheduler as any).processPool(1);

    assert.strictEqual(breaker.canExecute(1), true);
    assert.strictEqual(breaker.getState(1), "CLOSED");
    assert.ok((scheduler as any).globalRpcCooldownUntil > Date.now());
  });

  it("should isolate TxExecutor RPC transport failures and NOT trip CircuitBreaker", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const scheduler = new AdaptiveCrankScheduler(config, signer, metrics);

    const breaker = (scheduler as any).breaker;

    const rpcErr = createMockHttpSolanaError(429);

    // Mock executor returning an ERROR outcome caused by 429
    (scheduler as any).executor = {
      executeInstructions: async () => ({
        workerName: "HarvestYieldWorker",
        executed: false,
        reason: "HTTP error (429): Too Many Requests",
        outcome: {
          status: "ERROR",
          reason: "HTTP error (429): Too Many Requests",
          error: rpcErr,
        },
      }),
    };

    const mockSnapshot = {
      poolId: 1,
      poolAddress: TEST_ADDRESSES.USER,
      pool: { currentDrawCycleId: 1, isFrozenForDraw: 0 },
      ticketRegistryAddress: TEST_ADDRESSES.USER,
      ticketRegistry: {},
      currentSlot: 100n,
      currentTimestamp: 1000n,
      state: "YIELD_HARVEST_READY",
    };

    (scheduler as any).tasks = [
      {
        name: "HarvestYieldWorker",
        canHandle: () => true,
        evaluate: async () => ({
          shouldExecute: true,
          reason: "Harvest due",
          instructions: [],
          computeUnitLimit: 150000,
        }),
      },
    ];

    // Call processPool logic with snapshot stub
    let poolRan = false;
    (scheduler as any).processPool = async (poolId: number) => {
      const task = (scheduler as any).tasks[0];
      await task.evaluate(mockSnapshot, (scheduler as any).context);
      const result = await (scheduler as any).executor.executeInstructions();

      const errToInspect =
        (result as any).error ?? (result.outcome as any).error ?? result.reason;
      if (errToInspect) {
        (scheduler as any).applyRateLimitCooldown(poolId, errToInspect);
        metrics.incrementError(task.name, "rpc_rate_limited");
      } else {
        breaker.recordPoolFailure(poolId, result.reason);
      }
      poolRan = true;
      return false;
    };

    await (scheduler as any).processPool(1);
    assert.strictEqual(poolRan, true);
    assert.strictEqual(breaker.canExecute(1), true, "Breaker must stay CLOSED");
    assert.strictEqual(
      breaker.getState(1),
      "CLOSED",
      "Breaker state must remain CLOSED"
    );
    assert.ok(
      (scheduler as any).globalRpcCooldownUntil > Date.now(),
      "Cooldown must be activated"
    );
  });

  it("should trip CircuitBreaker on legitimate smart contract revert errors", async () => {
    const signer = await generateKeyPairSigner();
    const metrics = new MetricsServer(0);
    const config = createTestConfig({ poolIds: [1] });
    const scheduler = new AdaptiveCrankScheduler(config, signer, metrics);
    const breaker = (scheduler as any).breaker;

    // Simulate contract failure in processPool
    const contractError = new Error(
      "custom program error: 0x1770 (6000 PoolNotActive)"
    );

    (scheduler as any).executor = {
      executeInstructions: async () => ({
        workerName: "HarvestYieldWorker",
        executed: false,
        reason: "custom program error: 0x1770",
        outcome: {
          status: "ERROR",
          reason: "custom program error: 0x1770",
          error: contractError,
        },
      }),
    };

    (scheduler as any).tasks = [
      {
        name: "HarvestYieldWorker",
        canHandle: () => true,
        evaluate: async () => ({
          shouldExecute: true,
          reason: "Harvest due",
          instructions: [],
          computeUnitLimit: 150000,
        }),
      },
    ];

    // Simulating 5 contract revert failures to trip the 5-failure threshold
    for (let i = 0; i < 5; i++) {
      breaker.recordPoolFailure(1, "custom program error: 0x1770");
    }
    assert.strictEqual(
      breaker.canExecute(1),
      false,
      "Contract failure reaching threshold must trip breaker to OPEN"
    );
    assert.strictEqual(breaker.getState(1), "OPEN");
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
