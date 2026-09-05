"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  resolvePoolThresholdBreakdown,
  calculateLiveYieldBreakdown,
  formatLiveYieldMetric,
  DEFAULT_LIVE_YIELD_PRECISION,
} from "@/app/lib/formatters";
import { safeSetElementText } from "@/app/lib/dom-utils";
import type { PoolInfo } from "@/app/types";

export interface DrawTargetTooltipProps {
  pool: PoolInfo;
  className?: string;
}

export function DrawTargetTooltip({
  pool,
  className = "",
}: DrawTargetTooltipProps) {
  const t = useTranslations("Pools");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const liveNetSpanRef = useRef<HTMLSpanElement | null>(null);
  const liveGrossSpanRef = useRef<HTMLSpanElement | null>(null);

  const breakdown = resolvePoolThresholdBreakdown(pool, pool.tokenDecimals);
  const tokenSymbol = pool.tokenSymbol ?? "USDC";

  // 60 FPS Live Yield Ticker Loop (active only when open and not frozen)
  useEffect(() => {
    if (!isOpen || pool.isFrozenForDraw) return;

    let animFrameId: number;

    const tick = () => {
      const nowInSeconds = Date.now() / 1000;
      const live = calculateLiveYieldBreakdown(
        pool,
        nowInSeconds,
        pool.tokenDecimals
      );

      safeSetElementText(
        liveNetSpanRef.current,
        formatLiveYieldMetric(
          live.netYieldUi,
          tokenSymbol,
          "",
          DEFAULT_LIVE_YIELD_PRECISION
        )
      );

      safeSetElementText(
        liveGrossSpanRef.current,
        formatLiveYieldMetric(
          live.grossYieldUi,
          tokenSymbol,
          "",
          DEFAULT_LIVE_YIELD_PRECISION
        )
      );

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [
    isOpen,
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
  ]);

  // Handle outside clicks and Escape key with focus restoration
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const targetNetFormatted = formatLiveYieldMetric(
    breakdown.net.targetUi,
    tokenSymbol,
    "",
    DEFAULT_LIVE_YIELD_PRECISION
  );
  const targetGrossFormatted = formatLiveYieldMetric(
    breakdown.gross.targetUi,
    tokenSymbol,
    "",
    DEFAULT_LIVE_YIELD_PRECISION
  );
  const initialNetFormatted = formatLiveYieldMetric(
    breakdown.net.currentUi,
    tokenSymbol,
    "",
    DEFAULT_LIVE_YIELD_PRECISION
  );
  const initialGrossFormatted = formatLiveYieldMetric(
    breakdown.gross.currentUi,
    tokenSymbol,
    "",
    DEFAULT_LIVE_YIELD_PRECISION
  );

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("drawTargetTooltipLabel")}
        className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-on-surface-variant/70 hover:text-primary transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40 rounded-full"
      >
        <svg
          className="h-3.5 w-3.5 shrink-0"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="10" strokeWidth="2" />
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2"
            d="M12 16v-4m0-4h.01"
          />
        </svg>
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label={t("drawTargetTitle")}
          className="absolute left-0 top-full mt-2 w-72 sm:w-84 max-w-[calc(100vw-2.5rem)] rounded-2xl glass-strong border border-primary/20 p-4 shadow-2xl z-50 text-xs space-y-3 pointer-events-auto animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-outline-variant/15">
            <div className="flex items-center gap-1.5 font-display font-bold text-on-surface">
              <svg
                className="w-3.5 h-3.5 text-amber-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              <span>{t("drawTargetTitle")}</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary/10 border border-secondary/20 px-2 py-0.5 text-[10px] font-semibold text-secondary">
              {breakdown.isConfigured
                ? breakdown.isMet
                  ? t("yieldTargetMet")
                  : `${breakdown.progressPercent.toFixed(1)}%`
                : t("yieldTargetNotSet")}
            </span>
          </div>

          {/* Explanation Text */}
          <p className="text-[11px] text-on-surface-variant leading-relaxed">
            {t("drawTargetExplanation")}
          </p>

          {/* Target Breakdown Table */}
          {breakdown.isConfigured ? (
            <div className="space-y-1.5 rounded-lg bg-surface-container/60 p-2.5 border border-outline-variant/10 text-[11px]">
              <div className="flex justify-between text-on-surface-variant">
                <span>{t("netTargetLabel")}</span>
                <span className="font-mono font-semibold text-secondary tabular-nums">
                  <span ref={liveNetSpanRef} aria-hidden="true">
                    {initialNetFormatted}
                  </span>
                  <span className="text-on-surface-variant font-normal">
                    {" "}
                    / {targetNetFormatted}
                  </span>
                </span>
              </div>

              <div className="flex justify-between text-on-surface-variant">
                <span>{t("grossTargetLabel")}</span>
                <span className="font-mono text-on-surface tabular-nums">
                  <span ref={liveGrossSpanRef} aria-hidden="true">
                    {initialGrossFormatted}
                  </span>
                  <span className="text-on-surface-variant">
                    {" "}
                    / {targetGrossFormatted}
                  </span>
                </span>
              </div>

              {breakdown.feeBasisPoints > 0 && (
                <div className="flex justify-between text-on-surface-variant text-[10px]">
                  <span>
                    {t("protocolFee", {
                      percent: breakdown.feePercentFormatted,
                    })}
                  </span>
                  <span className="font-mono text-on-surface-variant">
                    {breakdown.feePercentFormatted}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-lg bg-surface-container/60 p-2.5 border border-outline-variant/10 text-[11px] text-on-surface-variant">
              {t("noMinimumTarget")}
            </div>
          )}

          {/* Execution & Rollover Details */}
          <div className="space-y-1 text-[10px] text-on-surface-variant">
            <div className="flex items-start gap-1.5">
              <span className="text-secondary shrink-0 font-bold">✓</span>
              <span>{t("targetMetExecution")}</span>
            </div>
            <div className="flex items-start gap-1.5">
              <span className="text-amber-400 shrink-0 font-bold">↺</span>
              <span>{t("targetUnmetRollover")}</span>
            </div>
          </div>

          {/* Lossless Note */}
          <div className="rounded-lg bg-secondary/10 p-2 text-[10px] text-secondary leading-relaxed border border-secondary/20">
            <p className="flex items-start gap-1">
              <span className="shrink-0 font-bold">🛡️</span>
              <span>{t("losslessRolloverNote")}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
