"use client";

import React from "react";
import { formatCurrency } from "@/app/lib/formatters";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { useTranslations } from "next-intl";

export interface RemainingWinningsBadgeProps {
  /** Unbonded winnings amount in base units */
  amount: number | bigint;
  tokenDecimals?: number;
  tokenSymbol?: string;
  bondPrice?: number | bigint;
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

  const numAmount = typeof amount === "bigint" ? Number(amount) : amount;
  if (numAmount <= 0) return null;

  const formattedBondPrice = formatCurrency(bondPrice, {
    tokenSymbol,
    decimals: tokenDecimals,
  });
  const formattedAmount = formatCurrency(amount, {
    tokenSymbol,
    decimals: tokenDecimals,
  });

  return (
    <div
      data-prevent-row-click="true"
      className={`shrink-0 inline-flex items-center ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <InteractiveTooltip
        ariaLabel={t("remainingWinningsTitle")}
        align={tooltipAlign}
        side="top"
        triggerClassName="inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant/40 px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant rounded-md cursor-help whitespace-nowrap hover:bg-surface-variant/60 transition-colors p-0"
        content={
          <div className="space-y-0.5 text-left">
            <strong className="text-tertiary block mb-0.5 font-semibold">
              {t("remainingWinningsTitle")}
            </strong>
            <p className="text-[11px] leading-normal text-on-surface-variant">
              {t("remainingWinningsDesc", {
                bondPrice: formattedBondPrice,
              })}
            </p>
          </div>
        }
      >
        <span>
          {formattedAmount} {t("remainingBadgeLabel")}
        </span>
      </InteractiveTooltip>
    </div>
  );
}
