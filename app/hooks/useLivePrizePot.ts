"use client";

import { useEffect, useRef, useCallback } from "react";
import { formatTokenAmount } from "../lib/formatters";

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
  /** Optional label for console debugging (e.g., "USDC Pool" or "Homepage Stats") */
  debugLabel?: string;
}

const SECONDS_PER_YEAR = 365.25 * 86400; // 31,557,600

type WindowWithDebug = Window & { __DEBUG_YIELD__?: boolean };

export function useLivePrizePot({
  basePrizePot,
  totalDepositedPrincipal,
  tokenDecimals = 6,
  apy = 0.08,
  isFrozenForDraw = false,
  enabled = true,
  debugLabel = "Global",
}: UseLivePrizePotOptions) {
  const isDev = process.env.NODE_ENV === "development";
  const baseUi = basePrizePot / 10 ** tokenDecimals;
  const tvlUi = totalDepositedPrincipal / 10 ** tokenDecimals;

  const lastSyncTimeRef = useRef<number>(0);
  const lastLogTimeRef = useRef<number>(0);

  // Resync reference timestamp whenever basePrizePot or TVL updates (e.g., RPC refetch)
  useEffect(() => {
    lastSyncTimeRef.current = Date.now() / 1000;
    lastLogTimeRef.current = 0; // Trigger instant log on next tick after sync

    if (
      isDev &&
      (typeof window === "undefined" ||
        (window as WindowWithDebug).__DEBUG_YIELD__ !== false)
    ) {
      console.log(`[LiveYieldTicker: ${debugLabel}] RPC Parameters Synced:`, {
        formula: "baseUi = basePrizePotRaw / (10 ** tokenDecimals)",
        valuesRaw: {
          basePrizePotRaw: basePrizePot,
          tokenDecimals,
          totalDepositedPrincipalRaw: totalDepositedPrincipal,
          apy,
          isFrozenForDraw,
          enabled,
        },
        valuesFormatted: {
          baseUi: `${formatTokenAmount(basePrizePot, tokenDecimals)} USDC`,
          tvlUi: `${formatTokenAmount(totalDepositedPrincipal, tokenDecimals)} USDC`,
          apyPercent: `${(apy * 100).toFixed(2)}%`,
        },
        explanations: {
          basePrizePotRaw:
            "Raw on-chain net surplus yield in base units (micro-USDC)",
          tokenDecimals: "Token decimals precision (6 for USDC)",
          baseUi: "Converted human-readable base prize pot amount",
          tvlUi: "Total deposited principal in human-readable token UI units",
        },
      });
    }
  }, [
    basePrizePot,
    totalDepositedPrincipal,
    tokenDecimals,
    apy,
    isFrozenForDraw,
    enabled,
    debugLabel,
    baseUi,
    tvlUi,
    isDev,
  ]);

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
      const currentValue = baseUi + yieldAccrued;

      if (
        isDev &&
        (typeof window === "undefined" ||
          (window as WindowWithDebug).__DEBUG_YIELD__ !== false) &&
        nowInSeconds - lastLogTimeRef.current >= 10.0
      ) {
        lastLogTimeRef.current = nowInSeconds;
        console.log(
          `[LiveYieldTicker: ${debugLabel}] Calculation Tick (10s):`,
          {
            basePrizePotRaw: basePrizePot,
            baseUi,
            totalDepositedPrincipalRaw: totalDepositedPrincipal,
            tvlUi,
            apy,
            apyPercent: `${(apy * 100).toFixed(2)}%`,
            isFrozenForDraw,
            enabled,
            lastSyncTimestamp: lastSyncTimeRef.current,
            nowTimestamp: nowInSeconds,
            elapsedSeconds: Number(elapsed.toFixed(3)),
            yieldAccrued,
            currentValue,
          }
        );
      }

      return currentValue;
    },
    [
      baseUi,
      basePrizePot,
      totalDepositedPrincipal,
      tvlUi,
      apy,
      isFrozenForDraw,
      enabled,
      debugLabel,
      isDev,
    ]
  );

  return {
    calculateCurrentValue,
    baseUi,
    tvlUi,
    lastSyncTimeRef,
  };
}
