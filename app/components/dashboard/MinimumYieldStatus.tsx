"use client";

import { useTranslations } from "next-intl";
import {
  calculateYieldThresholdProgress,
  formatTokenAmount,
} from "@/app/lib/formatters";
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
  const progress = calculateYieldThresholdProgress(
    pool.grossYield,
    pool.minYieldThreshold,
    pool.tokenDecimals
  );

  const formatMicroAmount = (amountBase: number) => {
    return formatTokenAmount(amountBase, pool.tokenDecimals, 2, 6);
  };

  if (!progress.isConfigured) {
    return (
      <div
        className={`flex items-center gap-1.5 text-[11px] text-on-surface-variant/80 ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-secondary/80 shrink-0" />
        <span>{t("yieldTargetNotSet")}</span>
      </div>
    );
  }

  if (progress.isMet) {
    return (
      <div
        className={`flex items-center gap-1.5 text-[11px] text-secondary font-medium ${className}`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-secondary shrink-0 animate-pulse" />
        <span>{t("yieldTargetMet")}</span>
      </div>
    );
  }

  return (
    <div className={`space-y-1 text-[11px] ${className}`}>
      <div className="flex items-center justify-between text-on-surface-variant">
        <span className="flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />
          <span>
            {t("yieldAccumulating", {
              current: `$${formatMicroAmount(progress.currentBase)}`,
              target: `$${formatMicroAmount(progress.targetBase)}`,
            })}
          </span>
        </span>
        <span className="font-mono text-[10px] text-on-surface-variant font-medium">
          {progress.progressPercent.toFixed(1)}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-surface-container-high/60">
        <div
          className="h-full rounded-full bg-amber-400/80 transition-all duration-300"
          style={{ width: `${progress.progressPercent}%` }}
        />
      </div>
    </div>
  );
}
