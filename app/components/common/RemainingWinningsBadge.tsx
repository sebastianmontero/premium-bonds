"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { useTranslations } from "next-intl";

export interface RemainingWinningsBadgeProps {
  /** Unbonded winnings amount in base units */
  amount: number;
  tokenDecimals?: number;
  tokenSymbol?: string;
  bondPrice?: number;
  tooltipAlign?: "left" | "center" | "right";
  className?: string;
}

/**
 * Reusable badge for displaying unbonded remaining winnings with an accessible hover/focus popover.
 */
export function RemainingWinningsBadge({
  amount,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  bondPrice = 5_000_000,
  tooltipAlign = "center",
  className = "",
}: RemainingWinningsBadgeProps) {
  const t = useTranslations("Ledger");

  if (amount <= 0) return null;

  const alignClass =
    tooltipAlign === "left"
      ? "left-0"
      : tooltipAlign === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  const formattedBondPrice = formatTokenAmount(bondPrice, tokenDecimals);
  const formattedAmount = formatTokenAmount(amount, tokenDecimals);

  return (
    <div
      data-prevent-row-click="true"
      className={`relative group/remaining shrink-0 inline-flex items-center ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <span className="inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant/40 px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant rounded-md cursor-help whitespace-nowrap">
        ${formattedAmount} {t("remainingBadgeLabel")}
      </span>
      <div
        role="tooltip"
        className={`absolute bottom-full ${alignClass} mb-2 w-56 max-w-[calc(100vw-32px)] p-2.5 rounded-xl bg-[#0F111A] border border-surface-bright/10 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/remaining:opacity-100 group-focus-within/remaining:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-center whitespace-normal`}
      >
        <strong className="text-tertiary block mb-0.5">
          {t("remainingWinningsTitle")}
        </strong>
        {t("remainingWinningsDesc", {
          bondPrice: formattedBondPrice,
          symbol: tokenSymbol,
        })}
      </div>
    </div>
  );
}
