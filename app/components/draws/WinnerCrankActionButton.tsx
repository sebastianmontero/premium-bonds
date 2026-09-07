"use client";

import React from "react";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "./TimelockTooltipContent";
import type { PayoutTimelockState } from "@/app/hooks/usePayoutTimelock";
import { useTranslations } from "next-intl";

export interface WinnerCrankActionButtonProps {
  winnerIndex: number;
  winnerAddress: string;
  isProcessed: boolean;
  timelockState: PayoutTimelockState;
  isClaimingPaused?: boolean;
  isVoided?: boolean;
  isCranking?: boolean;
  onCrank?: (winnerIndex: number, winnerAddress: string) => void;
  size?: "sm" | "md";
}

export function WinnerCrankActionButton({
  winnerIndex,
  winnerAddress,
  isProcessed,
  timelockState,
  isClaimingPaused = false,
  isVoided = false,
  isCranking = false,
  onCrank,
  size = "sm",
}: WinnerCrankActionButtonProps) {
  const tLedger = useTranslations("Ledger");
  const t = useTranslations("DrawInspector");

  if (isVoided) {
    return (
      <span
        className="text-[10px] text-red-400/70 font-mono"
        title={t("voidedCrankTooltip")}
      >
        —
      </span>
    );
  }

  if (isProcessed) {
    return null;
  }

  if (timelockState.isTimelocked) {
    return (
      <InteractiveTooltip
        ariaLabel={`Crank locked: ${tLedger("timelockTooltip", { remaining: timelockState.formattedRemaining })}`}
        align="right"
        side="top"
        triggerClassName="inline-flex p-0"
        panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
        content={<TimelockTooltipContent timelock={timelockState} />}
      >
        <span
          aria-disabled="true"
          className={`rounded-lg font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/80 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0 ${
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-2 text-xs"
          }`}
        >
          <span aria-hidden="true">🔒</span> {timelockState.formattedRemaining}
        </span>
      </InteractiveTooltip>
    );
  }

  if (isClaimingPaused) {
    return (
      <InteractiveTooltip
        ariaLabel={tLedger("frozenCrankTooltip")}
        align="right"
        side="top"
        triggerClassName="inline-flex"
        panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
        content={
          <p className="text-xs leading-relaxed text-amber-200">
            {tLedger("frozenCrankTooltip")}
          </p>
        }
      >
        <span
          aria-disabled="true"
          className={`rounded-lg font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/60 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0 ${
            size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-3.5 py-2 text-xs"
          }`}
        >
          <span aria-hidden="true">❄️</span> {tLedger("claimingPaused")}
        </span>
      </InteractiveTooltip>
    );
  }

  if (onCrank) {
    return (
      <button
        type="button"
        disabled={isCranking}
        onClick={() => onCrank(winnerIndex, winnerAddress)}
        className={`rounded-xl font-bold bg-amber-500 hover:bg-amber-400 text-black cursor-pointer shadow-sm transition disabled:opacity-50 inline-flex items-center gap-1.5 ${
          size === "sm" ? "px-2.5 py-1 text-[11px]" : "px-4 py-2 text-xs"
        }`}
      >
        {isCranking ? (
          <>
            <span className="w-3.5 h-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
            <span>{tLedger("cranking")}</span>
          </>
        ) : (
          <span>{tLedger("runCrank")}</span>
        )}
      </button>
    );
  }

  return (
    <span className="text-[10px] text-on-surface-variant/40">
      {tLedger("pending")}
    </span>
  );
}
