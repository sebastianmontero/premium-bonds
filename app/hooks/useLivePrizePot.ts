"use client";

import { useEffect, useRef, useCallback } from "react";

export interface UseLivePrizePotOptions {
  /** Estimated base prize pot (in base units) */
  basePrizePot: number;
  /** Total deposited principal (in base units) */
  totalDepositedPrincipal: number;
  /** Token decimals (default 6 for USDC) */
  tokenDecimals?: number;
  /** Estimated Annual Percentage Yield (e.g., 0.08 for 8%) */
  apy?: number;
  /** Whether the pool is currently frozen for draw execution */
  isFrozenForDraw?: boolean;
  /** Whether interpolation is enabled */
  enabled?: boolean;
}

const SECONDS_PER_YEAR = 365.25 * 86400; // 31,557,600

export function useLivePrizePot({
  basePrizePot,
  totalDepositedPrincipal,
  tokenDecimals = 6,
  apy = 0.08,
  isFrozenForDraw = false,
  enabled = true,
}: UseLivePrizePotOptions) {
  const baseUi = basePrizePot / 10 ** tokenDecimals;
  const tvlUi = totalDepositedPrincipal / 10 ** tokenDecimals;

  const lastSyncTimeRef = useRef<number>(0);

  // Resync reference timestamp whenever basePrizePot or TVL updates (e.g., RPC refetch)
  useEffect(() => {
    lastSyncTimeRef.current = Date.now() / 1000;
  }, [basePrizePot, totalDepositedPrincipal, tokenDecimals]);

  // Tab visibility safety guard to prevent visual yield jumps on tab refocus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        lastSyncTimeRef.current = Date.now() / 1000;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  const calculateCurrentValue = useCallback(
    (nowInSeconds: number): number => {
      if (
        isFrozenForDraw ||
        !enabled ||
        tvlUi <= 0 ||
        apy <= 0 ||
        lastSyncTimeRef.current === 0
      ) {
        return baseUi;
      }
      const elapsed = Math.max(0, nowInSeconds - lastSyncTimeRef.current);
      const yieldAccrued = (tvlUi * apy * elapsed) / SECONDS_PER_YEAR;
      return baseUi + yieldAccrued;
    },
    [baseUi, tvlUi, apy, isFrozenForDraw, enabled]
  );

  return {
    calculateCurrentValue,
    baseUi,
    tvlUi,
    lastSyncTimeRef,
  };
}
