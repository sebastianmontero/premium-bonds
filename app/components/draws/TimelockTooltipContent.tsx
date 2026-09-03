"use client";

import React from "react";
import { useTranslations } from "next-intl";
import type { PayoutTimelockState } from "@/app/lib/draw-helpers";

export interface TimelockTooltipContentProps {
  timelock: PayoutTimelockState;
  titleOverride?: string;
}

export function TimelockTooltipContent({
  timelock,
  titleOverride,
}: TimelockTooltipContentProps) {
  const tLedger = useTranslations("Ledger");

  return (
    <div className="space-y-1.5 whitespace-normal break-words text-left">
      <p className="text-xs font-semibold text-amber-300 leading-snug whitespace-normal break-words">
        {titleOverride ||
          tLedger("timelockTooltip", {
            remaining: timelock.formattedRemaining,
          })}
      </p>
      <p className="text-[11px] text-amber-200/80 font-mono whitespace-normal break-words">
        {tLedger("timelockUnlocksAt", {
          time: timelock.formattedUnlockTime,
        })}
      </p>
    </div>
  );
}
