"use client";

import { usePrizePool } from "@/app/hooks/queries/usePrizePool";
import { LiveYieldTicker } from "./dashboard/LiveYieldTicker";
import { CountdownTimer } from "./dashboard/CountdownTimer";
import { formatCurrencyAmount, formatLocalDate } from "@/app/lib/formatters";
import type { PoolInfo } from "@/app/types";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

interface StatsSectionProps {
  pool?: PoolInfo;
}

export function StatsSection({ pool: initialPool }: StatsSectionProps) {
  const t = useTranslations("Stats");
  const { data: fetchedPool, isLoading } = usePrizePool(1);

  const activePool = initialPool ?? fetchedPool;

  const formattedTvl = activePool
    ? formatCurrencyAmount(
        activePool.totalDepositedPrincipal,
        activePool.tokenSymbol,
        activePool.tokenDecimals,
        0
      )
    : "$0";

  const formattedDistributed = activePool
    ? formatCurrencyAmount(
        activePool.totalPrizesDistributed ?? 0,
        activePool.tokenSymbol,
        activePool.tokenDecimals,
        0
      )
    : "$0";

  const formattedTargetDate =
    activePool && activePool.currentCycleEndAt > 0
      ? formatLocalDate(activePool.currentCycleEndAt * 1000, {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : null;

  return (
    <section id="prizes" className="relative px-6 py-20 lg:py-24">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* ── Featured Live Prize Draw Spotlight Card (Top) ────────────────────────── */}
        <div className="glass glass-hover relative overflow-hidden rounded-3xl p-6 sm:p-8 lg:p-10 transition-all duration-300">
          {/* Ambient background glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-secondary/15 blur-[80px]"
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -left-16 -bottom-16 h-64 w-64 rounded-full bg-primary/10 blur-[80px]"
          />

          <div className="relative z-10 flex flex-col gap-8 lg:flex-row lg:items-center lg:justify-between">
            {/* Left side: Badge, Title, Large Live Yield Amount */}
            <div className="space-y-4 max-w-2xl">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-secondary/15 text-secondary border border-secondary/20 shadow-sm">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="8" r="7" />
                    <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
                  </svg>
                </div>
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
                    {t("currentPrizePool")}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/40 px-2.5 py-0.5 text-xs font-semibold text-secondary animate-yield-pulse">
                      <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
                      {t("liveYielding")}
                    </span>
                    <span className="text-xs text-on-surface-variant/80">
                      {t("humaYieldBadge")}
                    </span>
                  </div>
                </div>
              </div>

              {/* Big Live Yield Amount with split decimals */}
              <div className="pt-1">
                <LiveYieldTicker
                  pool={activePool ?? undefined}
                  showBadge={false}
                  splitDecimals
                  majorClassName="font-display text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-gradient"
                  microClassName="font-mono text-xl sm:text-2xl lg:text-3xl font-semibold text-on-surface-variant/70 tabular-nums ml-1"
                  tokenSuffix={activePool?.tokenSymbol ?? "USDC"}
                  debugLabel="Homepage Hero Spotlight"
                />
              </div>

              <p className="text-sm text-on-surface-variant leading-relaxed">
                {t("subtitle")}
              </p>
            </div>

            {/* Right side: Countdown box & Quick CTA button */}
            <div className="flex flex-col gap-4 sm:flex-row lg:flex-col lg:items-end shrink-0">
              {/* Countdown container */}
              <div className="rounded-2xl bg-surface-container-high/60 border border-outline-variant/20 p-4 sm:p-5 backdrop-blur-md space-y-2 min-w-[260px]">
                <div className="flex items-center justify-between gap-4 text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
                  <span>{t("nextDrawIn")}</span>
                  <span className="h-2 w-2 rounded-full bg-secondary animate-pulse" />
                </div>
                {activePool && activePool.currentCycleEndAt > 0 ? (
                  <div className="space-y-1">
                    <CountdownTimer
                      targetTimestamp={activePool.currentCycleEndAt}
                      disableRpcSync
                      variant="inline"
                      className="font-mono text-lg font-bold text-on-surface"
                    />
                    {formattedTargetDate && (
                      <p className="text-[11px] text-on-surface-variant/80 font-medium">
                        {formattedTargetDate}
                      </p>
                    )}
                  </div>
                ) : (
                  <span className="font-mono text-sm text-on-surface-variant opacity-50">
                    --:--:--
                  </span>
                )}
              </div>

              {/* CTA button */}
              <Link
                href="/dashboard"
                className="btn-gradient inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3.5 text-sm font-semibold shadow-md transition-all hover:scale-105 cursor-pointer w-full sm:w-auto text-center"
              >
                <span>{t("depositCta")}</span>
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </Link>
            </div>
          </div>
        </div>

        {/* ── 3-Card Symmetric Metric Strip (Bottom) ────────────────────────── */}
        <div className="grid gap-6 sm:grid-cols-3">
          {/* Total Value Locked */}
          <div className="glass glass-hover group relative rounded-2xl p-6 sm:p-8 space-y-4 transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between min-h-[160px]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20 transition-transform group-hover:scale-110">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
                  {t("tvlLabel")}
                </p>
                <p
                  className={`font-display text-3xl sm:text-4xl font-bold tracking-tight text-on-surface mt-1 ${
                    !activePool && isLoading ? "animate-pulse opacity-50" : ""
                  }`}
                >
                  {formattedTvl}
                </p>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              {t("tvlSub")}
            </p>
          </div>

          {/* Total Prizes Distributed */}
          <div className="glass glass-hover group relative rounded-2xl p-6 sm:p-8 space-y-4 transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between min-h-[160px]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20 transition-transform group-hover:scale-110">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                    <path d="M4 22h16" />
                    <path d="M10 14.66V17c0 .55-.45 1-1 1H7" />
                    <path d="M14 14.66V17c0 .55.45 1 1 1h2" />
                    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
                  {t("totalPrizesLabel")}
                </p>
                <p
                  className={`font-display text-3xl sm:text-4xl font-bold tracking-tight text-on-surface mt-1 ${
                    !activePool && isLoading ? "animate-pulse opacity-50" : ""
                  }`}
                >
                  {formattedDistributed}
                </p>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              {t("totalPrizesSub")}
            </p>
          </div>

          {/* Active Savers */}
          <div className="glass glass-hover group relative rounded-2xl p-6 sm:p-8 space-y-4 transition-all duration-300 hover:-translate-y-1 flex flex-col justify-between min-h-[160px]">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-tertiary/10 text-tertiary border border-tertiary/20 transition-transform group-hover:scale-110">
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 00-3-3.87" />
                    <path d="M16 3.13a4 4 0 010 7.75" />
                  </svg>
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
                  {t("activeSaversLabel")}
                </p>
                <p
                  className={`font-display text-3xl sm:text-4xl font-bold tracking-tight text-on-surface mt-1 ${
                    !activePool && isLoading ? "animate-pulse opacity-50" : ""
                  }`}
                >
                  {(activePool?.totalUsers ?? 0).toLocaleString("en-US")}
                </p>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              {t("activeSaversSub")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
