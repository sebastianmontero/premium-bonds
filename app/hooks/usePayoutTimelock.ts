"use client";

import { useMemo } from "react";
import { useClusterTime } from "./useOnChainClock";
import {
  getPayoutTimelockState,
  PayoutTimelockState,
} from "../lib/draw-helpers";

interface UsePayoutTimelockOptions {
  resyncIntervalMs?: number;
}

/**
 * React hook that manages a live, Solana-cluster-synchronized countdown for the
 * Payout Settlement Timelock of a draw cycle or prize win.
 *
 * Automatically ticks every second and updates synchronously with cluster time.
 *
 * @param revealedAt - Unix timestamp (in seconds) when the draw was finalized.
 * @param payoutTimelockSeconds - Timelock delay in seconds (default: 300).
 * @param options - Additional clock sync options.
 * @returns PayoutTimelockState with isTimelocked, remainingSeconds, progressPercent, formattedRemaining, and formattedUnlockTime.
 */
export function usePayoutTimelock(
  revealedAt?: number,
  payoutTimelockSeconds: number = 300,
  options: UsePayoutTimelockOptions = {}
): PayoutTimelockState {
  const { now } = useClusterTime({
    resyncIntervalMs: options.resyncIntervalMs,
    tick: true,
  });

  return useMemo(() => {
    return getPayoutTimelockState(revealedAt, payoutTimelockSeconds, now);
  }, [revealedAt, payoutTimelockSeconds, now]);
}
