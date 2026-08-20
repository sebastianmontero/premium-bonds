"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import type { DrawHistoryStats } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawStatsSummaryProps {
  stats: DrawHistoryStats;
  tokenDecimals?: number;
  tokenSymbol?: string;
  isLoading?: boolean;
  isLifetimeYieldLoading?: boolean;
}

export function DrawStatsSummary({
  stats,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  isLoading = false,
  isLifetimeYieldLoading,
}: DrawStatsSummaryProps) {
  const t = useTranslations("DrawHistory");

  const lifetimeLoading = isLifetimeYieldLoading ?? isLoading;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* ── 1. Lifetime Prize Yield Distributed ─────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 shadow-ambient relative overflow-hidden border-t-primary/50 flex flex-col justify-between gap-3">
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
              <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
              <polyline points="17 6 23 6 23 12" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("lifetimeYield")}
            </p>
          </div>
          {lifetimeLoading ? (
            <div className="h-9 w-36 rounded-lg skeleton-box mt-1" />
          ) : (
            <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
              ${formatTokenAmount(stats.totalYieldDistributed, tokenDecimals)}
              <span className="ms-1.5 text-base font-medium text-on-surface-variant">
                {tokenSymbol}
              </span>
            </p>
          )}
        </div>

        <p className="text-xs text-on-surface-variant/70">
          {t("lifetimeYieldSub")}
        </p>
      </div>

      {/* ── 2. Total Completed Draws ────────────────────────────────────── */}
      <div className="glass glass-hover rounded-2xl p-6 flex flex-col justify-between gap-3">
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
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("totalDraws")}
            </p>
          </div>
          {isLoading ? (
            <div className="h-9 w-20 rounded-lg skeleton-box mt-1" />
          ) : (
            <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
              {stats.totalDrawsCompleted.toLocaleString("en-US")}
            </p>
          )}
        </div>

        <p className="text-xs text-on-surface-variant/70">
          {t("totalDrawsSub")}
        </p>
      </div>

      {/* ── 3. Total Winning Bonds Awarded ──────────────────────────────── */}
      <div className="glass glass-hover rounded-2xl p-6 flex flex-col justify-between gap-3">
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
              {t("winningBonds")}
            </p>
          </div>
          {isLoading ? (
            <div className="h-9 w-24 rounded-lg skeleton-box mt-1" />
          ) : (
            <p className="font-display text-3xl font-bold tracking-tight text-gradient">
              {stats.totalWinningBonds.toLocaleString("en-US")}
            </p>
          )}
        </div>

        <p className="text-xs text-on-surface-variant/70">
          {t("winningBondsSub")}
        </p>
      </div>

      {/* ── 4. Average Prize Pot ────────────────────────────────────────── */}
      <div className="glass glass-hover rounded-2xl p-6 flex flex-col justify-between gap-3">
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
              <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
              <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("avgPot")}
            </p>
          </div>
          {isLoading ? (
            <div className="h-9 w-32 rounded-lg skeleton-box mt-1" />
          ) : (
            <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
              ${formatTokenAmount(stats.averagePrizePot, tokenDecimals)}
              <span className="ms-1.5 text-base font-medium text-on-surface-variant">
                {tokenSymbol}
              </span>
            </p>
          )}
        </div>

        <p className="text-xs text-on-surface-variant/70">{t("avgPotSub")}</p>
      </div>
    </div>
  );
}
