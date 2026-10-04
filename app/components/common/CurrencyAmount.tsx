"use client";

import React from "react";
import {
  formatTokenBalance,
  type FormatTokenBalanceOptions,
  type CurrencyTokenInfo,
} from "@/app/lib/formatters";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";

export interface CurrencyAmountProps {
  amount: bigint | number | string | null | undefined;
  pool?: CurrencyTokenInfo | null;
  options?: FormatTokenBalanceOptions;
  showTooltip?: boolean;
  className?: string;
  amountClassName?: string;
}

/**
 * Reusable, mobile-accessible amount display component pairing truncated
 * display amounts ($9.99, < $0.01) with accessible, portaled full-precision tooltips (9.996000 USDC).
 */
export function CurrencyAmount({
  amount,
  pool,
  options,
  showTooltip = true,
  className = "",
  amountClassName = "",
}: CurrencyAmountProps) {
  const result = formatTokenBalance(amount, pool, options);

  // If tooltip is disabled or value is zero/fallback, render plain span
  if (!showTooltip || result.isZero || result.rawBaseUnits === 0n) {
    return (
      <span
        className={`inline-flex items-center font-mono ${className} ${amountClassName}`}
      >
        {result.formatted}
      </span>
    );
  }

  const ariaLabel = `${result.formatted} (${result.fullWithSymbol})`;

  return (
    <span className={`inline-flex items-center ${className}`}>
      <InteractiveTooltip
        ariaLabel={ariaLabel}
        triggerClassName={`inline-flex items-center font-mono cursor-help p-0 -my-1 py-1 -mx-0.5 px-0.5 touch-manipulation hover:text-primary transition-colors ${amountClassName}`}
        content={
          <div className="space-y-0.5 text-left">
            <p className="font-semibold text-primary text-xs">
              {result.fullWithSymbol}
            </p>
            {result.isBelowThreshold && (
              <p className="text-[11px] text-on-surface-variant">
                Sub-cent dust automatically rolls over into subsequent draws.
              </p>
            )}
          </div>
        }
      >
        <span className="border-b border-dotted border-current/40 hover:border-primary">
          {result.formatted}
        </span>
      </InteractiveTooltip>
    </span>
  );
}
