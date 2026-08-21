"use client";

import { useEffect, useState, useCallback } from "react";
import { useOnChainClock } from "./useOnChainClock";
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
 * Automatically ticks every second only while `isTimelocked` is true and stops
 * ticking once the timelock window elapses.
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
  const { clockOffset } = useOnChainClock({
    resyncIntervalMs: options.resyncIntervalMs,
  });

  const getNow = useCallback(
    () => Math.floor(Date.now() / 1000) + clockOffset,
    [clockOffset]
  );

  const [timelockState, setTimelockState] = useState<PayoutTimelockState>(() =>
    getPayoutTimelockState(revealedAt, payoutTimelockSeconds, getNow())
  );

  useEffect(() => {
    const initial = getPayoutTimelockState(
      revealedAt,
      payoutTimelockSeconds,
      getNow()
    );
    if (!initial.isTimelocked) return;

    const intervalId = setInterval(() => {
      const current = getPayoutTimelockState(
        revealedAt,
        payoutTimelockSeconds,
        getNow()
      );
      setTimelockState(current);
      if (!current.isTimelocked) {
        clearInterval(intervalId);
      }
    }, 1000);

    return () => clearInterval(intervalId);
  }, [revealedAt, payoutTimelockSeconds, getNow]);

  return timelockState;
}
