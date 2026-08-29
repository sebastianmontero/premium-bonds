import { createSolanaRpc, KeyPairSigner } from "@solana/kit";
import { CrankConfig } from "../config";
import {
  CrankExecutionContext,
  ICrankWorker,
  PoolStateSnapshot,
} from "../types";
import { fetchPoolStateSnapshot } from "../state/snapshot-fetcher";
import { TransactionExecutor } from "../executor/tx-executor";
import { CircuitBreaker } from "../executor/circuit-breaker";
import { MetricsServer } from "../metrics/metrics-server";
import { ILeaderLock } from "../leader/leader-lock";
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
  private readonly metrics: MetricsServer;
  private readonly leaderLock: ILeaderLock;
  private readonly vrfProvider: IVrfProvider;
  private readonly workers: ICrankWorker<PoolStateSnapshot>[];
  private readonly capacitySentinel: CapacitySentinelWorker;
  private readonly disburseSentinel: DisburseSentinelWorker;
  private readonly context: CrankExecutionContext;

  constructor(
    private readonly config: CrankConfig,
    private readonly signer: KeyPairSigner,
    leaderLock: ILeaderLock,
    metrics: MetricsServer
  ) {
    this.rpc = createSolanaRpc(config.rpcUrl);
    this.executor = new TransactionExecutor(this.rpc, config);
    this.breaker = new CircuitBreaker(config);
    this.metrics = metrics;
    this.leaderLock = leaderLock;
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

    this.workers = [
      new HarvestYieldWorker(this.vrfProvider),
      new PrepareDrawWorker(),
      new RebindRandomnessWorker(this.vrfProvider),
      new AtomicRevealWorker(this.vrfProvider),
      new ReinvestWinningsWorker(),
    ];

    this.capacitySentinel = new CapacitySentinelWorker();
    this.disburseSentinel = new DisburseSentinelWorker();
  }

  async start(): Promise<void> {
    this.isRunning = true;
    console.log(
      `[AdaptiveCrankScheduler] Started daemon for pools: [${this.config.poolIds.join(", ")}]`
    );
    console.log(
      `[AdaptiveCrankScheduler] Signer: ${this.signer.address} | RPC: ${this.config.rpcUrl}`
    );

    // Initial check on balance
    await this.updateSignerBalance();

    this.scheduleNextTick(0);
  }

  async stop(): Promise<void> {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.leaderLock.release();
    console.log("[AdaptiveCrankScheduler] Daemon stopped.");
  }

  async tickOnce(): Promise<boolean> {
    let hadActiveWork = false;

    for (const poolId of this.config.poolIds) {
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
      }
    }

    return hadActiveWork;
  }

  private scheduleNextTick(delayMs: number): void {
    if (!this.isRunning) return;

    this.timer = setTimeout(async () => {
      try {
        const isLeader = await this.leaderLock.acquire();
        if (!isLeader) {
          console.log(
            "[AdaptiveCrankScheduler] Standby instance (not active leader). Skipping tick."
          );
          this.scheduleNextTick(this.config.pollIntervalMs);
          return;
        }

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
    if (!this.breaker.canExecute()) {
      console.warn(
        `[AdaptiveCrankScheduler] Circuit breaker is OPEN. Skipping pool #${poolId}.`
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

    // 1. Check Circuit Breaker trigger on on-chain state
    if (snapshot.state === "CIRCUIT_BREAKER_HALTED") {
      await this.breaker.recordFailure(
        `On-chain circuit breaker halted: ${snapshot.reason}`,
        true
      );
      return false;
    }

    // 2. Find matching Strategy Worker
    const worker = this.workers.find((w) => w.targetState === snapshot.state);
    if (worker) {
      const decision = worker.evaluate(snapshot, this.context);
      if (decision.shouldExecute) {
        console.log(
          `[AdaptiveCrankScheduler] [Pool #${poolId}] Worker [${worker.name}] triggered: ${decision.reason}`
        );

        const instructions = await worker.buildInstructions(
          snapshot,
          this.context
        );
        const cuLimit = worker.getComputeUnitLimit(snapshot);

        const result = await this.executor.executeInstructions(
          worker.name,
          instructions,
          this.signer,
          {
            computeUnits: cuLimit,
            priorityFeeTier: decision.priorityFeeTier,
            writableAccounts: [
              snapshot.poolAddress,
              snapshot.ticketRegistryAddress,
            ],
          }
        );

        if (result.executed) {
          console.log(
            `[AdaptiveCrankScheduler] [Pool #${poolId}] ${worker.name} succeeded. Tx: ${result.signature}`
          );
          this.metrics.incrementTx(worker.name, true);
          this.breaker.recordSuccess();
          return true;
        } else {
          console.error(
            `[AdaptiveCrankScheduler] [Pool #${poolId}] ${worker.name} failed: ${result.reason}`
          );
          this.metrics.incrementTx(worker.name, false);
          await this.breaker.recordFailure(result.reason);
          return false;
        }
      }
    }

    // 3. Run Housekeeping Sentinels (Capacity & Disburse)
    const capacityDecision = this.capacitySentinel.evaluate(
      snapshot,
      this.context
    );
    if (capacityDecision.shouldExecute) {
      console.log(
        `[AdaptiveCrankScheduler] [Pool #${poolId}] Sentinel [${this.capacitySentinel.name}]: ${capacityDecision.reason}`
      );
      const instructions = await this.capacitySentinel.buildInstructions(
        snapshot,
        this.context
      );
      const res = await this.executor.executeInstructions(
        this.capacitySentinel.name,
        instructions,
        this.signer,
        {
          computeUnits: this.capacitySentinel.getComputeUnitLimit(),
          priorityFeeTier: "low",
        }
      );
      if (res.executed) {
        this.metrics.incrementTx(this.capacitySentinel.name, true);
      }
    }

    return (
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

      if (sol < 0.5 && !this.config.dryRun) {
        console.warn(
          `[AdaptiveCrankScheduler] ⚠️ Crank signer SOL balance is low: ${sol.toFixed(4)} SOL`
        );
      }
    } catch {}
  }
}
