"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import {
  resolvePoolYieldBreakdown,
  calculateLiveYieldBreakdown,
  formatLiveYieldMetric,
  DEFAULT_LIVE_YIELD_PRECISION,
} from "@/app/lib/formatters";
import type { PoolInfo } from "@/app/types";

interface YieldBreakdownTooltipProps {
  pool: PoolInfo;
  className?: string;
}

export function YieldBreakdownTooltip({
  pool,
  className = "",
}: YieldBreakdownTooltipProps) {
  const t = useTranslations("Pools");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const grossSpanRef = useRef<HTMLSpanElement | null>(null);
  const feeSpanRef = useRef<HTMLSpanElement | null>(null);
  const netSpanRef = useRef<HTMLSpanElement | null>(null);

  const breakdown = resolvePoolYieldBreakdown(pool, pool.tokenDecimals);
  const tokenSymbol = pool.tokenSymbol ?? "USDC";

  // 60 FPS Live Yield Ticker Loop (strictly active only when open and not frozen)
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

      if (grossSpanRef.current) {
        grossSpanRef.current.textContent = formatLiveYieldMetric(
          live.grossYieldUi,
          tokenSymbol,
          "+",
          DEFAULT_LIVE_YIELD_PRECISION
        );
      }
      if (feeSpanRef.current) {
        feeSpanRef.current.textContent = formatLiveYieldMetric(
          live.protocolFeeUi,
          tokenSymbol,
          "-",
          DEFAULT_LIVE_YIELD_PRECISION
        );
      }
      if (netSpanRef.current) {
        netSpanRef.current.textContent = formatLiveYieldMetric(
          live.netYieldUi,
          tokenSymbol,
          "",
          DEFAULT_LIVE_YIELD_PRECISION
        );
      }

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

  // Close when clicking outside
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

  const initialGrossFormatted = formatLiveYieldMetric(
    breakdown.grossYieldUi,
    tokenSymbol,
    "+",
    DEFAULT_LIVE_YIELD_PRECISION
  );
  const initialFeeFormatted = formatLiveYieldMetric(
    breakdown.protocolFeeUi,
    tokenSymbol,
    "-",
    DEFAULT_LIVE_YIELD_PRECISION
  );
  const initialNetFormatted = formatLiveYieldMetric(
    breakdown.netYieldUi,
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
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={t("yieldBreakdownTitle")}
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
          aria-label={t("yieldBreakdownTitle")}
          className="absolute right-0 sm:left-0 top-full mt-2 w-72 sm:w-80 max-w-[calc(100vw-2.5rem)] rounded-2xl glass-strong border border-primary/20 p-4 shadow-2xl z-50 text-xs space-y-3 pointer-events-auto animate-in fade-in zoom-in-95 duration-150 backdrop-blur-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between pb-2 border-b border-outline-variant/15">
            <div className="flex items-center gap-1.5 font-display font-bold text-on-surface">
              <svg
                className="w-3.5 h-3.5 text-secondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6"
                />
              </svg>
              <span>{t("yieldBreakdownTitle")}</span>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2 py-0.5 text-[10px] font-semibold text-primary">
              {breakdown.underlyingApyFormatted}
            </span>
          </div>

          {/* Strategy Details */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-on-surface-variant">
              <span>{t("underlyingStrategy")}</span>
              <span className="font-medium text-on-surface">
                {t("humaStrategyName")}
              </span>
            </div>

            <div className="flex justify-between text-on-surface-variant">
              <span>{t("grossYield")}</span>
              <span className="font-mono font-medium text-on-surface tabular-nums">
                <span ref={grossSpanRef} aria-hidden="true">
                  {initialGrossFormatted}
                </span>
                <span className="sr-only">
                  {t("grossYield")}: {initialGrossFormatted}
                </span>
              </span>
            </div>

            <div className="flex justify-between text-on-surface-variant">
              <span>
                {t("protocolFee", { percent: breakdown.feePercentFormatted })}
              </span>
              <span className="font-mono text-error/90 font-medium tabular-nums">
                <span ref={feeSpanRef} aria-hidden="true">
                  {initialFeeFormatted}
                </span>
                <span className="sr-only">
                  {t("protocolFee", {
                    percent: breakdown.feePercentFormatted,
                  })}
                  : {initialFeeFormatted}
                </span>
              </span>
            </div>

            <div className="pt-2 border-t border-outline-variant/15 flex justify-between font-bold text-on-surface">
              <span className="text-secondary">{t("netPrizePot")}</span>
              <span className="font-mono text-gradient tabular-nums">
                <span ref={netSpanRef} aria-hidden="true">
                  {initialNetFormatted}
                </span>
                <span className="sr-only">
                  {t("netPrizePot")}: {initialNetFormatted}
                </span>
              </span>
            </div>
          </div>

          {/* Lossless Note */}
          <div className="rounded-lg bg-surface-container-high/40 p-2 text-[10px] text-on-surface-variant leading-relaxed border border-outline-variant/10">
            <p className="flex items-start gap-1">
              <span className="text-secondary shrink-0 font-bold">✓</span>
              <span>{t("losslessExplanation")}</span>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
