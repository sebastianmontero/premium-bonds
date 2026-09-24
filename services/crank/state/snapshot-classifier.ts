import { Address } from "@solana/kit";
import {
  PrizePool,
  DrawCycle,
  TicketRegistry,
  PayoutRegistry,
  ParsedPayoutRegistry,
  DrawStatus,
  PoolStatus,
} from "../../../app/lib/bonds-sdk";
import {
  PoolStateSnapshot,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
} from "../types";

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
  } = input;

  const base = {
    poolId: toPoolId(poolId),
    poolAddress,
    pool,
    ticketRegistryAddress,
    ticketRegistry,
    currentSlot,
    currentTimestamp: toUnixTimestamp(currentTimestamp),
  };

  const currentCycleId = toDrawCycleId(pool.currentDrawCycleId);

  // 1. Check for Closed or Paused pool
  if (
    pool.status === PoolStatus.Closed ||
    (pool.status as unknown) === "Closed"
  ) {
    return {
      ...base,
      state: "POOL_CLOSED",
    };
  }

  if (
    pool.status === PoolStatus.Paused ||
    (pool.status as unknown) === "Paused"
  ) {
    return {
      ...base,
      state: "POOL_PAUSED",
    };
  }

  // 2. Check for Circuit Breaker halts
  if (
    drawCycle?.status === DrawStatus.HaltedInsolvent ||
    drawCycle?.status === DrawStatus.HaltedYieldSpike
  ) {
    const reason =
      drawCycle.status === DrawStatus.HaltedInsolvent
        ? "HaltedInsolvent"
        : "HaltedYieldSpike";
    return {
      ...base,
      state: "CIRCUIT_BREAKER_HALTED",
      reason,
    };
  }

  // 3. Frozen for Draw (Drawing in progress)
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
      const elapsedSlots = currentSlot - BigInt(drawCycle.harvestSlot);
      if (elapsedSlots > 1000n) {
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
        harvestSlot: BigInt(drawCycle.harvestSlot),
      };
    }

    if (drawCycle?.status === DrawStatus.Skipped) {
      return {
        ...base,
        state: "DRAW_SKIPPED",
        cycleId: activeFrozenCycleId,
        reason: "Draw skipped during harvest",
      };
    }
  }

  // 3. PRIORITY INVERSION: Check for Pending Reinvestments from previous/current payout registry
  // Must drain all pending winners BEFORE triggering next harvest to avoid AwaitingRandomnessFreeze
  if (
    payoutRegistry &&
    payoutRegistryAddress &&
    payoutRegistry.revealedAt > 0n
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
      if (currentTimestamp < BigInt(timelockReadyAt)) {
        return {
          ...base,
          state: "TIMELOCK_WAITING",
          cycleId: payoutCycleId,
          readyAt: timelockReadyAt,
        };
      }

      return {
        ...base,
        state: "REINVESTMENT_PENDING",
        cycleId: payoutCycleId,
        payoutRegistryAddress,
        payoutRegistry,
        unprocessedWinners,
      };
    }
  }

  // 4. Yield Harvest Ready (only when previous draw payouts are resolved)
  if (
    currentTimestamp >= BigInt(pool.currentCycleEndAt) &&
    (pool.status === PoolStatus.Active || (pool.status as unknown) === "Active")
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
