import { createSolanaRpc, KeyPairSigner, getBase64Encoder } from "@solana/kit";
import {
  findGlobalConfigPda,
  parseGlobalConfig,
  canClosePayoutRegistry,
} from "../../../app/lib/bonds-sdk";
import { CrankConfig } from "../config";
import { CrankExecutionContext, ICrankTask } from "../types";
import { fetchPoolStateSnapshot } from "../state/snapshot-fetcher";
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

export class AdaptiveCrankScheduler {
  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly rpc: ReturnType<typeof createSolanaRpc>;
  private readonly executor: TransactionExecutor;
  private readonly breaker: CircuitBreaker;
  private readonly alertNotifier: AlertNotifier;
  private readonly metrics: MetricsServer;
  private readonly vrfProvider: IVrfProvider;
  private readonly tasks: readonly ICrankTask[];
  private readonly context: CrankExecutionContext;
  private readonly inFlightPools: Set<number> = new Set();
  private readonly nextEligibleTickMs: Map<number, number> = new Map();
  private readonly maxConcurrentPools = 3;

  constructor(
    private readonly config: CrankConfig,
    private readonly signer: KeyPairSigner,
    metrics: MetricsServer
  ) {
    this.rpc = createSolanaRpc(config.rpcUrl);
    this.executor = new TransactionExecutor(this.rpc, config);
    this.alertNotifier = new AlertNotifier(config);
    this.breaker = new CircuitBreaker(5, 60_000, (event) => {
      if (event.type === "TRIP") {
        this.alertNotifier.notifyAlert(
          "CIRCUIT_BREAKER_TRIPPED",
          event.reason,
          event.poolId,
          "error"
        );
      }
    });
    this.metrics = metrics;
    this.vrfProvider = createVrfProvider(config.rpcUrl);

    this.context = {
      signer: this.signer,
      rpcUrl: config.rpcUrl,
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

  private async verifyJobsAccountAuthorization(): Promise<void> {
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
      const bytes = new Uint8Array(
        getBase64Encoder().encode(res.value.data[0])
      );
      const parsed = parseGlobalConfig(bytes);
      if (
        parsed.jobsAccount !== this.signer.address &&
        parsed.admin !== this.signer.address
      ) {
        throw new Error(
          `Crank signer ${this.signer.address} is NOT authorized on-chain. Expected jobsAccount: ${parsed.jobsAccount} or admin: ${parsed.admin}.`
        );
      }
      console.log(
        `[AdaptiveCrankScheduler] Signer verified as authorized on-chain crank authority.`
      );
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes("NOT authorized")) {
        throw err;
      }
      console.warn(
        `[AdaptiveCrankScheduler] Warning during startup authorization check: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async tickOnce(): Promise<boolean> {
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
            console.error(
              `[AdaptiveCrankScheduler] Error processing Pool #${poolId}:`,
              msg
            );
            this.metrics.incrementError("scheduler", "unhandled_pool_error");
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
        await this.updateSignerBalance();

        const nextDelay = hadActiveWork
          ? this.config.activeWindowPollIntervalMs
          : this.config.pollIntervalMs;

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

    const snapshot = await fetchPoolStateSnapshot(this.rpc, poolId);
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

    // 1. Passive skips
    if (snapshot.state === "POOL_CLOSED" || snapshot.state === "POOL_PAUSED") {
      return false;
    }

    // 2. Quarantine permanent halts (1 hour delay)
    if (snapshot.state === "CIRCUIT_BREAKER_HALTED") {
      this.breaker.recordPoolFailure(
        poolId,
        `On-chain circuit breaker halted: ${snapshot.reason}`,
        true
      );
      this.nextEligibleTickMs.set(poolId, Date.now() + 3_600_000); // 1h quarantine
      return false;
    }

    // 3. Timelock waiting buffer (wakeup at readyAt + 2s clock skew safety buffer)
    if (snapshot.state === "TIMELOCK_WAITING") {
      const readyAtMs = Number(snapshot.readyAt) * 1000 + 2000;
      this.nextEligibleTickMs.set(poolId, readyAtMs);
      return false;
    }

    // 4. Telemetry: Check if PayoutRegistry can be closed manually to reclaim rent
    if (snapshot.state === "REINVESTMENT_PENDING" && snapshot.payoutRegistry) {
      const claimable = canClosePayoutRegistry(snapshot.payoutRegistry);
      this.metrics.setPayoutRegistryClaimable(
        poolId,
        snapshot.payoutRegistry.cycleId,
        claimable
      );
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

          const result = await this.executor.executeInstructions(
            task.name,
            outcome.instructions,
            this.signer,
            {
              computeUnits: outcome.computeUnitLimit,
              priorityFeeTier: outcome.priorityFeeTier,
              writableAccounts: outcome.writableAccounts,
            }
          );

          if (result.executed) {
            console.log(
              `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} succeeded. Tx: ${result.signature}`
            );
            this.metrics.incrementTx(task.name, true);
            this.breaker.recordSuccess(poolId);
            executedAny = true;
          } else if (result.outcome === "CONCURRENCY_RACE_LOST") {
            console.log(
              `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} benign race lost. State already progressed.`
            );
            // Do not trip circuit breaker on benign race
          } else {
            console.error(
              `[AdaptiveCrankScheduler] [Pool #${poolId}] ${task.name} failed: ${result.reason}`
            );
            this.metrics.incrementTx(task.name, false);
            this.breaker.recordPoolFailure(poolId, result.reason);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(
          `[AdaptiveCrankScheduler] [Pool #${poolId}] Task [${task.name}] error:`,
          msg
        );
        this.breaker.recordPoolFailure(poolId, msg);
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
}
