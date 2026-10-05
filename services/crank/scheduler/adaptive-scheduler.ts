import { KeyPairSigner, getBase64Encoder } from "@solana/kit";
import {
  findGlobalConfigPda,
  parseGlobalConfig,
  canClosePayoutRegistry,
  PoolStatus,
} from "../../../app/lib/bonds-sdk";
import {
  createResilientRpc,
  isRetryableRpcError,
  isRateLimitRpcError,
  RateLimitCoordinator,
  type ResilientRpcClient,
} from "../../../app/lib/rpc-transport";
import { CrankConfig } from "../config";
import {
  CrankExecutionContext,
  ICrankTask,
  PoolStateSnapshot,
  isDeferredOutcome,
  WorkerDeferredOutcome,
} from "../types";
import { fetchPoolStateSnapshot } from "../state/snapshot-fetcher";
import { isPoolStatus } from "../state/snapshot-classifier";
import { CIRCUIT_BREAKER_HALT_QUARANTINE_MS } from "../constants";
import { TransactionExecutor } from "../executor/tx-executor";
import { CircuitBreaker } from "../executor/circuit-breaker";
import { AlertNotifier } from "../alerts/alert-notifier";
import { MetricsServer } from "../metrics/metrics-server";
import { IVrfProvider, createVrfProvider } from "../vrf/randomness-provider";
import { HarvestYieldWorker } from "../workers/harvest-yield.worker";
import { PrepareDrawWorker } from "../workers/prepare-draw.worker";
import { RebindRandomnessWorker } from "../workers/rebind-randomness.worker";
import { AtomicRevealWorker } from "../workers/atomic-reveal.worker";
import { ReinvestWinningsWorker } from "../workers/reinvest-winnings.worker";
import { CapacitySentinelWorker } from "../workers/capacity-sentinel.worker";
import { DisburseSentinelWorker } from "../workers/disburse-sentinel.worker";

const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 5_000;
const DEFAULT_RATE_LIMIT_JITTER_MS = 2_500;

export class AdaptiveCrankScheduler {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly rpc: ResilientRpcClient;
  private readonly executor: TransactionExecutor;
  private readonly breaker: CircuitBreaker;
  private readonly alertNotifier: AlertNotifier;
  private readonly metrics: MetricsServer;
  private readonly vrfProvider: IVrfProvider;
  private tasks: readonly ICrankTask[];
  private readonly context: CrankExecutionContext;
  private readonly inFlightPools: Set<number> = new Set();
  private readonly nextEligibleTickMs: Map<number, number> = new Map();
  private readonly rateLimiter = new RateLimitCoordinator({
    defaultFallbackCooldownMs: DEFAULT_RATE_LIMIT_COOLDOWN_MS,
    defaultJitterMs: DEFAULT_RATE_LIMIT_JITTER_MS,
  });
  private readonly maxConcurrentPools = 3;
  private authorizationVerified = false;
  private readonly activeCyclesObserved: Map<number, number> = new Map();
  private readonly alertedHaltCycles: Map<number, number> = new Map();
  private readonly snapshotFetcher: (
    rpc: ResilientRpcClient,
    poolId: number
  ) => Promise<PoolStateSnapshot | null>;

  get globalRpcCooldownUntil(): number {
    return this.rateLimiter.getCooldownUntil();
  }

  set globalRpcCooldownUntil(targetMs: number) {
    this.rateLimiter.setCooldownUntil(targetMs);
  }

