import { Instruction } from "@solana/kit";
import {
  buildResizeRegistryInstruction,
  PoolStatus,
  canExpandTicketRegistry,
  ticketRegistrySpace,
  getRemainingRegistrySlots,
  isRegistryHeadroomDeficit,
  REGISTRY_EXPANSION_CHUNK_USERS,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
  WorkerDeferredOutcome,
} from "../types";
import { IAlertService } from "../alerts/alert-notifier";
import { isPoolStatus } from "../state/snapshot-classifier";
import {
  DEFAULT_REGISTRY_HEADROOM_SLOTS,
  DEFAULT_MAX_EXPANSIONS_PER_HOUR,
  DEFAULT_RPC_SETTLE_COOLDOWN_MS,
  MIN_SIGNER_EXPANSION_LAMPORTS,
  RegistryExpansionConfig,
  clampHeadroomSlots,
} from "../config";
import {
  RegistryExpansionThrottler,
  ExpansionAlertCategory,
} from "./registry-expansion-throttler";

export const DEFAULT_CAPACITY_ALERT_COOLDOWN_MS = 30 * 60 * 1000;
export const CAPACITY_EXPANSION_COMPUTE_UNITS = 80_000;

export class CapacitySentinelWorker implements ICrankTask {
  readonly name = "CapacitySentinelWorker";
  private readonly throttler: RegistryExpansionThrottler;
  private readonly pendingTargetCapacities = new Map<number, number>();

  constructor(
    private readonly alertNotifier?: IAlertService,
    private readonly configOverrides?: Partial<RegistryExpansionConfig>,
    clock?: () => number
  ) {
    this.throttler = new RegistryExpansionThrottler(
      {
        rpcCooldownMs:
          configOverrides?.rpcCooldownMs ?? DEFAULT_RPC_SETTLE_COOLDOWN_MS,
        maxExpansionsPerHour:
          configOverrides?.maxExpansionsPerHour ??
          DEFAULT_MAX_EXPANSIONS_PER_HOUR,
        alertCooldownMs: DEFAULT_CAPACITY_ALERT_COOLDOWN_MS,
      },
      clock
    );
  }

  canHandle(snapshot: PoolStateSnapshot): boolean {
    return (
      snapshot.state !== "POOL_CLOSED" &&
      snapshot.state !== "POOL_PAUSED" &&
      snapshot.state !== "CIRCUIT_BREAKER_HALTED"
    );
  }

