import { Address } from "@solana/kit";
import {
  PrizePool,
  DrawCycle,
  TicketRegistry,
  PayoutRegistry,
  DrawStatus,
  PoolStatus,
} from "../../../app/lib/bonds-sdk";
import {
  PoolStateSnapshot,
  toPoolId,
  toDrawCycleId,
  toUnixTimestamp,
} from "../types";

export interface ClassifierInput {
  poolId: number;
  poolAddress: Address;
  pool: PrizePool;
  ticketRegistryAddress: Address;
  ticketRegistry: TicketRegistry;
  drawCycle?: DrawCycle | null;
  payoutRegistryAddress?: Address | null;
  payoutRegistry?: PayoutRegistry | null;
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

  // 1. Check for Circuit Breaker halts or paused pool
  if (
    drawCycle?.status === DrawStatus.HaltedInsolvent ||
    drawCycle?.status === DrawStatus.HaltedYieldSpike ||
    pool.status === PoolStatus.Paused
  ) {
    const reason =
      drawCycle?.status === DrawStatus.HaltedInsolvent
        ? "HaltedInsolvent"
        : drawCycle?.status === DrawStatus.HaltedYieldSpike
          ? "HaltedYieldSpike"
          : "PoolPaused";
    return {
      ...base,
      state: "CIRCUIT_BREAKER_HALTED",
      reason,
    };
  }

  // 2. Frozen for Draw (Drawing in progress)
  if (pool.isFrozenForDraw === 1) {
    // Check batch preparation progress
    if (ticketRegistry.drawPreparedUpTo < ticketRegistry.userCount) {
      return {
        ...base,
        state: "PREPARE_BATCHING",
        cycleId: currentCycleId,
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
          cycleId: currentCycleId,
          staleRandomness: drawCycle.randomnessAccount as Address,
          elapsedSlots,
        };
      }

      return {
        ...base,
        state: "READY_TO_DRAW",
        cycleId: currentCycleId,
        randomnessAccount: drawCycle.randomnessAccount as Address,
      };
    }

    if (drawCycle?.status === DrawStatus.Skipped) {
      return {
        ...base,
        state: "DRAW_SKIPPED",
        cycleId: currentCycleId,
        reason: "Draw skipped during harvest",
      };
    }
  }

  // 3. Not Frozen for Draw: Check if yield harvest is due
  if (
    currentTimestamp >= BigInt(pool.currentCycleEndAt) &&
    pool.status === PoolStatus.Active
  ) {
    return {
      ...base,
      state: "YIELD_HARVEST_READY",
      currentCycleId,
    };
  }

  // 4. Check for Pending Reinvestments from previous/current payout registry
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
    if (Array.isArray(payoutRegistry.winners)) {
      payoutRegistry.winners.forEach((w, index) => {
        // Winner is unprocessed if processed is 0 (or neither reinvested nor claimed in mocks)
        const isProcessed =
          typeof w.processed === "number"
            ? w.processed !== 0
            : Boolean(
                (w as { isReinvested?: unknown }).isReinvested ||
                (w as { isClaimed?: unknown }).isClaimed
              );
        if (!isProcessed) {
          unprocessedWinners.push({
            winner: w.winner as Address,
            winnerIndex: index,
          });
        }
      });
    }

    if (unprocessedWinners.length > 0) {
      if (currentTimestamp < BigInt(timelockReadyAt)) {
        return {
          ...base,
          state: "TIMELOCK_WAITING",
          cycleId: currentCycleId,
          readyAt: timelockReadyAt,
        };
      }

      return {
        ...base,
        state: "REINVESTMENT_PENDING",
        cycleId: currentCycleId,
        payoutRegistryAddress,
        payoutRegistry,
        unprocessedWinners,
      };
    }
  }

  // 5. Default IDLE state
  return {
    ...base,
    state: "IDLE",
    nextDrawAt: toUnixTimestamp(pool.currentCycleEndAt),
  };
}
