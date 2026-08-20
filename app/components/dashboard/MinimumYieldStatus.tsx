"use client";

import { useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  resolvePoolThresholdBreakdown,
  calculateLiveYieldBreakdown,
  formatLiveYieldMetric,
  DEFAULT_LIVE_YIELD_PRECISION,
} from "@/app/lib/formatters";
import { DrawTargetTooltip } from "./DrawTargetTooltip";
import type { PoolInfo } from "@/app/types";

interface MinimumYieldStatusProps {
  pool: PoolInfo;
  className?: string;
}

export function MinimumYieldStatus({
  pool,
  className = "",
}: MinimumYieldStatusProps) {
  const t = useTranslations("Pools");
  const breakdown = resolvePoolThresholdBreakdown(pool, pool.tokenDecimals);
  const tokenSymbol = pool.tokenSymbol ?? "USDC";

  const currentNetSpanRef = useRef<HTMLSpanElement>(null);
  const percentSpanRef = useRef<HTMLSpanElement>(null);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const statusTextRef = useRef<HTMLSpanElement>(null);
  const isLiveMetRef = useRef<boolean>(breakdown.isMet);

  const initialNetFormatted = formatLiveYieldMetric(
    breakdown.net.currentUi,
    tokenSymbol,
    "",
    DEFAULT_LIVE_YIELD_PRECISION
  );
  const targetNetFormatted = formatLiveYieldMetric(
    breakdown.net.targetUi,
    tokenSymbol,
    "",
    DEFAULT_LIVE_YIELD_PRECISION
  );

  // 60 FPS Live Yield Ticker Loop (mutates DOM nodes directly without React re-renders)
  useEffect(() => {
    if (!breakdown.isConfigured || pool.isFrozenForDraw) return;

    let animFrameId: number;

    const tick = () => {
      const nowInSeconds = Date.now() / 1000;
      const live = calculateLiveYieldBreakdown(
        pool,
        nowInSeconds,
        pool.tokenDecimals
      );
      const currentNetUi = live.netYieldUi;
      const targetNetUi = breakdown.net.targetUi;

      const progressPct =
        targetNetUi > 0
          ? Math.min(100, Math.max(0, (currentNetUi / targetNetUi) * 100))
          : 100;

      if (currentNetSpanRef.current) {
        currentNetSpanRef.current.textContent = formatLiveYieldMetric(
          currentNetUi,
          tokenSymbol,
          "",
          DEFAULT_LIVE_YIELD_PRECISION
        );
      }

      if (percentSpanRef.current) {
        percentSpanRef.current.textContent = `${progressPct.toFixed(1)}%`;
      }

      if (progressBarRef.current) {
        progressBarRef.current.style.width = `${progressPct}%`;
        if (progressPct >= 100) {
          progressBarRef.current.className =
            "h-full rounded-full bg-secondary transition-all duration-300";
        }
      }

      if (progressPct >= 100 && !isLiveMetRef.current) {
        isLiveMetRef.current = true;
        if (statusTextRef.current) {
          statusTextRef.current.textContent = t("prizePotTargetMet");
        }
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [
    breakdown.isConfigured,
    breakdown.net.targetUi,
    pool.isFrozenForDraw,
    pool.grossYield,
    pool.protocolFeeAmount,
    pool.estimatedPrizePot,
    pool.totalDepositedPrincipal,
    pool.tokenDecimals,
    pool.underlyingApy,
    pool.feeBasisPoints,
    pool.lastSyncedAt,
    tokenSymbol,
    pool,
    t,
  ]);

  if (!breakdown.isConfigured) {
    return (
      <div
        className={`flex items-center justify-between gap-1.5 text-[11px] text-on-surface-variant/80 ${className}`}
      >
        <div className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary/80 shrink-0" />
          <span>{t("noMinimumTarget")}</span>
        </div>
        <DrawTargetTooltip pool={pool} />
      </div>
    );
  }

  if (breakdown.isMet) {
    return (
      <div className={`space-y-1.5 text-[11px] ${className}`}>
        <div className="flex items-center justify-between text-on-surface-variant">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-secondary shrink-0 animate-pulse" />
            <span className="font-medium text-secondary truncate">
              {t("prizePotTargetMet")}
            </span>
            <DrawTargetTooltip pool={pool} />
          </div>

          <div className="flex items-center gap-2 font-mono text-[10px] shrink-0 tabular-nums">
            <span className="text-secondary font-semibold">
              {initialNetFormatted} / {targetNetFormatted}
            </span>
            <span className="font-bold text-secondary">100.0%</span>
          </div>
        </div>

        <div
          role="progressbar"
          aria-valuenow={100}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("drawTargetTitle")}
          className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high/60"
        >
          <div
            className="h-full rounded-full bg-secondary transition-all duration-300"
            style={{ width: "100%" }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={`space-y-1.5 text-[11px] ${className}`}>
      <div className="flex items-center justify-between text-on-surface-variant">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={`h-1.5 w-1.5 rounded-full shrink-0 ${
              breakdown.isMet ? "bg-secondary animate-pulse" : "bg-amber-400"
            }`}
          />
          <span
            ref={statusTextRef}
            className="font-medium truncate text-on-surface"
          >
            {breakdown.isMet
              ? t("prizePotTargetMet")
              : t("prizePotTargetAccumulating")}
          </span>
          <DrawTargetTooltip pool={pool} />
        </div>

        <div className="flex items-center gap-2 font-mono text-[10px] shrink-0 tabular-nums">
          <span className="text-on-surface-variant">
            <span ref={currentNetSpanRef} aria-hidden="true">
              {initialNetFormatted}
            </span>
            <span className="sr-only">
              {t("drawTargetProgressSr", {
                current: initialNetFormatted,
                target: targetNetFormatted,
                percent: breakdown.progressPercent.toFixed(1),
              })}
            </span>
            <span aria-hidden="true"> / {targetNetFormatted}</span>
          </span>
          <span
            ref={percentSpanRef}
            aria-hidden="true"
            className="font-semibold text-on-surface"
          >
            {breakdown.progressPercent.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Accessible Progress Bar Container */}
      <div
        role="progressbar"
        aria-valuenow={Math.round(breakdown.progressPercent)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={t("drawTargetTitle")}
        className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high/60"
      >
        <div
          ref={progressBarRef}
          className={`h-full rounded-full transition-all duration-300 ${
            breakdown.isMet ? "bg-secondary" : "bg-amber-400/80"
          }`}
          style={{ width: `${breakdown.progressPercent}%` }}
        />
      </div>
    </div>
  );
}
