"use client";

import React, { memo } from "react";
import {
  getTierTheme,
  getLocalizedTierParts,
  type TierLabelFormat,
  type TierTranslationFn,
} from "@/app/lib/formatters";
import { useTranslations } from "next-intl";

export type TierBadgeSize = "xs" | "sm" | "md";

export interface TierBadgeProps {
  tierIndex: number;
  size?: TierBadgeSize;
  format?: TierLabelFormat;
  showIcon?: boolean;
  className?: string;
  t?: TierTranslationFn;
}

export const TIER_BADGE_SIZE_CLASSES: Record<
  TierBadgeSize,
  { badge: string; icon: string }
> = {
  xs: {
    badge: "px-2 py-0.5 text-[10px] gap-1",
    icon: "w-3 text-[10px]",
  },
  sm: {
    badge: "px-2.5 py-0.5 text-xs gap-1.5",
    icon: "w-3.5 text-xs",
  },
  md: {
    badge: "px-3 py-1 text-sm gap-2",
    icon: "w-4 text-sm",
  },
};

export const TierBadge = memo(function TierBadge({
  tierIndex,
  size = "sm",
  format = "rank",
  showIcon = true,
  className = "",
  t: customT,
}: TierBadgeProps) {
  const contextT = useTranslations("Common.tiers");
  const t: TierTranslationFn = customT ?? ((k, v) => contextT(k, v));

  const theme = getTierTheme(tierIndex);
  const parts = getLocalizedTierParts(tierIndex, t);
  const sizeConfig =
    TIER_BADGE_SIZE_CLASSES[size] ?? TIER_BADGE_SIZE_CLASSES.sm;

  const displayLabel = (() => {
    switch (format) {
      case "full":
        return parts.compound;
      case "title":
      case "short":
        return parts.title ?? parts.rank;
      case "rank":
      case "tierOnly":
      default:
        return parts.rank;
    }
  })();

  const isTier1 = tierIndex === 0;

  return (
    <span
      className={`inline-flex items-center rounded-full border font-semibold whitespace-nowrap select-none ${theme.badgeStyles} ${sizeConfig.badge} ${className}`}
      title={isTier1 && format === "rank" ? parts.title : undefined}
    >
      {showIcon && (
        <span
          aria-hidden="true"
          className={`${sizeConfig.icon} text-center shrink-0 flex items-center justify-center leading-none`}
        >
          {theme.icon}
        </span>
      )}
      <span>{displayLabel}</span>
      {format === "rank" && isTier1 && parts.title && (
        <span className="sr-only"> ({parts.title})</span>
      )}
    </span>
  );
});
