"use client";

import React from "react";
import { useTranslations } from "next-intl";

export type AnyStatus =
  | "Complete"
  | "AwaitingYield"
  | "AwaitingRandomness"
  | "Skipped"
  | "ForceUnlocked"
  | "Voided"
  | "HaltedInsolvent"
  | "HaltedYieldSpike"
  | "Halted"
  | "processing"
  | "reinvested"
  | "timelocked"
  | "Active"
  | "Paused"
  | "Closed"
  | "settling"
  | "ready";

interface StatusBadgeProps {
  status: AnyStatus | string;
  isCranking?: boolean;
  size?: "sm" | "md";
  className?: string;
  labelOverride?: string;
}

export function StatusBadge({
  status,
  isCranking = false,
  size = "md",
  className = "",
  labelOverride,
}: StatusBadgeProps) {
  const tDraws = useTranslations("DrawHistory");
  const tLedger = useTranslations("Ledger");
  const tRedemptions = useTranslations("Redemptions");

  const sizeClass =
    size === "sm"
      ? "px-2.5 py-0.5 text-[11px] leading-tight"
      : "px-3 py-1 text-xs leading-normal";

  const baseClasses = `inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap transition-colors ${sizeClass} ${className}`;

  if (isCranking) {
    return (
      <span
        className={`${baseClasses} border-amber-500/20 bg-amber-500/10 text-amber-300 animate-pulse`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-spin shrink-0" />
        {tLedger("cranking")}
      </span>
    );
  }

  switch (status) {
    // ── Draw Cycle Statuses ──────────────────────────────────────────────────
    case "Complete":
      return (
        <span
          className={`${baseClasses} border-emerald-500/20 bg-emerald-500/10 text-emerald-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusComplete")}
        </span>
      );

    case "AwaitingRandomness":
      return (
        <span
          className={`${baseClasses} border-amber-500/20 bg-amber-500/10 text-amber-300 animate-pulse`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusAwaitingVRF")}
        </span>
      );

    case "AwaitingYield":
      return (
        <span
          className={`${baseClasses} border-sky-500/20 bg-sky-500/10 text-sky-300`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusAwaitingYield")}
        </span>
      );

    case "Skipped":
      return (
        <span
          className={`${baseClasses} border-slate-500/20 bg-slate-500/10 text-slate-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusSkipped")}
        </span>
      );

    case "ForceUnlocked":
      return (
        <span
          className={`${baseClasses} border-rose-500/20 bg-rose-500/10 text-rose-300`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusForceUnlocked")}
        </span>
      );

    case "Voided":
      return (
        <span
          className={`${baseClasses} border-red-500/20 bg-red-500/10 text-red-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusVoided")}
        </span>
      );

    case "HaltedInsolvent":
      return (
        <span
          className={`${baseClasses} border-red-500/30 bg-red-500/15 text-red-300 animate-pulse`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusHaltedInsolventBadge")}
        </span>
      );

    case "HaltedYieldSpike":
      return (
        <span
          className={`${baseClasses} border-amber-500/30 bg-amber-500/15 text-amber-300 animate-pulse`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusHaltedYieldSpikeBadge")}
        </span>
      );

    case "Halted":
      return (
        <span
          className={`${baseClasses} border-red-500/30 bg-red-500/15 text-red-300 animate-pulse`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tDraws("statusHaltedAll")}
        </span>
      );

    // ── Prize History Statuses ───────────────────────────────────────────────
    case "timelocked":
      return (
        <span
          className={`${baseClasses} border-amber-500/30 bg-amber-500/10 text-amber-300`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          🔒 {labelOverride || tLedger("timelocked")}
        </span>
      );

    case "processing":
      return (
        <span
          className={`${baseClasses} border-amber-500/20 bg-amber-500/10 text-amber-300`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0 animate-pulse" />
          {tLedger("processing")}
        </span>
      );

    case "reinvested":
      return (
        <span
          className={`${baseClasses} border-emerald-500/20 bg-emerald-500/10 text-emerald-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tLedger("reinvested")}
        </span>
      );

    // ── Pool Statuses ────────────────────────────────────────────────────────
    case "Active":
      return (
        <span
          className={`${baseClasses} border-emerald-500/20 bg-emerald-500/10 text-emerald-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          Active
        </span>
      );

    case "Paused":
      return (
        <span
          className={`${baseClasses} border-amber-500/20 bg-amber-500/10 text-amber-300`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          Paused
        </span>
      );

    case "Closed":
      return (
        <span
          className={`${baseClasses} border-slate-500/20 bg-slate-500/10 text-slate-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          Closed
        </span>
      );

    // ── Redemption Statuses ──────────────────────────────────────────────────
    case "settling":
      return (
        <span
          className={`${baseClasses} border-amber-500/20 bg-amber-500/10 text-amber-300`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0 animate-pulse" />
          {tRedemptions("settling")}
        </span>
      );

    case "ready":
      return (
        <span
          className={`${baseClasses} border-emerald-500/20 bg-emerald-500/10 text-emerald-400`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {tRedemptions("ready")}
        </span>
      );

    default:
      return (
        <span
          className={`${baseClasses} border-surface-bright/10 bg-surface-container/30 text-on-surface-variant`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
          {status}
        </span>
      );
  }
}
