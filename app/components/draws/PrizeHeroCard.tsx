"use client";

import React from "react";
import {
  formatCurrency,
  formatTicketNumber,
  sanitizeTicketNumber,
} from "@/app/lib/formatters";
import { TierBadge } from "@/app/components/common/TierBadge";
import { CopyButton } from "@/app/components/common/CopyButton";
import {
  StatusBadge,
  type AnyStatus,
} from "@/app/components/common/StatusBadge";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "./TimelockTooltipContent";
import type { PayoutTimelockState } from "@/app/hooks/usePayoutTimelock";
import { useTranslations } from "next-intl";

export interface PrizeHeroCardProps {
  tierIndex: number;
  amountWon: number;
  tokenSymbol?: string;
  tokenDecimals?: number;
  winningTicket?: number | string | null;
  isProcessed: boolean;
  isVoided?: boolean;
  isCranking?: boolean;
  timelockState?: PayoutTimelockState;
  className?: string;
}

export function PrizeHeroCard({
  tierIndex,
  amountWon,
  tokenSymbol = "USDC",
  tokenDecimals = 6,
  winningTicket,
  isProcessed,
  isVoided = false,
  isCranking = false,
  timelockState,
  className = "",
}: PrizeHeroCardProps) {
  const t = useTranslations("PrizeDetails");
  const tLedger = useTranslations("Ledger");

  const hasWinningTicket =
    winningTicket !== undefined && winningTicket !== null;
  const formattedTicket = hasWinningTicket
    ? formatTicketNumber(winningTicket)
    : "—";
  const cleanTicketValue = hasWinningTicket
    ? sanitizeTicketNumber(winningTicket)
    : "";
  const formattedAmount = formatCurrency(amountWon, {
    tokenSymbol,
    decimals: tokenDecimals,
  });

  const isTimelocked =
    !isVoided && !isProcessed && !!timelockState?.isTimelocked;
  const resolvedStatus: AnyStatus = isVoided
    ? "Voided"
    : isProcessed
      ? "reinvested"
      : isTimelocked
        ? "timelocked"
        : "processing";

  return (
    <div
      className={`@container p-3.5 @xs:p-4 rounded-xl bg-surface-container/20 border border-surface-bright/10 space-y-3 shrink-0 ${className}`}
    >
      {/* Top Financial & Status Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        {/* Amount Won + Tier Badge with SR Announcement */}
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="sr-only">{t("amountWon")}: </span>
          <span
            className={`text-xl @xs:text-2xl font-bold font-mono tracking-tight ${
              isVoided
                ? "line-through text-on-surface-variant/60"
                : "text-primary"
            }`}
          >
            {formattedAmount}
          </span>
          <TierBadge tierIndex={tierIndex} size="md" />
        </div>

        {/* Status Badge with Timelock Tooltip */}
        <div className="shrink-0" role="status" aria-live="polite">
          {isTimelocked && timelockState ? (
            <InteractiveTooltip
              ariaLabel={tLedger("timelocked")}
              align="center"
              side="top"
              triggerClassName="inline-flex p-0"
              panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
              content={<TimelockTooltipContent timelock={timelockState} />}
            >
              <StatusBadge
                status="timelocked"
                isCranking={isCranking}
                size="sm"
                className="cursor-help"
              />
            </InteractiveTooltip>
          ) : (
            <StatusBadge
              status={resolvedStatus}
              isCranking={isCranking}
              size="sm"
              labelOverride={isVoided ? tLedger("prizesRevoked") : undefined}
            />
          )}
        </div>
      </div>

      {/* Full-Width Winning Bond Ribbon */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-surface-container-lowest/60 border border-surface-bright/5 min-w-0">
        <span className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold shrink-0">
          {t("winningTicket")}
        </span>
        <div className="flex items-center gap-2 min-w-0 font-mono">
          <div className="flex items-center gap-1.5 min-w-0">
            <span aria-hidden="true" className="shrink-0">
              🎫
            </span>
            <span className="text-sm @xs:text-base font-bold text-on-surface truncate min-w-0">
              {hasWinningTicket ? formattedTicket : "—"}
            </span>
          </div>
          {hasWinningTicket && (
            <CopyButton
              text={cleanTicketValue}
              ariaLabel={`${t("copy")} ${t("winningTicket")} ${formattedTicket}`}
              className="p-1.5 hover:text-primary transition shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center cursor-pointer"
              iconClassName="w-3.5 h-3.5"
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Ergonomic Alias
export const WinnerHeroCard = PrizeHeroCard;
