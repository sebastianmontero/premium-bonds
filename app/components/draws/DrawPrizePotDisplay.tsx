"use client";

import React from "react";
import { formatCurrency, formatTokenBalance } from "@/app/lib/formatters";
import { getDrawPrizePotPresentation } from "@/app/lib/draw-helpers";
import type { DrawStatusName } from "@/app/types";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { useTranslations } from "next-intl";

export interface DrawPrizePotBadgeProps {
  status: DrawStatusName | string;
  prizePot?: number | bigint;
  className?: string;
}

export function DrawPrizePotBadge({
  status,
  prizePot,
  className = "",
}: DrawPrizePotBadgeProps) {
  const t = useTranslations("DrawHistory");
  const presentation = getDrawPrizePotPresentation(status);

  if (!presentation.badgeVariant || !presentation.badgeKey) return null;
  if (prizePot !== undefined && BigInt(prizePot ?? 0) <= 0n) return null;

  const isRolledOver = presentation.badgeVariant === "rolled_over";
  const badgeClasses = isRolledOver
    ? "bg-amber-500/15 border-amber-500/30 text-amber-300"
    : "bg-rose-500/15 border-rose-500/30 text-rose-300";

  const badgeText = t(presentation.badgeKey);
  const tooltipText = presentation.tooltipKey ? t(presentation.tooltipKey) : "";

  return (
    <InteractiveTooltip
      ariaLabel={`${badgeText}: ${tooltipText}`}
      content={tooltipText}
      triggerClassName="p-0 border-0 bg-transparent inline-flex items-center shrink-0"
    >
      <span
        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold border cursor-help leading-none shrink-0 ${badgeClasses} ${className}`}
      >
        {badgeText}
      </span>
    </InteractiveTooltip>
  );
}

export interface DrawPrizePotDisplayProps {
  draw: {
    status: DrawStatusName | string;
    prizePot: number | bigint;
  };
  tokenSymbol?: string;
  tokenDecimals?: number;
  layout?: "inline-right" | "wrap" | "amount-only";
  className?: string;
}

export function DrawPrizePotDisplay({
  draw,
  tokenSymbol = "USDC",
  tokenDecimals = 6,
  layout = "inline-right",
  className = "",
}: DrawPrizePotDisplayProps) {
  const t = useTranslations("DrawHistory");
  const presentation = getDrawPrizePotPresentation(draw.status);
  const potBigInt = BigInt(draw.prizePot ?? 0);
  const hasPot = potBigInt > 0n;

  const formattedAmount = formatCurrency(draw.prizePot, {
    tokenSymbol,
    decimals: tokenDecimals,
  });

  const balanceInfo = formatTokenBalance(draw.prizePot, {
    tokenSymbol,
    decimals: tokenDecimals,
  });
  const titleAttr = balanceInfo.isBelowThreshold
    ? balanceInfo.fullWithSymbol
    : undefined;

  // If pot is 0 or not rolled back, render standard numeric text
  if (!hasPot || !presentation.isStrikethrough) {
    return (
      <span className={`font-mono ${className}`} title={titleAttr}>
        {formattedAmount}
      </span>
    );
  }

  const badgeText = presentation.badgeKey ? t(presentation.badgeKey) : "";
  const reasonText = presentation.tooltipKey ? t(presentation.tooltipKey) : "";

  const amountNode = (
    <s
      className="line-through text-on-surface-variant font-bold tabular-nums"
      title={titleAttr}
    >
      {formattedAmount}
    </s>
  );

  const screenReaderNotice = (
    <span className="sr-only">
      {t("srUnawardedPot", {
        amount: formattedAmount,
        status: badgeText,
        reason: reasonText,
      })}
    </span>
  );

  if (layout === "amount-only") {
    return (
      <span className={className}>
        <span aria-hidden="true">{amountNode}</span>
        {screenReaderNotice}
      </span>
    );
  }

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${
        layout === "inline-right" ? "justify-end" : "flex-wrap justify-start"
      } ${className}`}
    >
      <DrawPrizePotBadge status={draw.status} prizePot={draw.prizePot} />
      <span aria-hidden="true">{amountNode}</span>
      {screenReaderNotice}
    </div>
  );
}
