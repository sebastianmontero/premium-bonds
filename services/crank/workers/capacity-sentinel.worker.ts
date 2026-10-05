import { Instruction } from "@solana/kit";
import {
  buildResizeRegistryInstruction,
  PoolStatus,
  canExpandTicketRegistry,
  ticketRegistrySpace,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";
import { IAlertService } from "../alerts/alert-notifier";

export class CapacitySentinelWorker implements ICrankTask {
  readonly name = "CapacitySentinelWorker";
  private static readonly CRITICAL_ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
  private readonly lastCriticalAlertAt = new Map<number, number>();

  constructor(private readonly alertNotifier?: IAlertService) {}

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
    if (!registry || registry.capacity <= 0) {
      return { shouldExecute: false, reason: "Invalid registry capacity" };
    }

    // Skip if pool is not active
    if (
      snapshot.pool.status !== PoolStatus.Active &&
      (snapshot.pool.status as unknown) !== "Active"
    ) {
      return {
        shouldExecute: false,
        reason: `Pool is not Active (${snapshot.pool.status}); skipping capacity resize`,
      };
    }

    // Do not resize if draw is currently in progress
    if (snapshot.pool.isFrozenForDraw === 1) {
      return {
        shouldExecute: false,
        reason: "Pool is frozen for draw; skipping capacity resize",
      };
    }

    const utilization = registry.userCount / registry.capacity;
    if (utilization >= 0.85) {
      // Check discrete capacity ceiling before triggering expansion
      if (!canExpandTicketRegistry(registry.capacity)) {
        const currentByteLen = ticketRegistrySpace(registry.capacity);
        const now = Date.now();
        const lastAlert = this.lastCriticalAlertAt.get(snapshot.poolId) ?? 0;

        if (
          this.alertNotifier &&
          now - lastAlert >= CapacitySentinelWorker.CRITICAL_ALERT_COOLDOWN_MS
        ) {
          this.lastCriticalAlertAt.set(snapshot.poolId, now);
          await this.alertNotifier.notifyAlert(
            "REGISTRY_CAPACITY_CRITICAL",
            `Ticket registry for Pool #${snapshot.poolId} has reached maximum 10MB size limit (${currentByteLen} bytes, ${registry.capacity} users). Cannot expand further!`,
            snapshot.poolId,
            "critical"
          );
        }
        return {
          shouldExecute: false,
          reason: `Ticket registry is at maximum SVM account size limit (10MB, ${registry.capacity} users). Cannot expand further.`,
        };
      }

      const instructions = await this.buildInstructions(snapshot, context);
      return {
        shouldExecute: true,
        reason: `Registry utilization is ${(utilization * 100).toFixed(1)}% (${registry.userCount}/${registry.capacity}). Triggering +10KB expansion.`,
        instructions,
        computeUnitLimit: this.getComputeUnitLimit(),
        priorityFeeTier: "low",
        writableAccounts: [snapshot.ticketRegistryAddress],
      };
    }

    return {
      shouldExecute: false,
      reason: `Registry utilization is normal (${(utilization * 100).toFixed(1)}%)`,
    };
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
    return 80_000;
  }
}
