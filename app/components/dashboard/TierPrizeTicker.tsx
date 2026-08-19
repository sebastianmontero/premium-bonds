"use client";

import { useRef } from "react";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
import { useLiveTickerText } from "@/app/hooks/useLiveTickerText";
import {
  DEFAULT_LIVE_YIELD_PRECISION,
  getPoolPayoutThresholdUi,
  calculateTierPayout,
  tierColor,
  formatTierPayoutAmount,
} from "@/app/lib/formatters";
import type { PoolInfo, PrizeTier } from "@/app/types";
import { useTranslations } from "next-intl";

export interface TierPrizeTickerProps {
  pool?: PoolInfo;
  tier: PrizeTier;
  tierIndex: number;
  tierLabel: string;
  thresholdUi?: number;
  precision?: number;
  className?: string;
}

export function TierPrizeTicker({
  pool,
  tier,
  tierIndex,
  tierLabel: customTierLabel,
  thresholdUi,
  precision = DEFAULT_LIVE_YIELD_PRECISION,
  className = "",
}: TierPrizeTickerProps) {
  const t = useTranslations("Pools");
  const tokenSymbol = pool?.tokenSymbol ?? "USDC";
  const resolvedThreshold =
    thresholdUi ?? getPoolPayoutThresholdUi(tokenSymbol);

  const spanRef = useRef<HTMLSpanElement>(null);

  const { calculateCurrentValue, baseUi } = useLivePrizePot({
    pool,
    debugLabel: `${tokenSymbol}-Tier-${tierIndex}`,
  });

  const basePayout = calculateTierPayout(baseUi, tier, resolvedThreshold);
  const isAboveThreshold = basePayout.isAboveThreshold;

  const basisPoints = tier.basisPoints;
  const numWinners = tier.numWinners;

  const calculateTierValue = (nowInSeconds: number): number => {
    const potUi = calculateCurrentValue(nowInSeconds);
    const breakdown = calculateTierPayout(
      potUi,
      { basisPoints, numWinners },
      resolvedThreshold
    );
    return breakdown.payoutPerWinnerUi;
  };

  const formatValue = (val: number): string =>
    `~${formatTierPayoutAmount(val, tokenSymbol, precision)}`;

  const isEnabled = !pool?.isFrozenForDraw && isAboveThreshold;

  useLiveTickerText({
    calculateValue: calculateTierValue,
    formatValue,
    spanRef,
    enabled: isEnabled,
  });

  const pctDisplay = `${(tier.basisPoints / 100).toLocaleString("en-US", {
    maximumFractionDigits: 1,
  })}%`;

  const initialAmountFormatted = `~${formatTierPayoutAmount(
    basePayout.payoutPerWinnerUi,
    tokenSymbol,
    precision
  )}`;

  const winnersCountText = t("winnersCount", { count: tier.numWinners });

  return (
    <div
      className={`rounded-lg bg-surface-container/60 px-3 py-2 text-center border border-surface-container-high/40 hover:bg-surface-container-high/50 transition-colors min-h-[72px] flex flex-col justify-between ${className}`}
    >
      <p
        className={`text-[10px] font-semibold truncate ${tierColor(tierIndex)}`}
      >
        {customTierLabel}
      </p>

      {isAboveThreshold ? (
        <>
          <p className="font-mono text-xs sm:text-sm font-bold text-on-surface tabular-nums tracking-tight whitespace-nowrap">
            <span ref={spanRef} aria-hidden="true">
              {initialAmountFormatted}
            </span>
            <span className="sr-only">
              {customTierLabel}: {initialAmountFormatted}, {pctDisplay}{" "}
              {winnersCountText}
            </span>
          </p>
          <p className="text-[10px] text-on-surface-variant truncate whitespace-nowrap">
            {pctDisplay} · {winnersCountText}
          </p>
        </>
      ) : (
        <>
          <p className="font-mono text-sm font-semibold text-on-surface tabular-nums">
            {pctDisplay}
          </p>
          <p className="text-[10px] text-on-surface-variant truncate whitespace-nowrap">
            {winnersCountText}
          </p>
        </>
      )}
    </div>
  );
}
