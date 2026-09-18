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

type StatusDescriptor =
  | {
      ns: "DrawHistory";
      key: Parameters<ReturnType<typeof useTranslations<"DrawHistory">>>[0];
      colorClass: string;
      dotPulse?: boolean;
      badgePulse?: boolean;
      hasLockEmoji?: boolean;
    }
  | {
      ns: "Ledger";
      key: Parameters<ReturnType<typeof useTranslations<"Ledger">>>[0];
      colorClass: string;
      dotPulse?: boolean;
      badgePulse?: boolean;
      hasLockEmoji?: boolean;
    }
  | {
      ns: "Redemptions";
      key: Parameters<ReturnType<typeof useTranslations<"Redemptions">>>[0];
      colorClass: string;
      dotPulse?: boolean;
      badgePulse?: boolean;
      hasLockEmoji?: boolean;
    }
  | {
      ns: "Pools";
      key: Parameters<ReturnType<typeof useTranslations<"Pools">>>[0];
      colorClass: string;
      dotPulse?: boolean;
      badgePulse?: boolean;
      hasLockEmoji?: boolean;
    };

const STATUS_CONFIG: Record<string, StatusDescriptor> = {
  Complete: {
    ns: "DrawHistory",
    key: "statusComplete",
    colorClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
  AwaitingRandomness: {
    ns: "DrawHistory",
    key: "statusAwaitingVRF",
    colorClass: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    badgePulse: true,
  },
  AwaitingYield: {
    ns: "DrawHistory",
    key: "statusAwaitingYield",
    colorClass: "border-sky-500/20 bg-sky-500/10 text-sky-300",
  },
  Skipped: {
    ns: "DrawHistory",
    key: "statusSkipped",
    colorClass: "border-slate-500/20 bg-slate-500/10 text-slate-400",
  },
  ForceUnlocked: {
    ns: "DrawHistory",
    key: "statusForceUnlocked",
    colorClass: "border-rose-500/20 bg-rose-500/10 text-rose-300",
  },
  Voided: {
    ns: "DrawHistory",
    key: "statusVoided",
    colorClass: "border-red-500/20 bg-red-500/10 text-red-400",
  },
  HaltedInsolvent: {
    ns: "DrawHistory",
    key: "statusHaltedInsolvent",
    colorClass: "border-red-500/30 bg-red-500/15 text-red-300",
    badgePulse: true,
  },
  HaltedYieldSpike: {
    ns: "DrawHistory",
    key: "statusHaltedYieldSpike",
    colorClass: "border-amber-500/30 bg-amber-500/15 text-amber-300",
    badgePulse: true,
  },
  timelocked: {
    ns: "Ledger",
    key: "timelocked",
    colorClass: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    dotPulse: true,
    hasLockEmoji: true,
  },
  processing: {
    ns: "Ledger",
    key: "processing",
    colorClass: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    dotPulse: true,
  },
  reinvested: {
    ns: "Ledger",
    key: "reinvested",
    colorClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
  Active: {
    ns: "Pools",
    key: "statusActive",
    colorClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
  Paused: {
    ns: "Pools",
    key: "statusPaused",
    colorClass: "border-amber-500/20 bg-amber-500/10 text-amber-300",
  },
  Closed: {
    ns: "Pools",
    key: "statusClosed",
    colorClass: "border-slate-500/20 bg-slate-500/10 text-slate-400",
  },
  settling: {
    ns: "Redemptions",
    key: "settling",
    colorClass: "border-amber-500/20 bg-amber-500/10 text-amber-300",
    dotPulse: true,
  },
  ready: {
    ns: "Redemptions",
    key: "ready",
    colorClass: "border-emerald-500/20 bg-emerald-500/10 text-emerald-400",
  },
};

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
  const tPools = useTranslations("Pools");

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

  const config = STATUS_CONFIG[status];
  if (!config) {
    return (
      <span
        className={`${baseClasses} border-surface-bright/10 bg-surface-container/30 text-on-surface-variant`}
      >
        <span className="h-1.5 w-1.5 rounded-full bg-current shrink-0" />
        {labelOverride || status}
      </span>
    );
  }

  let label = labelOverride;
  if (!label) {
    switch (config.ns) {
      case "DrawHistory":
        label = tDraws(config.key);
        break;
      case "Ledger":
        label = tLedger(config.key);
        break;
      case "Redemptions":
        label = tRedemptions(config.key);
        break;
      case "Pools":
        label = tPools(config.key);
        break;
    }
  }

  return (
    <span
      className={`${baseClasses} ${config.colorClass} ${
        config.badgePulse ? "animate-pulse" : ""
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          config.hasLockEmoji ? "bg-amber-400" : "bg-current"
        } shrink-0 ${config.dotPulse ? "animate-pulse" : ""}`}
      />
      {config.hasLockEmoji ? `🔒 ${label}` : label}
    </span>
  );
}
