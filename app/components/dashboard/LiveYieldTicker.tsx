"use client";

import { useRef, useMemo, useCallback } from "react";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
import { useLiveTickerText } from "@/app/hooks/useLiveTickerText";
import type { PoolInfo } from "@/app/types";
import { useTranslations } from "next-intl";
import {
  DEFAULT_LIVE_YIELD_PRECISION,
  DEFAULT_APY,
  getLiveYieldFormatter,
} from "@/app/lib/formatters";

export interface LiveYieldTickerProps {
  pool?: PoolInfo;
  /** Number of fraction digits to display (default 6 for micro-USDC sub-cent visual ticks) */
  precision?: number;
  /** APY percentage (default 0.08 = 8%) */
  apy?: number;
  /** Whether to display the pulsing "Live Yielding" badge */
  showBadge?: boolean;
  /** Custom className for the container */
  className?: string;
  /** Custom className for the number text */
  valueClassName?: string;
  /** Optional label for console debug logs */
  debugLabel?: string;
  /** Whether to split major ($1,250.00) and micro (3412) decimal parts */
  splitDecimals?: boolean;
  /** Custom className for the major dollar text when splitDecimals is true */
  majorClassName?: string;
  /** Custom className for the micro decimal fraction text when splitDecimals is true */
  microClassName?: string;
  /** Currency symbol or token name suffix */
  tokenSuffix?: string;
}

export function LiveYieldTicker({
  pool,
  precision = DEFAULT_LIVE_YIELD_PRECISION,
  apy = DEFAULT_APY,
  showBadge = true,
  className = "",
  valueClassName = "",
  debugLabel,
  splitDecimals = false,
  majorClassName = "",
  microClassName = "",
  tokenSuffix,
}: LiveYieldTickerProps) {
  const t = useTranslations("Dashboard");

  const resolvedDebugLabel = debugLabel ?? pool?.tokenSymbol ?? "Global";

  const { calculateCurrentValue, baseUi } = useLivePrizePot({
    pool,
    apy,
    debugLabel: resolvedDebugLabel,
  });

  const spanRef = useRef<HTMLSpanElement>(null);
  const microSpanRef = useRef<HTMLSpanElement>(null);

  // Cached Intl.NumberFormat from module cache for 60 FPS animation loop performance
  const numberFormatter = useMemo(
    () => getLiveYieldFormatter(precision),
    [precision]
  );

  const formatValue = useCallback(
    (currentVal: number) => `$${numberFormatter.format(currentVal)}`,
    [numberFormatter]
  );

  const formatParts = useCallback(
    (currentVal: number): [string, string] => {
      const formatted = numberFormatter.format(currentVal);
      const dotIndex = formatted.indexOf(".");
      if (dotIndex === -1) {
        return [`$${formatted}`, ""];
      }
      // Major: dollar sign + integer + standard 2-decimal cents (e.g. "$0.00")
      const major = `$${formatted.slice(0, dotIndex + 3)}`;
      // Micro: remaining sub-cent fraction (e.g. "0031")
      const micro = formatted.slice(dotIndex + 3);
      return [major, micro];
    },
    [numberFormatter]
  );

  useLiveTickerText({
    calculateValue: calculateCurrentValue,
    formatValue: splitDecimals ? undefined : formatValue,
    formatParts: splitDecimals ? formatParts : undefined,
    spanRef,
    microSpanRef: splitDecimals ? microSpanRef : undefined,
    enabled: !pool?.isFrozenForDraw,
  });

  // Initial SSR / pre-hydration display values
  const [initialMajor, initialMicro] = useMemo(
    () => formatParts(baseUi),
    [formatParts, baseUi]
  );
  const initialFormatted = `$${numberFormatter.format(baseUi)}`;

  return (
    <div className={`inline-flex items-baseline gap-3 ${className}`}>
      {/* Screen-reader accessible static announcement */}
      <span className="sr-only" aria-live="polite">
        {initialFormatted}
      </span>

      {splitDecimals ? (
        <span
          aria-hidden="true"
          className="inline-flex items-baseline whitespace-nowrap"
        >
          <span
            ref={spanRef}
            className={`font-display font-bold tabular-nums tracking-tight ${majorClassName}`}
          >
            {initialMajor}
          </span>
          {initialMicro && (
            <span
              ref={microSpanRef}
              className={`font-mono tabular-nums ${microClassName}`}
            >
              {initialMicro}
            </span>
          )}
          {tokenSuffix && (
            <span className="ms-2 text-xs sm:text-sm font-semibold uppercase tracking-wider text-on-surface-variant">
              {tokenSuffix}
            </span>
          )}
        </span>
      ) : (
        <span
          ref={spanRef}
          aria-hidden="true"
          className={`font-mono tabular-nums whitespace-nowrap ${valueClassName}`}
        >
          {initialFormatted}
        </span>
      )}

      {showBadge && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/30 px-2.5 py-0.5 text-xs font-semibold text-secondary animate-yield-pulse shrink-0 self-center">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          {t("liveYielding")}
        </span>
      )}
    </div>
  );
}