  async evaluate(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<CrankTaskOutcome> {
    const registry = snapshot.ticketRegistry;
    if (
      !registry ||
      !Number.isSafeInteger(registry.capacity) ||
      registry.capacity <= 0
    ) {
      return { shouldExecute: false, reason: "Invalid registry capacity" };
    }

    if (!isPoolStatus(snapshot.pool.status, PoolStatus.Active)) {
      return {
        shouldExecute: false,
        reason: `Pool is not Active (${snapshot.pool.status}); skipping capacity resize`,
      };
    }

    if (snapshot.pool.isFrozenForDraw === 1) {
      return {
        shouldExecute: false,
        reason: "Pool is frozen for draw; skipping capacity resize",
      };
    }

    const rawThreshold =
      this.configOverrides?.headroomSlots ??
      context.config?.registryExpansion?.headroomSlots ??
      DEFAULT_REGISTRY_HEADROOM_SLOTS;
    const headroomThreshold = clampHeadroomSlots(rawThreshold);

    const remainingSlots = getRemainingRegistrySlots(registry);

    if (!isRegistryHeadroomDeficit(registry, headroomThreshold)) {
      return {
        shouldExecute: false,
        reason: `Registry headroom is healthy: ${remainingSlots} slots remaining (threshold: ${headroomThreshold})`,
      };
    }

    // 10MB account ceiling check
    if (!canExpandTicketRegistry(registry.capacity)) {
      const currentByteLen = ticketRegistrySpace(registry.capacity);
      await this.notifyAlertIfEligible(
        snapshot.poolId,
        "REGISTRY_CAPACITY_CRITICAL",
        "REGISTRY_CAPACITY_CRITICAL",
        `Ticket registry for Pool #${snapshot.poolId} has reached maximum 10MB size limit (${currentByteLen} bytes, ${registry.capacity} users). Cannot expand further!`,
        "critical"
      );
      return {
        shouldExecute: false,
        reason: `Ticket registry is at maximum SVM account size limit (10MB, ${registry.capacity} users). Cannot expand further.`,
      };
    }

    // RPC propagation settle check (Omit retryAfterMs to prevent scheduler starvation)
    if (
      this.throttler.isAwaitingRpcPropagation(
        snapshot.poolId,
        registry.capacity
      )
    ) {
      const waitSec = this.throttler.getRpcWaitRemainingSeconds(
        snapshot.poolId
      );
      return {
        shouldExecute: false,
        reason: `Awaiting RPC propagation for recent expansion (${waitSec}s remaining)`,
      };
    }

    // Hourly spend ceiling check (Omit retryAfterMs)
    if (
      this.throttler.isHourlyRateLimited(snapshot.poolId, headroomThreshold)
    ) {
      await this.notifyAlertIfEligible(
        snapshot.poolId,
        "EXPANSION_RATE_LIMIT",
        "REGISTRY_EXPANSION_RATE_LIMIT_EXCEEDED",
        `Pool #${snapshot.poolId} has reached expansion rate limit in 1h. Throttling automatic resizes.`,
        "error"
      );
      return {
        shouldExecute: false,
        reason: `Hourly expansion rate limit exceeded for pool #${snapshot.poolId}`,
      };
    }

    // Hot-wallet SOL reserve check (Prevent false circuit breaker halts)
    try {
      const balanceRes = await context.rpc
        .getBalance(context.signer.address)
        .send();
      const balanceLamports = balanceRes?.value ?? 0n;
      if (balanceLamports < MIN_SIGNER_EXPANSION_LAMPORTS) {
        await this.notifyAlertIfEligible(
          snapshot.poolId,
          "LOW_SOL_BALANCE",
          "CRANK_INSUFFICIENT_SOL_FOR_EXPANSION",
          `Signer SOL balance (${balanceLamports} lamports) is below required 0.15 SOL reserve for expansion rent. Skipping resize to prevent circuit breaker trip.`,
          "warning"
        );
        return {
          shouldExecute: false,
          reason: `Signer SOL balance insufficient for expansion rent (${balanceLamports} < ${MIN_SIGNER_EXPANSION_LAMPORTS})`,
        };
      }
    } catch (err: unknown) {
      console.warn(
        "[CapacitySentinelWorker] Failed to query signer balance before expansion:",
        err
      );
      return {
        shouldExecute: false,
        reason:
          "Failed to verify signer SOL balance; deferring expansion to avoid circuit breaker trip",
      };
    }

    const instructions = await this.buildInstructions(snapshot, context);
    const targetCapacity = registry.capacity + REGISTRY_EXPANSION_CHUNK_USERS;
    this.pendingTargetCapacities.set(snapshot.poolId, targetCapacity);

    return {
      shouldExecute: true,
      reason: `Registry headroom deficit: ${remainingSlots} slots remaining (threshold: ${headroomThreshold}). Triggering +10KB (+${REGISTRY_EXPANSION_CHUNK_USERS} slots) expansion.`,
      instructions,
      computeUnitLimit: this.getComputeUnitLimit(),
      priorityFeeTier: "low",
      writableAccounts: [snapshot.ticketRegistryAddress],
    };
  }

  private async notifyAlertIfEligible(
    poolId: number,
    category: ExpansionAlertCategory,
    eventType: string,
    message: string,
    severity: "warning" | "error" | "critical"
  ): Promise<void> {
    if (this.alertNotifier && this.throttler.shouldAlert(poolId, category)) {
      this.throttler.recordAlert(poolId, category);
      await this.alertNotifier.notifyAlert(
        eventType,
        message,
        poolId,
        severity
      );
    }
  }

  onSuccess(poolId: number, _signature?: string): void {
    const targetCapacity = this.pendingTargetCapacities.get(poolId);
    this.pendingTargetCapacities.delete(poolId);
    if (targetCapacity !== undefined) {
      this.throttler.recordExpansion(poolId, targetCapacity);
    }
  }

  onError(poolId: number, _error?: unknown): void {
    this.pendingTargetCapacities.delete(poolId);
  }

  onDeferred(poolId: number, _outcome?: WorkerDeferredOutcome): void {
    this.pendingTargetCapacities.delete(poolId);
  }

  reset(poolId?: number): void {
    if (poolId !== undefined) {
      this.pendingTargetCapacities.delete(poolId);
    } else {
      this.pendingTargetCapacities.clear();
    }
    this.throttler.reset(poolId);
  }

  getThrottler(): RegistryExpansionThrottler {
    return this.throttler;
  }

  async buildInstructions(
    snapshot: PoolStateSnapshot,
    context: CrankExecutionContext
  ): Promise<Instruction[]> {
    const ix = await buildResizeRegistryInstruction({
      payer: context.signer,
      poolId: snapshot.poolId,
      ticketRegistry: snapshot.ticketRegistryAddress,
    });
    return [ix];
  }

  getComputeUnitLimit(): number {
    return CAPACITY_EXPANSION_COMPUTE_UNITS;
  }
}
