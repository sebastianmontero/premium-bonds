"use client";

import { useEffect, useRef, useSyncExternalStore, type RefObject } from "react";

const emptySubscribe = () => () => {};

export interface UseLiveTickerTextOptions {
  /** Function calculating the current numeric value at timestamp t */
  calculateValue: (nowInSeconds: number) => number;
  /** Pure formatter turning the numeric value into display text */
  formatValue: (value: number) => string;
  /** Ref to the HTMLSpanElement directly updated via textContent */
  spanRef: RefObject<HTMLSpanElement | null>;
  /** Pause condition (e.g. frozen pool or sub-threshold) */
  enabled?: boolean;
}

/**
 * Headless 60 FPS animation loop hook that mutates DOM text directly without React re-renders.
 * Handles React 19 hydration safety via useSyncExternalStore and short-circuits rAF when disabled.
 */
export function useLiveTickerText({
  calculateValue,
  formatValue,
  spanRef,
  enabled = true,
}: UseLiveTickerTextOptions): boolean {
  const isMounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const calculateRef = useRef(calculateValue);
  const formatRef = useRef(formatValue);

  useEffect(() => {
    calculateRef.current = calculateValue;
    formatRef.current = formatValue;
  });

  useEffect(() => {
    if (!isMounted || !enabled) return;

    let animFrameId: number;

    const tick = () => {
      const nowInSeconds = Date.now() / 1000;
      const currentVal = calculateRef.current(nowInSeconds);

      if (spanRef.current) {
        spanRef.current.textContent = formatRef.current(currentVal);
      }

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [isMounted, enabled, spanRef]);

  return isMounted;
}
