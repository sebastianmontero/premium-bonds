"use client";

import { formatTokenAmount } from "@/app/lib/formatters";
import { useTranslations } from "next-intl";

interface PortfolioHeroRowProps {
  netWorth: number;
  investedAmount: number;
  redeemingAmount: number;
  unclaimedAmount?: number;
  activeTickets: number;
  pendingTickets: number;
  lifetimeWinnings: number;
  autoReinvestedTotal: number;
  nonReinvestedWinnings: number;
  tokenSymbol: string;
  tokenDecimals: number;
}

export function PortfolioHeroRow({
  netWorth,
  investedAmount,
  redeemingAmount,
  unclaimedAmount = 0,
  activeTickets,
  pendingTickets,
  lifetimeWinnings,
  autoReinvestedTotal,
  nonReinvestedWinnings,
  tokenSymbol,
  tokenDecimals,
}: PortfolioHeroRowProps) {
  const t = useTranslations("Portfolio");

  const totalTickets = activeTickets + pendingTickets;
  const reinvestmentPercentage =
    lifetimeWinnings > 0
      ? ((autoReinvestedTotal / lifetimeWinnings) * 100).toLocaleString(
          "en-US",
          { maximumFractionDigits: 1 }
        )
      : "0.0";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* ── 1. Total Portfolio Value ────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 shadow-ambient relative overflow-hidden border-t-primary/50 flex flex-col gap-3">
        <div
          aria-hidden="true"
          className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-primary/15 blur-[32px] pointer-events-none"
        />
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("totalPortfolioValue")}
            </p>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
            ${formatTokenAmount(netWorth, tokenDecimals)}
            <span className="ms-1.5 text-base font-medium text-on-surface-variant">
              {tokenSymbol}
            </span>
          </p>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
            <span className="font-mono font-medium text-on-surface">
              ${formatTokenAmount(investedAmount, tokenDecimals)}
            </span>
            <span>{t("bonds")}</span>
          </span>

          {redeemingAmount > 0 && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
              <span className="font-mono font-medium text-on-surface">
                ${formatTokenAmount(redeemingAmount, tokenDecimals)}
              </span>
              <span>{t("redeeming")}</span>
            </span>
          )}

          {unclaimedAmount > 0 && (
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-tight text-amber-300 backdrop-blur-sm">
              <span className="font-mono font-semibold text-amber-200">
                ${formatTokenAmount(unclaimedAmount, tokenDecimals)}
              </span>
              <span>{t("unclaimed")}</span>
            </span>
          )}
        </div>
      </div>

      {/* ── 2. Total Bonds (Tickets) ─────────────────────────────────────── */}
      <div className="glass glass-hover rounded-2xl p-6 flex flex-col gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-secondary"
            >
              <rect x="2" y="6" width="20" height="12" rx="2" />
              <path d="M2 12h20" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("bondsTitle")}
            </p>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
            {totalTickets.toLocaleString("en-US")}
          </p>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
            <span className="font-mono font-medium text-on-surface">
              {activeTickets.toLocaleString("en-US")}
            </span>
            <span>{t("active")}</span>
          </span>

          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
            <span className="font-mono font-medium text-on-surface">
              {pendingTickets.toLocaleString("en-US")}
            </span>
            <span>{t("pending")}</span>
          </span>
        </div>
      </div>

      {/* ── 3. Lifetime Winnings ────────────────────────────────────────── */}
      <div className="glass glass-hover rounded-2xl p-6 flex flex-col gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-tertiary"
            >
              <circle cx="12" cy="8" r="7" />
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("lifetimeWinnings")}
            </p>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-gradient">
            ${formatTokenAmount(lifetimeWinnings, tokenDecimals)}
            <span className="ms-1.5 text-base font-medium text-on-surface-variant bg-none [-webkit-text-fill-color:var(--on-surface-variant)]">
              {tokenSymbol}
            </span>
          </p>
        </div>

        {/* Chips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-tertiary/20 bg-tertiary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
            <span className="font-mono font-medium text-on-surface">
              ${formatTokenAmount(autoReinvestedTotal, tokenDecimals)}
            </span>
            <span>{t("reinvested")}</span>
          </span>

          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
            <span className="font-mono font-medium text-on-surface">
              ${formatTokenAmount(nonReinvestedWinnings, tokenDecimals)}
            </span>
            <span>{t("nonReinvested")}</span>
          </span>
        </div>
      </div>

      {/* ── 4. Auto-Reinvested Rate ─────────────────────────────────────── */}
      <div className="glass glass-hover rounded-2xl p-6 flex flex-col gap-3">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-secondary animate-yield-pulse"
            >
              <polyline points="23 4 23 10 17 10" />
              <polyline points="1 20 1 14 7 14" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("autoReinvested")}
            </p>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
            ${formatTokenAmount(autoReinvestedTotal, tokenDecimals)}
            <span className="ms-1.5 text-base font-medium text-on-surface-variant">
              {tokenSymbol}
            </span>
          </p>
        </div>

        {/* Chip */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm">
            <span className="font-mono font-medium text-on-surface">
              {reinvestmentPercentage}%
            </span>
            <span>{t("reinvestmentRate")}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
