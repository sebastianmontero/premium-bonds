"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import type { PayoutTimelockState } from "@/app/lib/draw-helpers";
import { TimelockTooltipContent } from "@/app/components/draws/TimelockTooltipContent";

export interface CrankActionButtonProps {
  timelockState?: PayoutTimelockState;
  isFrozenForDraw?: boolean;
  isCranking?: boolean;
  onCrank?: () => void;
  size?: "sm" | "md";
  className?: string;
  tooltipAlign?: "left" | "center" | "right";
  tooltipSide?: "top" | "bottom";
}

export function CrankActionButton({
  timelockState,
  isFrozenForDraw,
  isCranking = false,
  onCrank,
  size = "sm",
  className = "",
  tooltipAlign = "right",
  tooltipSide = "top",
}: CrankActionButtonProps) {
  const tLedger = useTranslations("Ledger");
  const sizeClasses =
    size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3 py-1.5 text-xs";

  // State 1: Settlement Timelocked
  if (timelockState?.isTimelocked) {
    return (
      <InteractiveTooltip
        ariaLabel={`Crank locked: ${tLedger("timelockTooltip", { remaining: timelockState.formattedRemaining })}`}
        align={tooltipAlign}
        side={tooltipSide}
        triggerClassName="inline-flex p-0"
        panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
        content={<TimelockTooltipContent timelock={timelockState} />}
      >
        <span
          aria-disabled="true"
          className={`rounded-lg font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/80 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0 ${sizeClasses} ${className}`}
        >
          <span>🔒</span> {timelockState.formattedRemaining}
        </span>
      </InteractiveTooltip>
    );
  }

  // State 2: Frozen for Draw
  if (isFrozenForDraw) {
    return (
      <InteractiveTooltip
        ariaLabel={tLedger("frozenCrankTooltip")}
        align={tooltipAlign}
        side={tooltipSide}
        triggerClassName="inline-flex p-0"
        panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
        content={
          <p className="text-xs leading-relaxed text-amber-200">
            {tLedger("frozenCrankTooltip")}
          </p>
        }
      >
        <span
          aria-disabled="true"
          className={`rounded-lg font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/60 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0 ${sizeClasses} ${className}`}
        >
          <span>❄️</span> {tLedger("claimingPaused")}
        </span>
      </InteractiveTooltip>
    );
  }

  // State 3: Active Actionable Crank
  if (onCrank) {
    return (
      <button
        type="button"
        disabled={isCranking}
        onClick={(e) => {
          e.stopPropagation();
          onCrank();
        }}
        className={`rounded-lg font-bold bg-primary hover:bg-primary/90 text-on-primary transition-colors shadow-sm inline-flex items-center gap-1 shrink-0 cursor-pointer ${sizeClasses} ${className}`}
      >
        {isCranking ? (
          <>
            <span className="h-1.5 w-1.5 rounded-full bg-current animate-spin" />
            {tLedger("cranking")}
          </>
        ) : (
          tLedger("runCrank")
        )}
      </button>
    );
  }

  return null;
}
