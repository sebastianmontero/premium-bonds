"use client";

import React from "react";
import { formatCurrency } from "@/app/lib/formatters";
import type { DrawHistoryStats } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawStatsSummaryProps {
  stats: Partial<DrawHistoryStats> | null;
  tokenDecimals?: number;
  tokenSymbol?: string;
  isLoading?: boolean;
}

interface HeroMetricCardProps {
  title: string;
  subtitle: string;
  value: string | null;
  isLoading: boolean;
  skeletonWidth: string;
  icon: React.ReactNode;
  isGradientText?: boolean;
  isStrongCard?: boolean;
  unavailableLabel: string;
}

function HeroMetricCard({
  title,
  subtitle,
  value,
  isLoading,
  skeletonWidth,
  icon,
  isGradientText = false,
  isStrongCard = false,
  unavailableLabel,
}: HeroMetricCardProps) {
  return (
    <div
      className={
        isStrongCard
          ? "glass-strong rounded-2xl p-6 shadow-ambient relative overflow-hidden border-t-primary/50 flex flex-col justify-between gap-3"
          : "glass glass-hover rounded-2xl p-6 flex flex-col justify-between gap-3"
      }
    >
      {isStrongCard && (
        <div
          aria-hidden="true"
          className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-primary/15 blur-[32px] pointer-events-none"
        />
      )}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          {icon}
          <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            {title}
          </p>
        </div>
        {isLoading ? (
          <div
            className={`h-9 ${skeletonWidth} rounded-lg skeleton-box mt-1`}
          />
        ) : value != null ? (
          <p
            className={`font-display text-3xl font-bold tracking-tight ${
              isGradientText ? "text-gradient" : "text-on-surface"
            }`}
          >
            {value}
          </p>
        ) : (
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface-variant">
            <span aria-label={unavailableLabel}>—</span>
          </p>
        )}
      </div>

      <p className="text-xs text-on-surface-variant/70">{subtitle}</p>
    </div>
  );
}

export function DrawStatsSummary({
  stats,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  isLoading = false,
}: DrawStatsSummaryProps) {
  const t = useTranslations("DrawHistory");
  const unavailableLabel = t("metricUnavailable");

  const totalYieldDistributed =
    stats?.totalYieldDistributed != null
      ? formatCurrency(stats.totalYieldDistributed, {
          tokenSymbol,
          decimals: tokenDecimals,
        })
      : null;

  const totalDrawsCompleted =
    stats?.totalDrawsCompleted != null
      ? stats.totalDrawsCompleted.toLocaleString("en-US")
      : null;

  const totalWinningBonds =
    stats?.totalWinningBonds != null
      ? stats.totalWinningBonds.toLocaleString("en-US")
      : null;

  const averagePrizePot =
    stats?.averagePrizePot != null
      ? formatCurrency(stats.averagePrizePot, {
          tokenSymbol,
          decimals: tokenDecimals,
        })
      : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* ── 1. Total Prizes Distributed ─────────────────────────────────── */}
      <HeroMetricCard
        title={t("totalPrizesDistributed")}
        subtitle={t("totalPrizesDistributedSub")}
        value={totalYieldDistributed}
        isLoading={isLoading}
        skeletonWidth="w-36"
        isStrongCard
        unavailableLabel={unavailableLabel}
        icon={
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
        }
      />

      {/* ── 2. Total Completed Draws ────────────────────────────────────── */}
      <HeroMetricCard
        title={t("totalDraws")}
        subtitle={t("totalDrawsSub")}
        value={totalDrawsCompleted}
        isLoading={isLoading}
        skeletonWidth="w-20"
        unavailableLabel={unavailableLabel}
        icon={
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
        }
      />

      {/* ── 3. Total Winning Bonds Awarded ──────────────────────────────── */}
      <HeroMetricCard
        title={t("winningBonds")}
        subtitle={t("winningBondsSub")}
        value={totalWinningBonds}
        isLoading={isLoading}
        skeletonWidth="w-24"
        isGradientText
        unavailableLabel={unavailableLabel}
        icon={
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
        }
      />

      {/* ── 4. Average Prize Pot ────────────────────────────────────────── */}
      <HeroMetricCard
        title={t("avgPot")}
        subtitle={t("avgPotSub")}
        value={averagePrizePot}
        isLoading={isLoading}
        skeletonWidth="w-32"
        unavailableLabel={unavailableLabel}
        icon={
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
        }
      />
    </div>
  );
}
