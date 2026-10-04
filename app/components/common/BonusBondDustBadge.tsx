"use client";

import React from "react";
import { formatCurrency } from "@/app/lib/formatters";
import { calculatePriorDustApplied } from "@/app/lib/draw-helpers";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { useTranslations } from "next-intl";

interface BonusBondDustBadgeProps {
  bondsBought: number;
  amountWon: number | bigint;
  bondPrice?: number | bigint;
  usedPriorDust?: number | bigint;
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
    typeof amountWon === "bigint" ? Number(amountWon) : amountWon,
    typeof bondPrice === "bigint" ? Number(bondPrice) : bondPrice,
    typeof usedPriorDust === "bigint" ? Number(usedPriorDust) : usedPriorDust
  );

  const formattedPriorDust = formatCurrency(priorDustApplied, {
    tokenSymbol,
    decimals: tokenDecimals,
  });

  return (
    <div
      data-prevent-row-click="true"
      className={`inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="text-[10px] text-tertiary font-mono whitespace-nowrap">
        {tInspector("bonusBondCount", { count: bondsBought })}
      </span>

      {priorDustApplied > 0 && (
        <InteractiveTooltip
          ariaLabel={tInspector("bonusDustAria", {
            bonds: bondsBought,
            amount: formattedPriorDust,
          })}
          align={tooltipAlign}
          side="top"
          triggerClassName="inline-flex items-center gap-0.5 border border-tertiary/30 bg-tertiary/15 px-1 py-0.5 text-[9px] font-semibold text-tertiary rounded cursor-help whitespace-nowrap hover:bg-tertiary/25 transition-colors p-0"
          content={
            <div className="space-y-0.5 text-start">
              <strong className="text-tertiary block mb-0.5 font-semibold">
                {tLedger("bonusTicket")}
              </strong>
              <p className="text-[10px] leading-normal text-on-surface-variant">
                {tInspector("bonusBondDustNotice", {
                  priorDust: formattedPriorDust,
                })}
              </p>
            </div>
          }
        >
          <span className="text-tertiary-bright font-bold">
            {tInspector("bonusBondWithDust")}
          </span>
        </InteractiveTooltip>
      )}
    </div>
  );
}
