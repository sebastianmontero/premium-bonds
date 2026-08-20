"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  formatTokenAmount,
  SECONDS_PER_YEAR,
  DEFAULT_APY,
  USDC_DECIMALS,
  calculateNetApy,
} from "../lib/formatters";
import type { PoolInfo } from "../types";

export interface LiveYieldCalculationParams {
  baseUi: number;
  tvlUi: number;
  apy: number;
  feeBasisPoints?: number;
  lastSyncedAt?: number;
  nowInSeconds: number;
  isFrozenForDraw?: boolean;
  enabled?: boolean;
}

/**
 * Pure, deterministic live yield calculation engine.
 * Reused by hooks, ticker loops, and unit tests without duplication.
 */
export function calculateLiveYield({
  baseUi,
  tvlUi,
  apy,
  feeBasisPoints = 0,
  lastSyncedAt,
  nowInSeconds,
  isFrozenForDraw = false,
  enabled = true,
}: LiveYieldCalculationParams): number {
  if (
    isFrozenForDraw ||
    !enabled ||
    tvlUi <= 0 ||
    apy <= 0 ||
    !lastSyncedAt ||
    lastSyncedAt <= 0
  ) {
    return baseUi;
  }
  // Guard against clock drift or negative elapsed time
  const elapsed = Math.max(0, nowInSeconds - lastSyncedAt);
  const netApy = calculateNetApy(apy, feeBasisPoints);
  const netYieldAccrued = (tvlUi * netApy * elapsed) / SECONDS_PER_YEAR;
  const currentVal = baseUi + netYieldAccrued;
  return Number.isFinite(currentVal) ? currentVal : baseUi;
}

export interface UseLivePrizePotOptions {
  /** Optional PoolInfo reference - properties are extracted automatically if provided */
  pool?: PoolInfo;
  /** Estimated base prize pot (in base units) */
  basePrizePot?: number;
  /** Total deposited principal (in base units) */
  totalDepositedPrincipal?: number;
  /** Token decimals (default 6 for USDC) */
  tokenDecimals?: number;
  /** Estimated Annual Percentage Yield (e.g., 0.085 for 8.5%) */
  apy?: number;
  /** Protocol reserve fee in basis points (e.g., 250 for 2.5%) */
  feeBasisPoints?: number;
  /** Whether the pool is currently frozen for draw execution */
  isFrozenForDraw?: boolean;
  /** Whether interpolation is enabled */
  enabled?: boolean;
  /** Timestamp in seconds when on-chain state was sampled */
  lastSyncedAt?: number;
  /** Optional label for console debugging (e.g., "USDC Pool" or "Homepage Stats") */
  debugLabel?: string;
}

type WindowWithDebug = Window & { __DEBUG_YIELD__?: boolean };

export function useLivePrizePot(options: UseLivePrizePotOptions) {
  const {
    pool,
    basePrizePot = pool?.estimatedPrizePot ?? 0,
    totalDepositedPrincipal = pool?.totalDepositedPrincipal ?? 0,
    tokenDecimals = pool?.tokenDecimals ?? USDC_DECIMALS,
    apy = pool?.underlyingApy ?? options.apy ?? DEFAULT_APY,
    feeBasisPoints = pool?.feeBasisPoints ?? options.feeBasisPoints ?? 0,
    isFrozenForDraw = pool?.isFrozenForDraw ?? false,
    enabled = true,
    lastSyncedAt = pool?.lastSyncedAt,
    debugLabel = pool?.tokenSymbol ?? "Global",
  } = options;

  const isDev = process.env.NODE_ENV === "development";
  const baseUi = basePrizePot / 10 ** tokenDecimals;
  const tvlUi = totalDepositedPrincipal / 10 ** tokenDecimals;

  const localSyncTimeRef = useRef<number>(0);
  const lastLogTimeRef = useRef<number>(0);

  // Initialize or update local sync baseline if lastSyncedAt is not explicitly provided
  useEffect(() => {
    localSyncTimeRef.current = Date.now() / 1000;
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
          lastSyncedAt,
        },
        valuesFormatted: {
          baseUi: `${formatTokenAmount(basePrizePot, tokenDecimals)} USDC`,
          tvlUi: `${formatTokenAmount(totalDepositedPrincipal, tokenDecimals)} USDC`,
          apyPercent: `${(apy * 100).toFixed(2)}%`,
          lastSyncedAt: lastSyncedAt ?? "local (Date.now())",
        },
        explanations: {
          basePrizePotRaw:
            "Raw on-chain net surplus yield in base units (micro-USDC)",
          tokenDecimals: "Token decimals precision (6 for USDC)",
          baseUi: "Converted human-readable base prize pot amount",
          tvlUi: "Total deposited principal in human-readable token UI units",
          lastSyncedAt:
            "Synchronized timestamp baseline for continuous yield accrual",
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
    lastSyncedAt,
    debugLabel,
    baseUi,
    tvlUi,
    isDev,
  ]);

  const syncTimestamp = lastSyncedAt ?? localSyncTimeRef.current;

  const calculateCurrentValue = useCallback(
    (nowInSeconds: number): number => {
      const currentValue = calculateLiveYield({
        baseUi,
        tvlUi,
        apy,
        feeBasisPoints,
        lastSyncedAt: syncTimestamp,
        nowInSeconds,
        isFrozenForDraw,
        enabled,
      });

      if (
        isDev &&
        (typeof window === "undefined" ||
          (window as WindowWithDebug).__DEBUG_YIELD__ !== false) &&
        nowInSeconds - lastLogTimeRef.current >= 10.0
      ) {
        lastLogTimeRef.current = nowInSeconds;
        const elapsed =
          syncTimestamp > 0 ? Math.max(0, nowInSeconds - syncTimestamp) : 0;
        const netApy = calculateNetApy(apy, feeBasisPoints);
        const yieldAccrued = (tvlUi * netApy * elapsed) / SECONDS_PER_YEAR;
        console.log(
          `[LiveYieldTicker: ${debugLabel}] Calculation Tick (10s):`,
          {
            basePrizePotRaw: basePrizePot,
            baseUi,
            totalDepositedPrincipalRaw: totalDepositedPrincipal,
            tvlUi,
            apy,
            feeBasisPoints,
            netApyPercent: `${(netApy * 100).toFixed(2)}%`,
            isFrozenForDraw,
            enabled,
            lastSyncTimestamp: syncTimestamp,
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
      feeBasisPoints,
      syncTimestamp,
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
    lastSyncTimestamp: syncTimestamp,
  };
}
