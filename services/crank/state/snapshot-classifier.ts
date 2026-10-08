import { Address } from "@solana/kit";
import {
  PrizePool,
  DrawCycle,
  TicketRegistry,
  PayoutRegistry,
  ParsedPayoutRegistry,
  DrawStatus,
  PoolStatus,
  isEnumStatus,
  isPayoutRegistryVoided,
  isPayoutRegistryActive,
  isDrawVoided,
} from "../../../app/lib/bonds-sdk";
import { isRandomnessExpired, MAX_CRANK_REBINDS } from "../constants";
import {
  PoolStateSnapshot,
  PayoutRegistrySnapshot,
  RandomnessHeader,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
  CircuitBreakerHaltReason,
} from "../types";
import { isRandomnessRevealed } from "../vrf/randomness-provider";

/**
 * Safely checks if an actual status matches a target PoolStatus variant (numeric, string, or Codama __kind object).
 */
export function isPoolStatus(actual: unknown, target: PoolStatus): boolean {
  return isEnumStatus(actual, PoolStatus, target);
}

/**
 * Resolves the circuit breaker halt reason if the draw cycle status indicates an on-chain halt.
 */
export function getCircuitBreakerHaltReason(
  status?: DrawStatus | null
): CircuitBreakerHaltReason | null {
  if (status == null) return null;
  const name =
    typeof status === "number"
      ? DrawStatus[status]
      : typeof status === "object" && status !== null && "__kind" in status
        ? (status as { __kind: string }).__kind
        : status;
  if (name === "HaltedInsolvent" || name === "HaltedYieldSpike") {
    return name;
  }
  return null;
}

export interface ClassifierWinnerEntry {
  winner: Address;
  processed?: number;
  isReinvested?: unknown;
  isClaimed?: unknown;
}

export interface ClassifierInput {
  poolId: number;
  poolAddress: Address;
  pool: PrizePool;
  ticketRegistryAddress: Address;
  ticketRegistry: TicketRegistry;
  drawCycle?: DrawCycle | null;
  payoutRegistryAddress?: Address | null;
  payoutRegistry?:
    | ParsedPayoutRegistry
    | (PayoutRegistry & { winners?: ClassifierWinnerEntry[] })
    | null;
  currentSlot: bigint;
  currentTimestamp: bigint;
  randomnessHeader?: RandomnessHeader | null;
}

