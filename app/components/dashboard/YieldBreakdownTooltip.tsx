"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { resolvePoolYieldBreakdown, formatTokenAmount } from "@/app/lib/formatters";
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

  const breakdown = resolvePoolYieldBreakdown(pool, pool.tokenDecimals);

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

  const formatMicroAmount = (amountBase: number) => {
    return formatTokenAmount(amountBase, pool.tokenDecimals, 2, 6);
  };

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
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-surface-container-high/70 text-on-surface-variant hover:bg-primary/20 hover:text-primary transition-colors cursor-pointer text-[10px] font-semibold focus:outline-none focus:ring-2 focus:ring-primary/40 -translate-y-px"
      >
        <span aria-hidden="true">ⓘ</span>
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
              <span className="font-mono font-medium text-on-surface">
                +${formatMicroAmount(breakdown.grossYieldBase)} {pool.tokenSymbol}
              </span>
            </div>

            <div className="flex justify-between text-on-surface-variant">
              <span>
                {t("protocolFee", { percent: breakdown.feePercentFormatted })}
              </span>
              <span className="font-mono text-error/90 font-medium">
                -${formatMicroAmount(breakdown.protocolFeeBase)} {pool.tokenSymbol}
              </span>
            </div>

            <div className="pt-2 border-t border-outline-variant/15 flex justify-between font-bold text-on-surface">
              <span className="text-secondary">{t("netPrizePot")}</span>
              <span className="font-mono text-gradient">
                ${formatMicroAmount(breakdown.netYieldBase)} {pool.tokenSymbol}
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
