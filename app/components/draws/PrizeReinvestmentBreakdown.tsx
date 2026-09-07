"use client";

import React from "react";
import type { ReinvestmentBreakdown } from "@/app/lib/draw-helpers";
import type { DrawDisplayConfig } from "@/app/types";
import { formatTokenAmount } from "@/app/lib/formatters";
import { useTranslations, useFormatter } from "next-intl";

export interface PrizeReinvestmentBreakdownProps {
  amountWon: number;
  breakdown: ReinvestmentBreakdown;
  config: Pick<
    DrawDisplayConfig,
    "tokenDecimals" | "tokenSymbol" | "bondPrice"
  >;
  isOwnPrize?: boolean;
  isProcessed?: boolean;
  isVoided?: boolean;
}

export function PrizeReinvestmentBreakdown({
  amountWon,
  breakdown,
  config,
  isOwnPrize = false,
  isProcessed = true,
  isVoided = false,
}: PrizeReinvestmentBreakdownProps) {
  const t = useTranslations("PrizeDetails");
  const format = useFormatter();
  const tokenDecimals = config.tokenDecimals ?? 6;
  const tokenSymbol = config.tokenSymbol ?? "USDC";
  const bondPrice = config.bondPrice ?? 5_000_000;

  if (isVoided) {
    return (
      <div className="p-4 rounded-xl border border-red-500/20 bg-red-500/[0.03] space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-red-400 flex items-center gap-1.5 uppercase tracking-wider">
            <svg
              className="w-4 h-4 shrink-0 text-red-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
            {t("revokedPrizeTitle")}
          </h4>
          <span className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-surface-container/60 border border-surface-bright/10 text-on-surface-variant">
            {t("solanaYieldPool")}
          </span>
        </div>

        <div className="rounded-xl border border-surface-bright/5 bg-surface-container/20 p-3 space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-on-surface-variant">
              {t("grossWinnings")}
            </span>
            <span className="font-mono text-on-surface-variant/60 line-through font-semibold">
              {formatTokenAmount(amountWon, tokenDecimals)} {tokenSymbol}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-on-surface-variant">{t("bondsIssued")}</span>
            <span className="font-mono font-semibold text-on-surface">
              +0 {t("bondsUnit", { count: 0 })}
            </span>
          </div>
          <div className="border-t border-surface-bright/10 pt-2 flex items-center justify-between">
            <span className="text-red-400/90 font-medium">
              {t("yieldReturnedToReserves")}
            </span>
            <span className="font-mono font-bold text-red-400">
              {formatTokenAmount(amountWon, tokenDecimals)} {tokenSymbol}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 pt-0.5">
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-semibold">
            <span aria-hidden="true">🛡️</span> {t("principalIntactNotice")}
          </span>
        </div>
      </div>
    );
  }

  const totalReinvestedAmount = breakdown.bondsBought * bondPrice;

  return (
    <div className="p-4 rounded-xl border border-emerald-500/15 bg-emerald-500/[0.02] space-y-3">
      {/* Header & Target Pool Pill */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5 uppercase tracking-wider">
          <svg
            className="w-4 h-4 shrink-0 text-emerald-400"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <polyline points="21 3 21 8 16 8" />
          </svg>
          {isProcessed
            ? t("autoReinvestmentBreakdown")
            : t("estimatedReinvestmentTitle")}
        </h4>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-on-surface-variant bg-surface-container/60 border border-surface-bright/10 px-2.5 py-0.5 rounded-lg">
          <span className="text-on-surface font-semibold">
            {t("solanaYieldPool")}
          </span>
          <span>•</span>
          <span>
            {formatTokenAmount(bondPrice, tokenDecimals)} {tokenSymbol} / bond
          </span>
        </div>
      </div>

      {/* Financial Settlement Ledger */}
      <div className="rounded-xl border border-surface-bright/5 bg-surface-container/20 p-3 space-y-2 text-xs">
        {/* Line 1: Gross Winnings */}
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant font-medium">
            {t("grossWinnings")}
          </span>
          <span className="font-mono font-bold text-on-surface">
            {formatTokenAmount(amountWon, tokenDecimals)} {tokenSymbol}
          </span>
        </div>

        {/* Line 2: Prior Dust (Rendered strictly when > 0) */}
        {breakdown.usedPriorDust > 0 && (
          <div className="flex items-center justify-between text-tertiary">
            <span className="font-medium flex items-center gap-1">
              <span aria-hidden="true">✨</span> {t("priorDustApplied")}
            </span>
            <span className="font-mono font-bold">
              +{formatTokenAmount(breakdown.usedPriorDust, tokenDecimals)}{" "}
              {tokenSymbol}
            </span>
          </div>
        )}

        {/* Line 3: Compound Reinvestment */}
        <div className="flex items-center justify-between">
          <span className="text-on-surface-variant font-medium flex items-center gap-1.5">
            <span>{t("reinvestedInBonds")}</span>
            <span className="inline-flex items-center rounded-md bg-primary/10 border border-primary/20 px-1.5 py-0.2 text-[10px] font-mono font-bold text-primary">
              +{format.number(breakdown.bondsBought)}{" "}
              {t("bondsUnit", { count: breakdown.bondsBought })}
            </span>
          </span>
          <span className="font-mono font-bold text-primary">
            -{formatTokenAmount(totalReinvestedAmount, tokenDecimals)}{" "}
            {tokenSymbol}
          </span>
        </div>

        {/* Divider */}
        <div className="border-t border-surface-bright/10 pt-1.5 flex items-center justify-between">
          <div className="space-y-0.5">
            <span className="text-on-surface font-semibold block">
              {t("netDustRemainder")}
            </span>
            <span className="text-[10px] text-on-surface-variant block">
              {t("claimableRemainderNote")}
            </span>
          </div>
          <span className="font-mono text-sm font-bold text-emerald-400">
            +{formatTokenAmount(breakdown.dustAccumulated, tokenDecimals)}{" "}
            {tokenSymbol}
          </span>
        </div>
      </div>

      {/* Bonus Ticket Banner (if dust consolidated) */}
      {breakdown.usedPriorDust > 0 && (
        <div
          role="status"
          aria-live="polite"
          className="flex items-start gap-2 p-2.5 rounded-xl border border-tertiary/20 bg-tertiary/5 text-xs text-on-surface"
        >
          <span className="text-base leading-none" aria-hidden="true">
            ✨
          </span>
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

      {/* Explanatory Subtext */}
      <p className="text-[11px] text-on-surface-variant leading-relaxed">
        {isProcessed
          ? isOwnPrize
            ? t("reinvestedNote")
            : t("publicReinvestedNote")
          : t("estimatedReinvestmentDesc")}
      </p>
    </div>
  );
}
