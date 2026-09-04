"use client";

import { useState } from "react";
import { CountdownTimer } from "./CountdownTimer";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { PrizeTiersModal } from "./PrizeTiersModal";
import { TierPrizeTicker } from "./TierPrizeTicker";
import { YieldBreakdownTooltip } from "./YieldBreakdownTooltip";
import { MinimumYieldStatus } from "./MinimumYieldStatus";
import {
  formatCurrencyAmount,
  getLocalizedTierLabel,
  formatApy,
  DEFAULT_APY,
  formatCycleFrequency,
} from "@/app/lib/formatters";
import type { PoolInfo, UserTicketInfo } from "@/app/types";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";

interface PoolCardProps {
  pool: PoolInfo;
  userTickets: UserTicketInfo | null;
  onDeposit: () => void;
  onWithdraw: () => void;
}

const TIER_GRID_LAYOUTS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-2",
  3: "grid-cols-3",
  4: "grid-cols-2 sm:grid-cols-4",
  5: "grid-cols-2 sm:grid-cols-5",
  6: "grid-cols-2 sm:grid-cols-3",
  7: "grid-cols-2 sm:grid-cols-4",
  8: "grid-cols-2 sm:grid-cols-4",
  9: "grid-cols-2 sm:grid-cols-3",
  10: "grid-cols-2 sm:grid-cols-5",
};

