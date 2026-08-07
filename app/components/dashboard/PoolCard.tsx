"use client";

import { useState } from "react";
import { CountdownTimer } from "./CountdownTimer";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { PrizeTiersModal } from "./PrizeTiersModal";
import { formatTokenAmount, tierColor } from "@/app/lib/formatters";
import type { PoolInfo, UserTicketInfo } from "@/app/types";
import { useTranslations } from "next-intl";

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

  const getTierLabel = (tierIndex: number, totalCount: number) => {
    switch (tierIndex) {
      case 0:
        return t("grand");
      case 1:
        return t("runnerUp");
      default:
        if (totalCount <= 3) {
          return t("consolation");
        }
        return t("tierN", { tier: tierIndex + 1 });
    }
  };

  return (
    <div
      className={`glass glass-hover relative overflow-hidden rounded-2xl p-6 space-y-5 transition-all ${isFrozen ? "frozen-overlay" : ""}`}
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
              {pool.tokenSymbol === "USDC"
                ? t("weeklyUSDC")
                : `${pool.tokenSymbol} Pool`}
            </h3>
            <p className="text-xs text-on-surface-variant">
              {t("weeklyDraw", { cycleId: pool.currentDrawCycleId })}
            </p>
          </div>
        </div>

        <span
          className={`pill ${pool.status === "Active" ? "pill-success" : "pill-warning"}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {pool.status}
        </span>
      </div>

      {/* ── Stats Grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <StatCell
          label={t("totalDeposited")}
          value={`$${formatTokenAmount(pool.totalDepositedPrincipal, pool.tokenDecimals, 0)}`}
          accent="text-on-surface"
        />
        <div className="space-y-0.5">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
            {t("estimatedPot")}
          </p>
          <LiveYieldTicker
            pool={pool}
            precision={4}
            showBadge={false}
            valueClassName="font-display text-xl font-bold tracking-tight text-gradient"
          />
        </div>
        <StatCell
          label={t("yourTickets")}
          value={activeTicketsCount.toLocaleString("en-US")}
          accent="text-primary"
        />
        <StatCell
          label={t("bondPrice")}
          value={`${formatTokenAmount(pool.bondPrice, pool.tokenDecimals)} ${pool.tokenSymbol}`}
          accent="text-on-surface"
        />
      </div>

      {/* ── Countdown ────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-container/80 px-4 py-3">
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
        <CountdownTimer targetTimestamp={pool.currentCycleEndAt} />
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
                <div
                  key={i}
                  className="rounded-lg bg-surface-container/60 px-3 py-2 text-center border border-surface-container-high/40 hover:bg-surface-container-high/50 transition-colors"
                >
                  <p
                    className={`text-[10px] font-semibold truncate ${tierColor(i)}`}
                  >
                    {getTierLabel(i, activeTiers.length)}
                  </p>
                  <p className="mt-0.5 font-mono text-sm font-semibold text-on-surface">
                    {(tier.basisPoints / 100).toLocaleString("en-US", {
                      maximumFractionDigits: 1,
                    })}
                    %
                  </p>
                  <p className="text-[10px] text-on-surface-variant">
                    ×{tier.numWinners}
                  </p>
                </div>
              ))}
            </div>

            <PrizeTiersModal
              isOpen={showAllTiersModal}
              onClose={() => setShowAllTiersModal(false)}
              pool={pool}
            />
          </div>
        );
      })()}

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex gap-3 relative z-0">
        <button
          onClick={onDeposit}
          disabled={isFrozen}
          className="btn-gradient flex-1 rounded-xl px-4 py-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("depositButton")}
        </button>
        <button
          onClick={onWithdraw}
          disabled={isFrozen || totalTicketsCount === 0}
          className="btn-ghost flex-1 rounded-xl px-4 py-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {t("withdrawButton")}
        </button>
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
