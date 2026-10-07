import { REGISTRY_EXPANSION_CHUNK_USERS } from "../../../app/lib/ticket-registry-helpers";

const MS_PER_HOUR = 60 * 60 * 1000;
export const BURST_HEADROOM_SAFETY_CHUNKS = 4;

export type ExpansionAlertCategory =
  | "REGISTRY_CAPACITY_CRITICAL"
  | "EXPANSION_RATE_LIMIT"
  | "LOW_SOL_BALANCE";

export interface RegistryThrottlerConfig {
  readonly rpcCooldownMs: number;
  readonly maxExpansionsPerHour: number;
  readonly alertCooldownMs: number;
}

export function calculateDynamicHourlyLimit(
  headroomThreshold: number,
  configuredMaxPerHour: number
): number {
  const catchupChunks = Math.ceil(
    headroomThreshold / REGISTRY_EXPANSION_CHUNK_USERS
  );
  return Math.max(
    configuredMaxPerHour,
    catchupChunks + BURST_HEADROOM_SAFETY_CHUNKS
  );
}

export class RegistryExpansionThrottler {
  private readonly lastAlertAt = new Map<string, number>();
  private readonly lastExpansionInfo = new Map<
    number,
    { timestamp: number; targetCapacity: number }
  >();
  private readonly expansionHistory = new Map<number, number[]>();

  constructor(
    private readonly config: RegistryThrottlerConfig,
    private readonly clock: () => number = () => Date.now()
  ) {}

  isAwaitingRpcPropagation(poolId: number, currentCapacity: number): boolean {
    const lastExp = this.lastExpansionInfo.get(poolId);
    if (!lastExp) return false;
    const now = this.clock();
    return (
      currentCapacity < lastExp.targetCapacity &&
      now - lastExp.timestamp < this.config.rpcCooldownMs
    );
  }

  getRpcWaitRemainingSeconds(poolId: number): number {
    const lastExp = this.lastExpansionInfo.get(poolId);
    if (!lastExp) return 0;
    const remainingMs =
      this.config.rpcCooldownMs - (this.clock() - lastExp.timestamp);
    return Math.max(0, Math.ceil(remainingMs / 1000));
  }

  isHourlyRateLimited(poolId: number, headroomThreshold: number): boolean {
    const now = this.clock();
    const oneHourAgo = now - MS_PER_HOUR;
    const history = this.expansionHistory.get(poolId) ?? [];
    const activeCount = history.filter((ts) => ts >= oneHourAgo).length;
    const effectiveLimit = calculateDynamicHourlyLimit(
      headroomThreshold,
      this.config.maxExpansionsPerHour
    );
    return activeCount >= effectiveLimit;
  }

  recordExpansion(poolId: number, targetCapacity: number): void {
    const now = this.clock();
    const oneHourAgo = now - MS_PER_HOUR;
    this.lastExpansionInfo.set(poolId, { timestamp: now, targetCapacity });
    const unpruned = this.expansionHistory.get(poolId) ?? [];
    const pruned = unpruned.filter((ts) => ts >= oneHourAgo);
    this.expansionHistory.set(poolId, [...pruned, now]);
  }

  shouldAlert(poolId: number, category: ExpansionAlertCategory): boolean {
    const key = `${poolId}:${category}`;
    const last = this.lastAlertAt.get(key);
    if (last === undefined) return true;
    const now = this.clock();
    return now - last >= this.config.alertCooldownMs;
  }

  recordAlert(poolId: number, category: ExpansionAlertCategory): void {
    const key = `${poolId}:${category}`;
    this.lastAlertAt.set(key, this.clock());
  }

  reset(poolId?: number): void {
    if (poolId !== undefined) {
      for (const key of Array.from(this.lastAlertAt.keys())) {
        if (key.startsWith(`${poolId}:`)) this.lastAlertAt.delete(key);
      }
      this.lastExpansionInfo.delete(poolId);
      this.expansionHistory.delete(poolId);
    } else {
      this.lastAlertAt.clear();
      this.lastExpansionInfo.clear();
      this.expansionHistory.clear();
    }
  }
}