  constructor(
    private readonly config: CrankConfig,
    private readonly signer: KeyPairSigner,
    metrics: MetricsServer,
    rpc?: ResilientRpcClient,
    executor?: TransactionExecutor,
    breaker?: CircuitBreaker,
    alertNotifier?: AlertNotifier,
    snapshotFetcher: (
      rpc: ResilientRpcClient,
      poolId: number
    ) => Promise<PoolStateSnapshot | null> = fetchPoolStateSnapshot
  ) {
    this.metrics = metrics;
    this.rpc =
      rpc ??
      createResilientRpc(config.rpcUrl, {
        rateLimitCoordinator: this.rateLimiter,
        onRetry: (err, attempt, delayMs) => {
          this.metrics.incrementError("rpc", "retry");
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(
            `[AdaptiveCrankScheduler] Transient RPC error (attempt ${attempt}: ${msg}). Retrying in ${Math.round(delayMs)}ms...`
          );
        },
      });
    this.executor = executor ?? new TransactionExecutor(this.rpc, config);
    this.alertNotifier = alertNotifier ?? new AlertNotifier(config);
    this.breaker =
      breaker ??
      new CircuitBreaker(5, 60_000, (event) => {
        if (event.type === "TRIP") {
          this.alertNotifier.notifyAlert(
            "CIRCUIT_BREAKER_TRIPPED",
            event.reason,
            event.poolId,
            "error"
          );
        }
      });
    this.snapshotFetcher = snapshotFetcher;
    this.vrfProvider = createVrfProvider(config.rpcUrl, {
      signer: this.signer,
    });

    this.context = {
      signer: this.signer,
      rpcUrl: config.rpcUrl,
      rpc: this.rpc,
      config: this.config,
      maxPrepareBatchSize: config.maxPrepareBatchSize,
      maxReinvestBatchSize: config.maxReinvestBatchSize,
      enableAutoDisburse: config.enableAutoDisburse,
      dryRun: config.dryRun,
      jitoEnabled: config.jitoEnabled,
    };

    this.tasks = [
      new HarvestYieldWorker(this.vrfProvider, config),
      new PrepareDrawWorker(),
      new RebindRandomnessWorker(this.vrfProvider),
      new AtomicRevealWorker(this.vrfProvider),
      new ReinvestWinningsWorker(),
      new CapacitySentinelWorker(this.alertNotifier),
      new DisburseSentinelWorker(),
    ];
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log(
      `[AdaptiveCrankScheduler] Starting daemon for pools: [${this.config.poolIds.join(", ")}]`
    );
    console.log(
      `[AdaptiveCrankScheduler] Signer: ${this.signer.address} | Instance Index: ${this.config.instanceIndex}`
    );

    // Hard Fail-Fast on Startup: Verify signer is authorized jobsAccount
    if (!this.config.dryRun) {
      await this.verifyJobsAccountAuthorization();
      this.authorizationVerified = true;
    }

    // Initial balance check
    await this.updateSignerBalance();

    this.scheduleNextTick(0);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log("[AdaptiveCrankScheduler] Daemon stopped.");
  }

  private applyRateLimitCooldown(poolId: number, err?: unknown): void {
    const delay = this.rateLimiter.applyCooldown(err);
    this.nextEligibleTickMs.set(poolId, Date.now() + delay);
  }

  private async verifyJobsAccountAuthorization(): Promise<void> {
    let globalConfigBytes: Uint8Array | null = null;
    try {
      const globalConfigPda = await findGlobalConfigPda();
      const res = await this.rpc
        .getAccountInfo(globalConfigPda, { encoding: "base64" })
        .send();
      if (!res?.value?.data?.[0]) {
        console.warn(
          "[AdaptiveCrankScheduler] GlobalConfig account not found on-chain. Proceeding with warning."
        );
        return;
      }
      globalConfigBytes = new Uint8Array(
        getBase64Encoder().encode(res.value.data[0])
      );
    } catch (err: unknown) {
      console.warn(
        `[AdaptiveCrankScheduler] Warning during startup authorization check RPC fetch: ${err instanceof Error ? err.message : String(err)}`
      );
      return;
    }

    if (!globalConfigBytes) return;
    const parsed = parseGlobalConfig(globalConfigBytes);
    if (parsed.jobsAccount !== this.signer.address) {
      if (this.config.allowNonJobsSigner) {
        console.warn(
          `[AdaptiveCrankScheduler] Warning: Signer ${this.signer.address} does not match on-chain jobsAccount (${parsed.jobsAccount}). ` +
            `HarvestYieldWorker will be disabled, but remaining 6 permissionless crank tasks will run.`
        );
        this.tasks = this.tasks.filter((t) => t.name !== "HarvestYieldWorker");
        return;
      }

      throw new Error(
        `Unauthorized Crank Signer: Active signer ${this.signer.address} does not match on-chain jobsAccount (${parsed.jobsAccount}). ` +
          `Harvest instructions strictly require the designated jobsAccount keypair. ` +
          `Either provide KEYPAIR_PATH=~/.config/solana/crank-keypair-dev.json or update on-chain globalConfig via: ` +
          `npx tsx scripts/pb-cli.ts admin update-global --jobs-account ${this.signer.address}`
      );
    }

    console.log(
      `[AdaptiveCrankScheduler] Signer verified as authorized on-chain jobsAccount (${parsed.jobsAccount}).`
    );
  }

