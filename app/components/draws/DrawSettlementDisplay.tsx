"use client";

import React from "react";
import { formatCurrency, formatTokenBalance } from "@/app/lib/formatters";
import {
  getDrawSettlementPresentation,
  type DrawSettlementMetricType,
} from "@/app/lib/draw-helpers";
import type { DrawStatusName } from "@/app/types";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { useTranslations } from "next-intl";

export interface DrawSettlementBadgeProps {
  status: DrawStatusName | string;
  amount?: number | bigint;
  metricType?: DrawSettlementMetricType;
  className?: string;
}

export function DrawSettlementBadge({
  status,
  amount,
  metricType = "pot",
  className = "",
}: DrawSettlementBadgeProps) {
  const t = useTranslations("DrawHistory");
  const presentation = getDrawSettlementPresentation(status, metricType);

  if (!presentation.badgeVariant || !presentation.badgeKey) return null;
  const numAmount = Math.trunc(Number(amount ?? 0));
  if (amount !== undefined && BigInt(numAmount) <= 0n) return null;

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

export interface DrawSettlementDisplayProps {
  amount: number | bigint;
  status: DrawStatusName | string;
  metricType?: DrawSettlementMetricType;
  tokenSymbol?: string;
  tokenDecimals?: number;
  layout?: "inline-right" | "wrap" | "amount-only";
  badgePlacement?: "before" | "after";
  className?: string;
  amountClassName?: string;
}

export function DrawSettlementDisplay({
  amount,
  status,
  metricType = "pot",
  tokenSymbol = "USDC",
  tokenDecimals = 6,
  layout = "inline-right",
  badgePlacement = "before",
  className = "",
  amountClassName = "",
}: DrawSettlementDisplayProps) {
  const t = useTranslations("DrawHistory");
  const presentation = getDrawSettlementPresentation(status, metricType);
  const numAmount = Math.trunc(Number(amount ?? 0));
  const hasAmount = BigInt(numAmount) > 0n;

  const formattedAmount = formatCurrency(amount, {
    tokenSymbol,
    decimals: tokenDecimals,
  });

  const balanceInfo = formatTokenBalance(amount, {
    tokenSymbol,
    decimals: tokenDecimals,
  });
  const titleAttr = balanceInfo.isBelowThreshold
    ? balanceInfo.fullWithSymbol
    : undefined;

  // If amount is 0 or not rolled back, render standard numeric text
  if (!hasAmount || !presentation.isStrikethrough) {
    return (
      <span
        className={`font-mono ${amountClassName || className}`}
        title={titleAttr}
      >
        {formattedAmount}
      </span>
    );
  }

  const badgeText = presentation.badgeKey ? t(presentation.badgeKey) : "";
  const reasonText = presentation.tooltipKey ? t(presentation.tooltipKey) : "";
  const srKey =
    presentation.srKey ??
    (metricType === "fee" ? "srUnawardedFee" : "srUnawardedPot");

  const amountNode = (
    <s
      className={`line-through text-on-surface-variant font-bold tabular-nums ${amountClassName}`}
      title={titleAttr}
    >
      {formattedAmount}
    </s>
  );

  const screenReaderNotice = (
    <span className="sr-only">
      {t(srKey, {
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

  const badgeNode = (
    <DrawSettlementBadge
      status={status}
      amount={amount}
      metricType={metricType}
    />
  );

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${
        layout === "inline-right" ? "justify-end" : "flex-wrap justify-start"
      } ${className}`}
    >
      {badgePlacement === "before" && badgeNode}
      <span aria-hidden="true">{amountNode}</span>
      {badgePlacement === "after" && badgeNode}
      {screenReaderNotice}
    </div>
  );
}

// Ergonomic wrappers:
export interface DrawPrizePotDisplayProps extends Omit<
  DrawSettlementDisplayProps,
  "amount" | "status" | "metricType"
> {
  draw?: {
    status: DrawStatusName | string;
    prizePot: number | bigint;
  };
  amount?: number | bigint;
  status?: DrawStatusName | string;
}

export function DrawPrizePotDisplay({
  draw,
  amount,
  status,
  ...props
}: DrawPrizePotDisplayProps) {
  const resolvedAmount = amount ?? draw?.prizePot ?? 0;
  const resolvedStatus = status ?? draw?.status ?? "";
  return (
    <DrawSettlementDisplay
      amount={resolvedAmount}
      status={resolvedStatus}
      metricType="pot"
      {...props}
    />
  );
}

export interface DrawFeeDisplayProps extends Omit<
  DrawSettlementDisplayProps,
  "amount" | "metricType"
> {
  fee: number | bigint;
}

export function DrawFeeDisplay({ fee, status, ...props }: DrawFeeDisplayProps) {
  return (
    <DrawSettlementDisplay
      amount={fee}
      status={status}
      metricType="fee"
      {...props}
    />
  );
}

export type DrawPrizePotBadgeProps = DrawSettlementBadgeProps;
export type DrawFeeBadgeProps = DrawSettlementBadgeProps;

export {
  DrawSettlementBadge as DrawPrizePotBadge,
  DrawSettlementBadge as DrawFeeBadge,
};
