"use client";

import { useEffect, useRef, useSyncExternalStore, useMemo } from "react";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
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
}

const emptySubscribe = () => () => {};

export function LiveYieldTicker({
  pool,
  precision = DEFAULT_LIVE_YIELD_PRECISION,
  apy = DEFAULT_APY,
  showBadge = true,
  className = "",
  valueClassName = "",
  debugLabel,
}: LiveYieldTickerProps) {
  const t = useTranslations("Dashboard");

  const resolvedDebugLabel = debugLabel ?? pool?.tokenSymbol ?? "Global";

  const { calculateCurrentValue, baseUi } = useLivePrizePot({
    pool,
    apy,
    debugLabel: resolvedDebugLabel,
  });

  const spanRef = useRef<HTMLSpanElement>(null);

  // Cached Intl.NumberFormat from module cache for 60 FPS animation loop performance
  const numberFormatter = useMemo(
    () => getLiveYieldFormatter(precision),
    [precision]
  );

  // Hydration safety check via useSyncExternalStore (React 19 standard)
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  // 60 FPS animation loop with direct DOM mutation (no React re-renders)
  useEffect(() => {
    if (!isMounted) return;

    let animFrameId: number;

    const tick = () => {
      const nowInSeconds = Date.now() / 1000;
      const currentVal = calculateCurrentValue(nowInSeconds);

      if (spanRef.current) {
        const formatted = numberFormatter.format(currentVal);
        spanRef.current.textContent = `$${formatted}`;
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isMounted, calculateCurrentValue, numberFormatter]);

  // Initial SSR / pre-hydration display value
  const initialFormatted = `$${numberFormatter.format(baseUi)}`;

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <span
        ref={spanRef}
        className={`font-mono tabular-nums whitespace-nowrap ${valueClassName}`}
      >
        {initialFormatted}
      </span>

      {showBadge && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/30 px-2.5 py-0.5 text-xs font-semibold text-secondary animate-yield-pulse shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          {t("liveYielding")}
        </span>
      )}
    </div>
  );
}
