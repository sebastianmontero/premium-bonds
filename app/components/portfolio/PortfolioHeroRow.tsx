"use client";

import { useState } from "react";
import {
  formatTokenAmount,
  calculateAnnualDrawEntries,
} from "@/app/lib/formatters";
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
  currentDrawCycleId?: number;
  stakeCycleDurationHrs?: number;
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
  currentDrawCycleId = 1,
  stakeCycleDurationHrs = 168,
}: PortfolioHeroRowProps) {
  const t = useTranslations("Portfolio");

  const totalTickets = activeTickets + pendingTickets;
  const cycleId =
    typeof currentDrawCycleId === "number" && currentDrawCycleId > 0
      ? currentDrawCycleId
      : 1;
  const nextCycleId = cycleId + 1;

  const { drawsPerYear, annualEntries } = calculateAnnualDrawEntries(
    totalTickets,
    stakeCycleDurationHrs
  );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {/* ── 1. Total Portfolio Value ────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 shadow-ambient relative border-t-primary/50 flex flex-col gap-3">
        <div
          aria-hidden="true"
          className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none"
        >
          <div className="absolute -top-10 -right-10 h-32 w-32 rounded-full bg-primary/15 blur-[32px]" />
        </div>
        <div className="space-y-1.5 relative z-10">
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
            <InteractiveTooltip
              content={t("totalPortfolioValueTooltip")}
              ariaLabel="Portfolio Value Details"
              align="left"
            >
              <InfoIcon />
            </InteractiveTooltip>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
            ${formatTokenAmount(netWorth, tokenDecimals)}
            <span className="ms-1.5 text-base font-medium text-on-surface-variant">
              {tokenSymbol}
            </span>
          </p>
        </div>

        {/* Chips with Interactive Tooltips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5 relative z-10">
          <InteractiveTooltip
            content={t("bondsInvestedTooltip")}
            ariaLabel="Bonds Principal Status"
            align="left"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-white/25 hover:bg-white/[0.08] transition-all">
              <span className="font-mono font-medium text-on-surface">
                ${formatTokenAmount(investedAmount, tokenDecimals)}
              </span>
              <span>{t("bonds")}</span>
            </span>
          </InteractiveTooltip>

          {redeemingAmount > 0 && (
            <InteractiveTooltip
              content={t("redeemingTooltip")}
              ariaLabel="Redeeming Principal Status"
              align="left"
            >
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-secondary/40 hover:bg-secondary/20 transition-all">
                <span className="font-mono font-medium text-on-surface">
                  ${formatTokenAmount(redeemingAmount, tokenDecimals)}
                </span>
                <span>{t("redeeming")}</span>
              </span>
            </InteractiveTooltip>
          )}

          {unclaimedAmount > 0 && (
            <InteractiveTooltip
              content={t("unclaimedDustTooltip")}
              ariaLabel="Unclaimed Dust Status"
              align="left"
            >
              <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-tight text-amber-300 backdrop-blur-sm cursor-help hover:border-amber-500/45 hover:bg-amber-500/20 transition-all">
                <span className="font-mono font-semibold text-amber-200">
                  ${formatTokenAmount(unclaimedAmount, tokenDecimals)}
                </span>
                <span>{t("unclaimed")}</span>
              </span>
            </InteractiveTooltip>
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
            <InteractiveTooltip
              content={t("bondsInfoTooltip")}
              ariaLabel="Bonds Information"
              align="left"
            >
              <InfoIcon />
            </InteractiveTooltip>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
            {totalTickets.toLocaleString("en-US")}
          </p>
        </div>

        {/* Chips with Interactive Tooltips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <InteractiveTooltip
            content={t("activeBondsTooltip", { cycleId })}
            ariaLabel="Active Bonds Status"
            align="left"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-secondary/40 hover:bg-secondary/20 transition-all">
              <span className="font-mono font-medium text-on-surface">
                {activeTickets.toLocaleString("en-US")}
              </span>
              <span>{t("active")}</span>
            </span>
          </InteractiveTooltip>

          <InteractiveTooltip
            content={t("pendingBondsTooltip", { nextCycleId })}
            ariaLabel="Pending Bonds Status"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-white/25 hover:bg-white/[0.08] transition-all">
              <span className="font-mono font-medium text-on-surface">
                {pendingTickets.toLocaleString("en-US")}
              </span>
              <span>{t("pending")}</span>
            </span>
          </InteractiveTooltip>
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
            <InteractiveTooltip
              content={t("lifetimeWinningsTooltip")}
              ariaLabel="Lifetime Winnings Information"
              align="left"
            >
              <InfoIcon />
            </InteractiveTooltip>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-gradient">
            ${formatTokenAmount(lifetimeWinnings, tokenDecimals)}
            <span className="ms-1.5 text-base font-medium text-on-surface-variant bg-none [-webkit-text-fill-color:var(--on-surface-variant)]">
              {tokenSymbol}
            </span>
          </p>
        </div>

        {/* Chips with Interactive Tooltips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <InteractiveTooltip
            content={t("reinvestedWinningsTooltip")}
            ariaLabel="Reinvested Winnings Status"
            align="left"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-tertiary/20 bg-tertiary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-tertiary/40 hover:bg-tertiary/20 transition-all">
              <span className="font-mono font-medium text-on-surface">
                ${formatTokenAmount(autoReinvestedTotal, tokenDecimals)}
              </span>
              <span>{t("reinvested")}</span>
            </span>
          </InteractiveTooltip>

          <InteractiveTooltip
            content={t("nonReinvestedWinningsTooltip")}
            ariaLabel="Non-reinvested Dust Status"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-white/[0.08] bg-white/[0.04] px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-white/25 hover:bg-white/[0.08] transition-all">
              <span className="font-mono font-medium text-on-surface">
                ${formatTokenAmount(nonReinvestedWinnings, tokenDecimals)}
              </span>
              <span>{t("nonReinvested")}</span>
            </span>
          </InteractiveTooltip>
        </div>
      </div>

      {/* ── 4. Annual Draw Entries ──────────────────────────────────────── */}
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
              <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              {t("annualDrawEntries")}
            </p>
            <InteractiveTooltip
              content={t("annualDrawEntriesTooltip")}
              ariaLabel="Annual Draw Entries Information"
              align="left"
            >
              <InfoIcon />
            </InteractiveTooltip>
          </div>
          <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
            {annualEntries.toLocaleString("en-US")}
          </p>
        </div>

        {/* Chips with Interactive Tooltips */}
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <InteractiveTooltip
            content={t("bondsTimesDrawsTooltip", {
              tickets: totalTickets,
              draws: drawsPerYear,
            })}
            ariaLabel="Annual Draw Calculation"
            align="left"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-secondary/20 bg-secondary/10 px-1.5 py-0.5 text-[11px] leading-tight text-on-surface-variant backdrop-blur-sm cursor-help hover:border-secondary/40 hover:bg-secondary/20 transition-all">
              <span className="font-mono font-medium text-on-surface">
                {t("bondsTimesDraws", {
                  tickets: totalTickets,
                  draws: drawsPerYear,
                })}
              </span>
            </span>
          </InteractiveTooltip>

          <InteractiveTooltip
            content={t("neverExpireTooltip")}
            ariaLabel="Perpetual Draw Eligibility"
            align="right"
          >
            <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-primary/20 bg-primary/10 px-1.5 py-0.5 text-[11px] leading-tight text-primary backdrop-blur-sm cursor-help hover:border-primary/45 hover:bg-primary/20 transition-all">
              <span>{t("neverExpire")}</span>
            </span>
          </InteractiveTooltip>
        </div>
      </div>
    </div>
  );
}