export function PoolCard({
  pool,
  userTickets,
  onDeposit,
  onWithdraw,
}: PoolCardProps) {
  const t = useTranslations("Pools");
  const [showAllTiersModal, setShowAllTiersModal] = useState(false);

  const isFrozen = pool.isFrozenForDraw;
  const activeTicketsCount = userTickets?.activeTicketsCount ?? 0;
  const totalTicketsCount =
    activeTicketsCount + (userTickets?.pendingTicketsCount ?? 0);

  return (
    <div
      className={`glass glass-hover relative rounded-2xl p-6 space-y-5 transition-all ${isFrozen ? "frozen-overlay overflow-hidden" : ""}`}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Token icon */}
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/10">
            <span className="font-display text-base font-bold text-primary">
              {pool.tokenSymbol.charAt(0)}
            </span>
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">
              {t("poolTitle", {
                frequency: formatCycleFrequency(pool.stakeCycleDurationHrs, t),
                symbol: pool.tokenSymbol,
              })}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-0.5">
              <Link
                href="/dashboard/draws"
                className="text-xs text-on-surface-variant hover:text-primary transition inline-flex items-center gap-1 group/drawLink"
              >
                <span>
                  {t("drawCycleBadge", {
                    cycleId: pool.currentDrawCycleId,
                    frequency: formatCycleFrequency(
                      pool.stakeCycleDurationHrs,
                      t
                    ),
                  })}
                </span>
                <span className="opacity-0 group-hover/drawLink:opacity-100 transition-opacity text-[10px]">
                  ↗
                </span>
              </Link>
              <span className="inline-flex items-center gap-1 rounded-md bg-secondary/10 border border-secondary/20 px-1.5 py-0.5 text-[10px] font-semibold text-secondary">
                <span className="h-1 w-1 rounded-full bg-secondary" />
                {t("humaLendingTag", {
                  apy: formatApy(pool.underlyingApy ?? DEFAULT_APY),
                })}
              </span>
            </div>
          </div>
        </div>

        <span
          className={`pill ${
            pool.status === "Active"
              ? "pill-success"
              : pool.status === "Paused"
                ? "pill-warning"
                : "pill-error"
          }`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {pool.status}
        </span>
      </div>

      {/* ── Stats Grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <StatCell
          label={t("totalDeposited")}
          value={formatCurrencyAmount(
            pool.totalDepositedPrincipal,
            pool.tokenSymbol,
            pool.tokenDecimals,
            0
          )}
          accent="text-on-surface"
        />
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("estimatedPot")}
            </p>
            <YieldBreakdownTooltip pool={pool} />
          </div>
          <LiveYieldTicker
            pool={pool}
            showBadge={false}
            valueClassName="font-display text-xl font-bold tracking-tight text-gradient"
          />
        </div>
        <StatCell
          label={t("activeSavers")}
          value={(pool.totalUsers ?? 0).toLocaleString("en-US")}
          accent="text-on-surface"
        />
        <StatCell
          label={t("yourTickets")}
          value={activeTicketsCount.toLocaleString("en-US")}
          accent="text-primary"
        />
        <StatCell
          label={t("bondPrice")}
          value={formatCurrencyAmount(
            pool.bondPrice,
            pool.tokenSymbol,
            pool.tokenDecimals,
            2
          )}
          accent="text-on-surface"
        />
        <StatCell
          label={t("totalPrizesDistributed")}
          value={formatCurrencyAmount(
            pool.totalPrizesDistributed ?? 0,
            pool.tokenSymbol,
            pool.tokenDecimals,
            0
          )}
          accent="text-on-surface"
        />
      </div>

      {/* ── Countdown & Minimum Threshold Status ─────────────────────── */}
      <div className="rounded-xl bg-surface-container/80 px-4 py-3 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 shrink-0">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-on-surface-variant"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            <span className="text-xs font-medium text-on-surface-variant">
              {t("drawIn")}
            </span>
          </div>
          <CountdownTimer
            targetTimestamp={pool.currentCycleEndAt}
            showExactDate
          />
        </div>
        <div className="pt-2 border-t border-outline-variant/10">
          <MinimumYieldStatus pool={pool} />
        </div>
      </div>

      {/* ── Prize Tiers ──────────────────────────────────────────────── */}
      {(() => {
        const activeTiers = (pool.prizeTiers || []).filter(
          (tier) => tier.basisPoints > 0 && tier.numWinners > 0
        );

        if (activeTiers.length === 0) return null;

        const featuredTiers = activeTiers.slice(0, 3);
        const gridColsClass =
          TIER_GRID_LAYOUTS[featuredTiers.length] || "grid-cols-3";

        return (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
                {t("prizeTiers")}
              </p>
              {activeTiers.length > 3 && (
                <button
                  onClick={() => setShowAllTiersModal(true)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:text-primary/80 transition cursor-pointer"
                >
                  <span>
                    {t("viewMoreTiers", { count: activeTiers.length - 3 })}
                  </span>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              )}
            </div>
            <div className={`grid ${gridColsClass} gap-2.5`}>
              {featuredTiers.map((tier, i) => (
                <TierPrizeTicker
                  key={i}
                  pool={pool}
                  tier={tier}
                  tierIndex={i}
                  tierLabel={getLocalizedTierLabel(i, activeTiers.length, t)}
                />
              ))}
            </div>

            <PrizeTiersModal
              isOpen={showAllTiersModal}
              onClose={() => setShowAllTiersModal(false)}
              pool={pool}
              onDeposit={onDeposit}
            />
          </div>
        );
      })()}

      {/* ── Status Banners ─────────────────────────────────────────── */}
      {pool.status === "Paused" && !isFrozen && (
        <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 flex items-center gap-2 text-xs text-amber-200">
          <svg
            className="w-4 h-4 text-amber-400 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <span>
            Emergency pause active. Deposits and withdrawals are temporarily
            halted.
          </span>
        </div>
      )}
      {pool.status === "Closed" && (
        <div className="rounded-xl bg-surface-container-high/80 border border-surface-container-highest px-4 py-2.5 flex items-center gap-2 text-xs text-on-surface-variant">
          <svg
            className="w-4 h-4 text-on-surface-variant shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <span>
            Pool closed (sunset). You may withdraw 100% of your remaining bond
            principal.
          </span>
        </div>
      )}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="space-y-2.5 relative z-0">
        <div className="flex gap-3">
          <button
            onClick={onDeposit}
            disabled={isFrozen || pool.status !== "Active"}
            className="btn-gradient flex-1 rounded-xl px-4 py-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("depositButton")}
          </button>
          <button
            onClick={onWithdraw}
            disabled={
              isFrozen || pool.status === "Paused" || totalTicketsCount === 0
            }
            className="btn-ghost flex-1 rounded-xl px-4 py-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {t("withdrawButton")}
          </button>
        </div>
        <div className="flex items-center justify-center gap-1.5 text-center text-[11px] font-medium text-on-surface-variant/75 pt-0.5">
          <svg
            className="w-3.5 h-3.5 text-secondary shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>{t("principalProtectionNotice")}</span>
        </div>
      </div>

      {/* ── Frozen Message ───────────────────────────────────────────── */}
      {isFrozen && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center rounded-2xl pointer-events-auto">
          <div className="flex items-center gap-2 rounded-xl bg-surface-container-high/95 px-5 py-3 shadow-ambient border border-primary/25">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-tertiary animate-yield-pulse"
            >
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
            </svg>
            <p className="text-sm font-semibold text-on-surface">
              {t("drawInProgress")}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
        {label}
      </p>
      <p className={`font-display text-xl font-bold tracking-tight ${accent}`}>
        {value}
      </p>
    </div>
  );
}
