"use client";

import React from "react";
import type { ReinvestmentBreakdown } from "@/app/lib/draw-helpers";
import type { DrawDisplayConfig } from "@/app/types";
import { formatTokenAmount } from "@/app/lib/formatters";
import { useTranslations } from "next-intl";

export interface PrizeReinvestmentBreakdownProps {
  amountWon: number;
  breakdown: ReinvestmentBreakdown;
  config: Pick<
    DrawDisplayConfig,
    "tokenDecimals" | "tokenSymbol" | "bondPrice"
  >;
  isOwnPrize?: boolean;
  isProcessed?: boolean;
}

export function PrizeReinvestmentBreakdown({
  amountWon,
  breakdown,
  config,
  isOwnPrize = false,
  isProcessed = true,
}: PrizeReinvestmentBreakdownProps) {
  const t = useTranslations("PrizeDetails");
  const tokenDecimals = config.tokenDecimals ?? 6;
  const tokenSymbol = config.tokenSymbol ?? "USDC";
  const ticketPrice = config.bondPrice ?? 5_000_000;

  return (
    <div className="p-4 sm:p-5 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.02] space-y-3">
      <h4 className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
        <svg
          className="w-4 h-4 shrink-0"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
          <polyline points="21 3 21 8 16 8" />
        </svg>
        {isProcessed
          ? t("autoReinvestmentBreakdown")
          : t("estimatedReinvestmentTitle")}
      </h4>

      {/* Cards Grid */}
      <div className="grid grid-cols-1 xs:grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
        <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
          <p className="text-on-surface-variant font-medium">
            {t("reinvestedTickets")}
          </p>
          <p className="font-mono text-base font-bold text-on-surface mt-1">
            +{breakdown.bondsBought.toLocaleString("en-US")}{" "}
            {t("bondsUnit", { count: breakdown.bondsBought })}
          </p>
        </div>
        <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
          <p className="text-on-surface-variant font-medium">
            {t("purchaseCost")}
          </p>
          <p className="font-mono text-base font-bold text-on-surface mt-1">
            {formatTokenAmount(ticketPrice, tokenDecimals)} {tokenSymbol} / bond
          </p>
        </div>
        <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
          <p className="text-on-surface-variant font-medium">
            {t("targetPool")}
          </p>
          <p className="font-mono text-base font-bold text-on-surface mt-1">
            {t("solanaYieldPool")}
          </p>
        </div>
      </div>

      {/* Breakdown Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs mt-2">
        <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
          <p className="text-on-surface-variant font-medium">
            {t("drawWinnings")}
          </p>
          <p className="font-mono text-sm font-bold text-on-surface mt-1">
            {formatTokenAmount(amountWon, tokenDecimals)} {tokenSymbol}
          </p>
        </div>
        <div className="bg-surface-container/10 p-3 rounded-lg border border-tertiary/20 bg-tertiary/5">
          <p className="text-tertiary font-medium">{t("priorDustApplied")}</p>
          <p className="font-mono text-sm font-bold text-tertiary mt-1">
            +{formatTokenAmount(breakdown.usedPriorDust, tokenDecimals)}{" "}
            {tokenSymbol}
          </p>
        </div>
        <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
          <p className="text-on-surface-variant font-medium">
            {t("totalReinvested")}
          </p>
          <p className="font-mono text-sm font-bold text-primary mt-1">
            {formatTokenAmount(
              breakdown.bondsBought * ticketPrice,
              tokenDecimals
            )}{" "}
            {tokenSymbol}
          </p>
        </div>
        <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
          <p className="text-on-surface-variant font-medium">
            {t("dustRemainder")}
          </p>
          <p className="font-mono text-sm font-bold text-on-surface mt-1">
            {formatTokenAmount(breakdown.dustAccumulated, tokenDecimals)}{" "}
            {tokenSymbol}
          </p>
        </div>
      </div>

      {/* Bonus Ticket Banner */}
      {breakdown.usedPriorDust > 0 && (
        <div
          className="flex items-start gap-2.5 p-3 rounded-xl border border-tertiary/20 bg-tertiary/5 text-xs text-on-surface mt-3"
          aria-label="Bonus bond unlocked notification"
        >
          <span className="text-base leading-none">✨</span>
          <div className="space-y-0.5">
            <p className="font-semibold text-tertiary">
              {t("bonusTicketTitle")}
            </p>
            <p className="text-on-surface-variant text-[11px] leading-relaxed">
              {t("bonusTicketDesc", {
                priorDust: formatTokenAmount(
                  breakdown.usedPriorDust,
                  tokenDecimals
                ),
                winnings: formatTokenAmount(amountWon, tokenDecimals),
                symbol: tokenSymbol,
              })}
            </p>
          </div>
        </div>
      )}

      {/* Explanatory Note */}
      <p className="text-xs text-on-surface-variant leading-relaxed mt-3">
        {isProcessed
          ? isOwnPrize
            ? t("reinvestedNote")
            : t("publicReinvestedNote")
          : t("estimatedReinvestmentDesc")}
      </p>
    </div>
  );
}