/**
 * Reusable info question-mark icon with consistent styling.
 */
function InfoIcon() {
  return (
    <span className="cursor-help text-on-surface-variant/70 hover:text-primary transition-colors inline-flex items-center">
      <svg
        className="w-3.5 h-3.5"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 16v-4m0-4h.01"
        />
      </svg>
    </span>
  );
}

/**
 * Accessible touch- & keyboard-friendly tooltip wrapper with high-contrast opaque container
 * and directional alignment support to prevent clipping on boundaries.
 */
function InteractiveTooltip({
  content,
  ariaLabel,
  children,
  align = "center",
}: {
  content: string;
  ariaLabel: string;
  children: React.ReactNode;
  align?: "left" | "center" | "right";
}) {
  const [isOpen, setIsOpen] = useState(false);

  const getPositionClasses = () => {
    switch (align) {
      case "left":
        return "left-0 translate-x-0";
      case "right":
        return "right-0 left-auto translate-x-0";
      case "center":
      default:
        return "left-1/2 -translate-x-1/2";
    }
  };

  const getArrowClasses = () => {
    switch (align) {
      case "left":
        return "left-4 translate-x-0";
      case "right":
        return "right-4 left-auto translate-x-0";
      case "center":
      default:
        return "left-1/2 -translate-x-1/2";
    }
  };

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => setIsOpen((prev) => !prev)}
        onFocus={() => setIsOpen(true)}
        onBlur={() => setIsOpen(false)}
        className="inline-flex items-center cursor-pointer text-left bg-transparent border-0 p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md"
      >
        {children}
      </button>

      {isOpen && (
        <div
          role="tooltip"
          className={`absolute bottom-full mb-2.5 z-50 w-56 sm:w-64 rounded-xl shadow-2xl p-3 text-xs text-on-surface leading-relaxed border border-outline-variant/40 animate-fadeIn pointer-events-none ${getPositionClasses()}`}
          style={{ backgroundColor: "rgba(16, 23, 38, 0.98)" }}
        >
          <div className="relative z-10 font-normal text-on-surface">
            {content}
          </div>
          {/* Opaque Arrow */}
          <div
            className={`absolute top-full -mt-px w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-[#101726] ${getArrowClasses()}`}
          />
        </div>
      )}
    </div>
  );
}
