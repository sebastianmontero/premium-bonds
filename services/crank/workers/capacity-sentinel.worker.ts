import { Instruction } from "@solana/kit";
import {
  buildResizeRegistryInstruction,
  PoolStatus,
} from "../../../app/lib/bonds-sdk";
import {
  CrankExecutionContext,
  PoolStateSnapshot,
  ICrankTask,
  CrankTaskOutcome,
} from "../types";
import { IAlertNotifier } from "../alerts/alert-notifier";

export const REGISTRY_HEADER_SIZE = 72;
export const USER_ENTRY_SIZE = 80;
export const MAX_REGISTRY_BYTE_LEN = 10_485_760; // 10MB SVM account size limit

export class CapacitySentinelWorker implements ICrankTask {
  readonly name = "CapacitySentinelWorker";

  constructor(private readonly alertNotifier?: IAlertNotifier) {}

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

    const currentByteLen =
      REGISTRY_HEADER_SIZE + registry.capacity * USER_ENTRY_SIZE;

    // Check 10MB ceiling
    if (currentByteLen + 10_240 > MAX_REGISTRY_BYTE_LEN) {
      if (this.alertNotifier) {
        await this.alertNotifier.notifyAlert(
          "REGISTRY_CAPACITY_CRITICAL",
          `Ticket registry for Pool #${snapshot.poolId} has reached maximum 10MB size limit (${currentByteLen} bytes). Cannot expand further!`,
          snapshot.poolId,
          "critical"
        );
      }
      return {
        shouldExecute: false,
        reason: `Ticket registry is at maximum SVM account size limit (10MB). Cannot expand further.`,
      };
    }

    const utilization = registry.userCount / registry.capacity;
    if (utilization >= 0.85) {
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
