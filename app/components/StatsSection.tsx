"use client";

import { useBondsContract } from "@/app/hooks/useBondsContract";
import { LiveYieldTicker } from "./dashboard/LiveYieldTicker";
import { CountdownTimer } from "./dashboard/CountdownTimer";
import { formatTokenAmount } from "@/app/lib/formatters";
import type { PoolInfo } from "@/app/types";
import { useTranslations } from "next-intl";

interface StatsSectionProps {
  pool?: PoolInfo;
}

export function StatsSection({ pool: initialPool }: StatsSectionProps) {
  const t = useTranslations("Stats");
  const { pool: fetchedPool, isLoading } = useBondsContract(1);

  const activePool = initialPool ?? fetchedPool;

  const formattedTvl = activePool
    ? `$${formatTokenAmount(activePool.totalDepositedPrincipal, activePool.tokenDecimals, 0)}`
    : "$0";

  return (
    <section id="prizes" className="relative px-6 py-24">
      <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
        {/* Total Value Locked */}
        <div
          className="glass-strong rounded-2xl p-8 space-y-3 animate-float"
          style={{ animationDelay: "0s" }}
        >
          <div className="flex items-center gap-2">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0110 0v4" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("tvlLabel")}
            </p>
          </div>
          <p
            className={`font-display text-4xl font-bold tracking-tight text-on-surface sm:text-5xl ${
              !activePool && isLoading ? "animate-pulse opacity-50" : ""
            }`}
          >
            {formattedTvl}
          </p>
          <p className="text-sm text-on-surface-variant">{t("tvlSub")}</p>
        </div>

        {/* Current Prize Pool & Countdown */}
        <div
          className="glass-strong rounded-2xl p-8 space-y-3 animate-float"
          style={{ animationDelay: "1s" }}
        >
          <div className="flex items-center gap-2">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-secondary"
            >
              <circle cx="12" cy="8" r="7" />
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("currentPrizePool")}
            </p>
          </div>
          <div>
            <LiveYieldTicker
              pool={activePool ?? undefined}
              precision={4}
              showBadge={false}
              valueClassName="font-display text-4xl font-bold tracking-tight text-gradient sm:text-5xl"
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/30 px-3 py-1 text-xs font-semibold text-secondary animate-yield-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
              {t("liveYielding")}
            </span>
            <div className="flex items-center gap-2 text-sm text-on-surface-variant">
              <span>{t("nextDrawIn")}</span>
              {activePool && activePool.currentCycleEndAt > 0 ? (
                <CountdownTimer
                  targetTimestamp={activePool.currentCycleEndAt}
                />
              ) : (
                <span className="font-mono text-sm text-on-surface-variant opacity-50">
                  --:--:--
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
