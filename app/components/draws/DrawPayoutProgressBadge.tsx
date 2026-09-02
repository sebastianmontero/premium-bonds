"use client";

import React from "react";
import { getPayoutTimelockState, isHaltedStatus } from "@/app/lib/draw-helpers";
import type { DrawCycleSummary } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawPayoutProgressBadgeProps {
  draw: Pick<
    DrawCycleSummary,
    "status" | "revealedAt" | "payoutsCompleted" | "winnersCount"
  >;
  payoutTimelockSeconds?: number;
  now?: number;
}

export function DrawPayoutProgressBadge({
  draw,
  payoutTimelockSeconds = 300,
  now,
}: DrawPayoutProgressBadgeProps) {
  const t = useTranslations("DrawHistory");

  if (draw.status === "Skipped" || draw.status === "ForceUnlocked") {
    return (
      <span className="text-xs text-on-surface-variant/40 font-mono">—</span>
    );
  }

  if (draw.status === "Voided") {
    return (
      <span className="font-mono text-[11px] font-semibold text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded-md">
        {t("statusVoided")}
      </span>
    );
  }

  if (draw.status === "AwaitingRandomness") {
    return (
      <span className="font-mono text-[11px] font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md animate-pulse">
        {t("statusAwaitingVRF")}
      </span>
    );
  }

  if (draw.status === "AwaitingYield") {
    return (
      <span className="font-mono text-[11px] font-semibold text-on-surface-variant/60">
        {t("statusAwaitingYield")}
      </span>
    );
  }

  if (isHaltedStatus(draw.status)) {
    return (
      <span className="font-mono text-xs text-on-surface-variant/40">—</span>
    );
  }

  // Complete / Payout-Bearing State
  const timelock = getPayoutTimelockState(
    draw.revealedAt,
    payoutTimelockSeconds,
    now
  );

  if (timelock.isTimelocked && draw.payoutsCompleted === 0) {
    return (
      <span
        className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md"
        title={t("estimatedPrefix")}
      >
        <span>🔒</span> {draw.payoutsCompleted} / {draw.winnersCount}
      </span>
    );
  }

  const allCompleted =
    draw.winnersCount > 0 && draw.payoutsCompleted === draw.winnersCount;

  return (
    <span
      className={`font-mono text-xs font-semibold inline-flex items-center gap-1 ${
        allCompleted ? "text-emerald-400" : "text-tertiary"
      }`}
    >
      <span>
        {draw.payoutsCompleted} / {draw.winnersCount}
      </span>
      {allCompleted && <span className="text-[10px] font-bold">✓</span>}
    </span>
  );
}
