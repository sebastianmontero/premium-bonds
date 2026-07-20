"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
import type { PoolInfo } from "@/app/types";

export interface LiveYieldTickerProps {
  pool: PoolInfo;
  /** Number of fraction digits to display (default 4 for sub-cent visual ticks) */
  precision?: number;
  /** APY percentage (default 0.08 = 8%) */
  apy?: number;
  /** Whether to display the pulsing "Live Yielding" badge */
  showBadge?: boolean;
  /** Custom className for the container */
  className?: string;
  /** Custom className for the number text */
  valueClassName?: string;
}

const emptySubscribe = () => () => {};

export function LiveYieldTicker({
  pool,
  precision = 4,
  apy = 0.08,
  showBadge = true,
  className = "",
  valueClassName = "",
}: LiveYieldTickerProps) {
  const { calculateCurrentValue, baseUi } = useLivePrizePot({
    basePrizePot: pool.estimatedPrizePot,
    totalDepositedPrincipal: pool.totalDepositedPrincipal,
    tokenDecimals: pool.tokenDecimals,
    apy,
    isFrozenForDraw: pool.isFrozenForDraw,
  });

  const spanRef = useRef<HTMLSpanElement>(null);

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
        const formatted = currentVal.toLocaleString("en-US", {
          minimumFractionDigits: precision,
          maximumFractionDigits: precision,
        });
        spanRef.current.textContent = `$${formatted}`;
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isMounted, calculateCurrentValue, precision]);

  // Initial SSR / pre-hydration display value
  const initialFormatted = `$${baseUi.toLocaleString("en-US", {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })}`;

  return (
    <div className={`inline-flex items-center gap-3 ${className}`}>
      <span
        ref={spanRef}
        className={`font-mono tabular-nums ${valueClassName}`}
      >
        {initialFormatted}
      </span>

      {showBadge && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/30 px-2.5 py-0.5 text-xs font-semibold text-secondary animate-yield-pulse shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
          Live Yielding
        </span>
      )}
    </div>
  );
}