  async tickOnce(): Promise<boolean> {
    if (this.rateLimiter.isCoolingDown()) {
      return false;
    }

    if (!this.config.dryRun && !this.authorizationVerified) {
      await this.verifyJobsAccountAuthorization();
      this.authorizationVerified = true;
    }

    const now = Date.now();
    const eligiblePools = this.config.poolIds.filter((poolId) => {
      const nextTick = this.nextEligibleTickMs.get(poolId) || 0;
      return now >= nextTick && !this.inFlightPools.has(poolId);
    });

    if (eligiblePools.length === 0) {
      return false;
    }

    // Apply instance jitter on non-primary replicas before processing
    if (this.config.instanceIndex > 0 && this.config.instanceJitterMs > 0) {
      const jitterMs = this.config.instanceIndex * this.config.instanceJitterMs;
      await new Promise((r) => setTimeout(r, jitterMs));
    }

    let hadActiveWork = false;

    // Process eligible pools with bounded concurrency (max 3)
    const queue = [...eligiblePools];
    const workers = Array.from(
      { length: Math.min(this.maxConcurrentPools, queue.length) },
      async () => {
        while (queue.length > 0) {
          if (this.rateLimiter.isCoolingDown()) {
            break; // Stop launching sibling pools if another pool triggered rate limiting
          }
          const poolId = queue.shift();
          if (poolId === undefined) break;

          this.inFlightPools.add(poolId);
          try {
            const poolActive = await this.processPool(poolId);
            if (poolActive) {
              hadActiveWork = true;
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (isRetryableRpcError(err)) {
              console.warn(
                `[AdaptiveCrankScheduler] [Pool #${poolId}] RPC rate-limited or transient network error: ${msg}. Applying backoff cooldown.`
              );
              this.applyRateLimitCooldown(poolId, err);
              this.metrics.incrementError(
                "scheduler",
                isRateLimitRpcError(err)
                  ? "rpc_rate_limited"
                  : "rpc_network_error"
              );
            } else {
              console.error(
                `[AdaptiveCrankScheduler] Error processing Pool #${poolId}:`,
                msg
              );
              this.metrics.incrementError("scheduler", "unhandled_pool_error");
            }
          } finally {
            this.inFlightPools.delete(poolId);
          }
        }
      }
    );

    await Promise.all(workers);
    return hadActiveWork;
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      try {
        const hadActiveWork = await this.tickOnce();

        const isCoolingDown = this.rateLimiter.isCoolingDown();
        if (!isCoolingDown) {
          await this.updateSignerBalance();
        }

        const cooldownRemaining = this.rateLimiter.getRemainingCooldownMs();
        const baseInterval = hadActiveWork
          ? this.config.activeWindowPollIntervalMs
          : this.config.pollIntervalMs;
        const nextDelay = Math.max(baseInterval, cooldownRemaining);

        this.scheduleNextTick(nextDelay);
      } catch (err: unknown) {
        console.error("[AdaptiveCrankScheduler] Fatal loop error:", err);
        this.scheduleNextTick(this.config.pollIntervalMs);
      }
    }, delayMs);
  }

  private async processPool(poolId: number): Promise<boolean> {
    if (!this.breaker.canExecute(poolId)) {
      console.warn(
        `[AdaptiveCrankScheduler] Circuit breaker is OPEN for Pool #${poolId}. Skipping.`
      );
      return false;
    }

    let snapshot;
    try {
      snapshot = await this.snapshotFetcher(this.rpc, poolId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isRetryableRpcError(err)) {
        console.warn(
          `[AdaptiveCrankScheduler] [Pool #${poolId}] RPC rate-limited or transient network error: ${msg}. Applying backoff cooldown.`
        );
        this.applyRateLimitCooldown(poolId, err);
        this.metrics.incrementError(
          "scheduler",
          isRateLimitRpcError(err) ? "rpc_rate_limited" : "rpc_network_error"
        );
      } else {
        console.error(
          `[AdaptiveCrankScheduler] Error fetching snapshot for Pool #${poolId}:`,
          msg
        );
        this.metrics.incrementError("scheduler", "unhandled_pool_error");
      }
      return false;
    }

    if (!snapshot) {
      console.warn(
        `[AdaptiveCrankScheduler] Pool #${poolId} account not found.`
      );
      return false;
    }

    this.metrics.updatePoolState(
      poolId,
      snapshot.pool.currentDrawCycleId,
      snapshot.pool.isFrozenForDraw === 1,
      snapshot.state
    );

    // Health recovery: Proactively reset breaker if pool is Active and healthy
    if (
      isPoolStatus(snapshot.pool.status, PoolStatus.Active) &&
      this.breaker.getState(poolId) !== "CLOSED"
    ) {
      this.breaker.recordSuccess(poolId);
    }

    if (isPoolStatus(snapshot.pool.status, PoolStatus.Active)) {
      this.activeCyclesObserved.set(poolId, snapshot.pool.currentDrawCycleId);
    }

    // 1. Passive skips
    if (snapshot.state === "POOL_CLOSED" || snapshot.state === "POOL_PAUSED") {
      return false;
    }

    // 2. Quarantine permanent on-chain halts (60s probe, no executor breaker corruption)
    if (snapshot.state === "CIRCUIT_BREAKER_HALTED") {
      // If this cycle was already observed as unpaused/active, an admin manually re-paused it
      if (
        this.activeCyclesObserved.get(poolId) ===
        snapshot.pool.currentDrawCycleId
      ) {
        return false;
      }

      const lastAlerted = this.alertedHaltCycles.get(poolId);
      if (lastAlerted !== snapshot.pool.currentDrawCycleId) {
        this.alertNotifier.notifyAlert(
          "ON_CHAIN_CIRCUIT_BREAKER_HALTED",
          `Pool #${poolId} on-chain circuit breaker halted: ${snapshot.reason}`,
          poolId,
          "error"
        );
        this.alertedHaltCycles.set(poolId, snapshot.pool.currentDrawCycleId);
      }
      this.nextEligibleTickMs.set(
        poolId,
        Date.now() + CIRCUIT_BREAKER_HALT_QUARANTINE_MS
      );
      return false;
    }

    // 3. Timelock waiting buffer (wakeup at readyAt + 2s clock skew safety buffer)
    if (snapshot.state === "TIMELOCK_WAITING") {
      const readyAtMs = Number(snapshot.readyAt) * 1000 + 2000;
      this.nextEligibleTickMs.set(poolId, readyAtMs);
      return false;
    }

    // 4. Telemetry: Check if PayoutRegistry can be closed manually to reclaim rent
    if (snapshot.latestPayoutRegistry) {
      const { account } = snapshot.latestPayoutRegistry;
      this.metrics.setPayoutRegistryClaimable(
        poolId,
        account.cycleId,
        canClosePayoutRegistry(account)
      );
    } else {
      this.metrics.clearPayoutRegistryClaimable(poolId);
    }

    // 5. Evaluate unified polymorphic tasks
    let executedAny = false;
    for (const task of this.tasks) {
      if (!task.canHandle(snapshot)) {
        continue;
      }

      try {
        const outcome = await task.evaluate(snapshot, this.context);
        if (outcome.shouldExecute) {
          console.log(
            `[AdaptiveCrankScheduler] [Pool #${poolId}] Task [${task.name}] triggered: ${outcome.reason}`
          );

          const result = await this.executor.executeInstructions({
            workerName: task.name,
            instructions: outcome.instructions,
            signer: this.signer,
            computeUnits: outcome.computeUnitLimit,
            priorityFeeTier: outcome.priorityFeeTier,
            writableAccounts: outcome.writableAccounts,
            additionalSigners: outcome.additionalSigners,
          });

          if (result.executed) {
            console.log(
              `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} succeeded. Tx: ${result.signature}`
            );
            await this.safeInvokeHook(() =>
              task.onSuccess?.(poolId, result.signature)
            );
            this.metrics.incrementTx(task.name, true);
            this.breaker.recordSuccess(poolId);
            executedAny = true;
          } else if (isDeferredOutcome(result.outcome)) {
            console.log(
              `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} deferred: ${result.outcome.status} - ${result.reason}`
            );
            await this.safeInvokeHook(() =>
              task.onDeferred?.(poolId, result.outcome as WorkerDeferredOutcome)
            );
            this.metrics.incrementDeferred(task.name, result.outcome.status);
            // CRITICAL: Deferrals (benign concurrency races or venue liquidity deficits) NEVER trip the pool circuit breaker!
          } else {
            const errToInspect =
              (result as { error?: unknown }).error ??
              (result.outcome as { error?: unknown }).error ??
              result.reason;
            if (isRetryableRpcError(errToInspect)) {
              console.warn(
                `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} failed due to transient RPC transport error: ${result.reason}. Applying rate limit cooldown.`
              );
              this.applyRateLimitCooldown(poolId, errToInspect);
              this.metrics.incrementError(
                task.name,
                isRateLimitRpcError(errToInspect)
                  ? "rpc_rate_limited"
                  : "rpc_network_error"
              );
              // CRITICAL: DO NOT trip circuit breaker on transport errors!
            } else {
              await this.safeInvokeHook(() =>
                task.onError?.(poolId, errToInspect)
              );
              const actionable =
                result.outcome.status === "ERROR" &&
                result.outcome.parsedError?.actionableStep
                  ? ` | Action: ${result.outcome.parsedError.actionableStep}`
                  : "";
              console.error(
                `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} failed: ${result.reason}${actionable}`
              );
              this.metrics.incrementTx(task.name, false);
              this.breaker.recordPoolFailure(poolId, result.reason);
            }
          }
        } else if (outcome.retryAfterMs) {
          this.nextEligibleTickMs.set(
            poolId,
            Date.now() + outcome.retryAfterMs
          );
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isRetryableRpcError(err)) {
          console.warn(
            `[AdaptiveCrankScheduler] [Pool #${poolId}] Task [${task.name}] transient RPC error: ${msg}`
          );
          this.applyRateLimitCooldown(poolId, err);
          this.metrics.incrementError(
            task.name,
            isRateLimitRpcError(err) ? "rpc_rate_limited" : "rpc_network_error"
          );
          // DO NOT call this.breaker.recordPoolFailure for transport errors
        } else {
          await this.safeInvokeHook(() => task.onError?.(poolId, err));
          console.error(
            `[AdaptiveCrankScheduler] [Pool #${poolId}] Task [${task.name}] error:`,
            msg
          );
          this.breaker.recordPoolFailure(poolId, msg);
        }
      }
    }

    return (
      executedAny ||
      snapshot.state === "PREPARE_BATCHING" ||
      snapshot.state === "READY_TO_DRAW" ||
      snapshot.state === "REINVESTMENT_PENDING" ||
      snapshot.state === "VRF_EXPIRED"
    );
  }

  private async updateSignerBalance(): Promise<void> {
    try {
      const balanceRes = await this.rpc
        .getBalance(this.signer.address, { commitment: "confirmed" })
        .send();
      const sol = Number(balanceRes.value) / 1_000_000_000;
      this.metrics.updateSolBalance(sol);

      if (sol < 0.2) {
        await this.alertNotifier.notifyLowBalance(sol);
      }
    } catch {}
  }

  private async safeInvokeHook(fn: () => void | Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.warn(
        `[AdaptiveCrankScheduler] Warning: Error executing task lifecycle hook: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
}
