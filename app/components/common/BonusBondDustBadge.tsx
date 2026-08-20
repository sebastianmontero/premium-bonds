"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { calculatePriorDustApplied } from "@/app/lib/draw-helpers";
import { useTranslations } from "next-intl";

interface BonusBondDustBadgeProps {
  bondsBought: number;
  amountWon: number;
  bondPrice?: number;
  usedPriorDust?: number;
  tokenDecimals?: number;
  tokenSymbol?: string;
  className?: string;
  tooltipAlign?: "left" | "center" | "right";
}

export function BonusBondDustBadge({
  bondsBought,
  amountWon,
  bondPrice = 5_000_000,
  usedPriorDust,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  className = "",
  tooltipAlign = "right",
}: BonusBondDustBadgeProps) {
  const tLedger = useTranslations("Ledger");
  const tInspector = useTranslations("DrawInspector");

  if (bondsBought <= 0) return null;

  const priorDustApplied = calculatePriorDustApplied(
    bondsBought,
    amountWon,
    bondPrice,
    usedPriorDust
  );

  const alignClass =
    tooltipAlign === "left"
      ? "left-0"
      : tooltipAlign === "center"
        ? "left-1/2 -translate-x-1/2"
        : "right-0";

  return (
    <div
      data-prevent-row-click="true"
      className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] text-tertiary font-mono whitespace-nowrap">
        +{bondsBought} {bondsBought === 1 ? "bond" : "bonds"}
      </span>

      {priorDustApplied > 0 && (
        <div className="relative group/priorDust shrink-0 inline-flex items-center">
          <span
            className="inline-flex items-center gap-0.5 border border-tertiary/30 bg-tertiary/15 px-1 py-0.5 text-[9px] font-semibold text-tertiary rounded cursor-help whitespace-nowrap"
            title={`+${formatTokenAmount(priorDustApplied, tokenDecimals)} ${tokenSymbol} prior remaining balance used`}
            aria-label={`Reinvested ${bondsBought} bonds using ${formatTokenAmount(priorDustApplied, tokenDecimals)} ${tokenSymbol} prior remaining balance`}
          >
            <span className="text-tertiary-bright font-bold">
              {tInspector("bonusBondWithDust")}
            </span>
          </span>

          <div
            className={`absolute bottom-full ${alignClass} mb-2 w-56 max-w-[calc(100vw-32px)] p-2.5 rounded-lg bg-[#0F111A] border border-tertiary/20 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/priorDust:opacity-100 group-focus/priorDust:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-left whitespace-normal`}
          >
            <strong className="text-tertiary block mb-0.5">
              {tLedger("bonusTicket")}
            </strong>
            {tInspector("bonusBondDustNotice", {
              priorDust: formatTokenAmount(priorDustApplied, tokenDecimals),
              symbol: tokenSymbol,
            })}
          </div>
        </div>
      )}
    </div>
  );
}