export function classifyPoolState(input: ClassifierInput): PoolStateSnapshot {
  const {
    poolId,
    poolAddress,
    pool,
    ticketRegistryAddress,
    ticketRegistry,
    drawCycle,
    payoutRegistryAddress,
    payoutRegistry,
    currentSlot,
    currentTimestamp,
    randomnessHeader,
  } = input;

  const latestPayoutRegistry: PayoutRegistrySnapshot | undefined =
    payoutRegistry && payoutRegistryAddress
      ? {
          address: payoutRegistryAddress,
          account: payoutRegistry as ParsedPayoutRegistry,
        }
      : undefined;

  const base = {
    poolId: toPoolId(poolId),
    poolAddress,
    pool,
    ticketRegistryAddress,
    ticketRegistry,
    currentSlot,
    currentTimestamp: toUnixTimestamp(currentTimestamp),
    latestPayoutRegistry,
    randomnessHeader: randomnessHeader ?? undefined,
  };

  const currentCycleId = toDrawCycleId(pool.currentDrawCycleId);

  // 1. Check for Closed pool
  if (isPoolStatus(pool.status, PoolStatus.Closed)) {
    return {
      ...base,
      state: "POOL_CLOSED",
    };
  }

  // 2. Frozen for Draw (Drawing in progress - prioritized over Paused pool state)
  if (pool.isFrozenForDraw === 1) {
    const activeFrozenCycleId = toDrawCycleId(
      drawCycle?.cycleId ?? Math.max(0, pool.currentDrawCycleId - 1)
    );
    // Check batch preparation progress
    if (ticketRegistry.drawPreparedUpTo < ticketRegistry.userCount) {
      return {
        ...base,
        state: "PREPARE_BATCHING",
        cycleId: activeFrozenCycleId,
        cursor: ticketRegistry.drawPreparedUpTo,
        total: ticketRegistry.userCount,
      };
    }

    // All batches prepared: Check randomness state
    if (drawCycle && drawCycle.status === DrawStatus.AwaitingRandomness) {
      const vrfSeedSlot = drawCycle.vrfSeedSlot;
      const isRevealed = isRandomnessRevealed(randomnessHeader);

      // If randomness is already revealed on-chain, prioritize consumption over re-reveal / expiration
      if (isRevealed) {
        return {
          ...base,
          state: "READY_TO_DRAW",
          cycleId: activeFrozenCycleId,
          randomnessAccount: drawCycle.randomnessAccount as Address,
          vrfSeedSlot,
          drawMode: "consume_only",
        };
      }

      if (isRandomnessExpired(vrfSeedSlot, currentSlot)) {
        const rebindCount = Number(drawCycle.rebindCount ?? 0);
        if (rebindCount >= MAX_CRANK_REBINDS) {
          return {
            ...base,
            state: "NEEDS_ADMIN",
            reason: "REBIND_LIMIT_EXCEEDED",
            details: `Randomness expired after ${rebindCount} automated rebinds (max: ${MAX_CRANK_REBINDS}). Admin force unlock required.`,
          };
        }

        const elapsedSlots = currentSlot - vrfSeedSlot;
        return {
          ...base,
          state: "VRF_EXPIRED",
          cycleId: activeFrozenCycleId,
          staleRandomness: drawCycle.randomnessAccount as Address,
          elapsedSlots,
        };
      }

      return {
        ...base,
        state: "READY_TO_DRAW",
        cycleId: activeFrozenCycleId,
        randomnessAccount: drawCycle.randomnessAccount as Address,
        vrfSeedSlot,
        drawMode: "atomic",
      };
    }

    // Sealed frozen block: if drawCycle is in an unexpected or non-actionable phase while frozen,
    // hold in IDLE and NEVER fall through to Section 3 (reinvestment) or Section 4 (harvest).
    return {
      ...base,
      state: "IDLE",
      nextDrawAt: toUnixTimestamp(pool.currentCycleEndAt),
    };
  }

  // 3. Check for Paused pool
  if (isPoolStatus(pool.status, PoolStatus.Paused)) {
    const haltReason = getCircuitBreakerHaltReason(drawCycle?.status);
    if (haltReason) {
      return {
        ...base,
        state: "CIRCUIT_BREAKER_HALTED",
        reason: haltReason,
      };
    }
    return {
      ...base,
      state: "POOL_PAUSED",
    };
  }

  // 3. PRIORITY INVERSION: Check for Pending Reinvestments from previous/current payout registry
  // Must drain all pending winners BEFORE triggering next harvest to avoid AwaitingRandomnessFreeze
  const matchingDrawCycle =
    drawCycle && payoutRegistry && drawCycle.cycleId === payoutRegistry.cycleId
      ? drawCycle
      : undefined;

  if (
    payoutRegistry &&
    payoutRegistryAddress &&
    payoutRegistry.revealedAt > 0n &&
    !isPayoutRegistryVoided(payoutRegistry) &&
    isPayoutRegistryActive(payoutRegistry) &&
    !isDrawVoided(matchingDrawCycle)
  ) {
    const timelockDuration = BigInt(pool.payoutTimelockSeconds);
    const timelockReadyAt = toUnixTimestamp(
      payoutRegistry.revealedAt + timelockDuration
    );

    const unprocessedWinners: { winner: Address; winnerIndex: number }[] = [];
    const winners = (payoutRegistry as { winners?: ClassifierWinnerEntry[] })
      .winners;
    if (Array.isArray(winners)) {
      winners.forEach((w: ClassifierWinnerEntry, index: number) => {
        // Winner is unprocessed if processed is 0 (or neither reinvested nor claimed in mocks)
        const isProcessed =
          typeof w.processed === "number"
            ? w.processed !== 0
            : Boolean(w.isReinvested || w.isClaimed);
        if (!isProcessed) {
          unprocessedWinners.push({
            winner: w.winner,
            winnerIndex: index,
          });
        }
      });
    }

    if (unprocessedWinners.length > 0) {
      const payoutCycleId = toDrawCycleId(payoutRegistry.cycleId);
      const payoutSnapshot: PayoutRegistrySnapshot = {
        address: payoutRegistryAddress,
        account: payoutRegistry as ParsedPayoutRegistry,
      };

      if (currentTimestamp < BigInt(timelockReadyAt)) {
        return {
          ...base,
          state: "TIMELOCK_WAITING",
          cycleId: payoutCycleId,
          readyAt: timelockReadyAt,
          payoutRegistry: payoutSnapshot,
        };
      }

      return {
        ...base,
        state: "REINVESTMENT_PENDING",
        cycleId: payoutCycleId,
        payoutRegistry: payoutSnapshot,
        unprocessedWinners,
      };
    }
  }

  // 4. Yield Harvest Ready (only when previous draw payouts are resolved and pool is not frozen)
  if (
    pool.isFrozenForDraw === 0 &&
    currentTimestamp >= BigInt(pool.currentCycleEndAt) &&
    isPoolStatus(pool.status, PoolStatus.Active)
  ) {
    return {
      ...base,
      state: "YIELD_HARVEST_READY",
      currentCycleId,
    };
  }

  // 5. Default IDLE state
  return {
    ...base,
    state: "IDLE",
    nextDrawAt: toUnixTimestamp(pool.currentCycleEndAt),
  };
}
