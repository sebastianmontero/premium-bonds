"use client";

import React, { useState } from "react";
import type { DrawWinnerRecord, DrawDisplayConfig } from "@/app/types";
import {
  formatTokenAmount,
  tierLabel,
  tierBadgeClass,
  formatTicketNumber,
} from "@/app/lib/formatters";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "./TimelockTooltipContent";
import { WinnerCrankActionButton } from "./WinnerCrankActionButton";
import { usePayoutTimelock } from "@/app/hooks/usePayoutTimelock";
import {
  getEffectivePrizeBreakdown,
  formatWinnerShareMessage,
} from "@/app/lib/draw-helpers";
import { PrizeReinvestmentBreakdown } from "./PrizeReinvestmentBreakdown";
import { PrizeVerificationProofs } from "./PrizeVerificationProofs";
import { useTranslations } from "next-intl";

export interface DrawWinnerDetailViewProps {
  winner: DrawWinnerRecord;
  cycleId: number;
  revealedAt?: number;
  config?: DrawDisplayConfig;
  connectedUserAddress?: string;
  isClaimingPaused?: boolean;
  isVoided?: boolean;
  onBack: () => void;
  onCrank?: (winnerIndex: number, winnerAddress: string) => void;
  isCranking?: boolean;
}

export function DrawWinnerDetailView({
  winner,
  cycleId,
  revealedAt,
  config,
  connectedUserAddress,
  isClaimingPaused = false,
  isVoided = false,
  onBack,
  onCrank,
  isCranking = false,
}: DrawWinnerDetailViewProps) {
  const [copiedBond, setCopiedBond] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const t = useTranslations("DrawInspector");
  const tLedger = useTranslations("Ledger");

  const tokenDecimals = config?.tokenDecimals ?? 6;
  const tokenSymbol = config?.tokenSymbol ?? "USDC";
  const bondPrice = config?.bondPrice ?? 5_000_000;
  const payoutTimelockSeconds = config?.payoutTimelockSeconds ?? 300;

  const timelockState = usePayoutTimelock(revealedAt, payoutTimelockSeconds);

  const isConnectedWinner =
    !!connectedUserAddress &&
    winner.winnerAddress.toLowerCase() === connectedUserAddress.toLowerCase();

  const handleCopyBond = () => {
    if (winner.winningTicketIndex !== undefined) {
      navigator.clipboard.writeText(
        formatTicketNumber(winner.winningTicketIndex)
      );
      setCopiedBond(true);
      setTimeout(() => setCopiedBond(false), 2000);
    }
  };

  const handleShare = async () => {
    const text = formatWinnerShareMessage(
      cycleId,
      winner,
      tokenDecimals,
      tokenSymbol
    );
    try {
      await navigator.clipboard.writeText(text);
      setShareStatus(t("copiedShareLink"));
      setTimeout(() => setShareStatus(null), 3000);
    } catch {
      // Fallback
    }
  };

  const breakdown = getEffectivePrizeBreakdown(
    {
      amount: winner.amountOwed,
      bondsBought: winner.bondsBought,
      dustAccumulated: winner.dustAccumulated,
      status: winner.processed ? "reinvested" : "processing",
    },
    bondPrice
  );

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-y-auto pr-1">
      {/* Top Navigation & Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-surface-bright/5 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-xl bg-surface-container/60 hover:bg-surface-container border border-surface-bright/15 px-3 py-1.5 text-xs font-semibold text-on-surface transition cursor-pointer shadow-xs"
          >
            <svg
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            <span>{t("backToRegistry")}</span>
          </button>

          <div className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
            <span>{t("modalTitle", { cycleId })}</span>
            <span>&gt;</span>
            <span className="text-on-surface font-semibold">
              {t("winnerDetailBreadcrumb", {
                winnerIndex: winner.winnerIndex + 1,
              })}
            </span>
          </div>
        </div>

        {/* Winner Address Badge & Social Share */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-xl bg-surface-container/40 border border-surface-bright/10 px-3 py-1 text-xs">
            <span className="text-on-surface-variant text-[11px]">
              {t("winnerColumn")}:
            </span>
            <AccountExplorerLink
              address={winner.winnerAddress}
              provider="solscan"
              cluster="devnet"
            />
            {isConnectedWinner && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                <span aria-hidden="true">🎉</span> {t("youWonBadge")}
              </span>
            )}
          </div>

          {isConnectedWinner && (
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 px-3 py-1 text-xs font-semibold text-primary transition cursor-pointer"
            >
              <span>📢</span>
              <span>{shareStatus ?? t("shareWin")}</span>
            </button>
          )}
        </div>
      </div>

      {/* 4-Card Summary Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("tierColumn")}
          </p>
          <div className="mt-1">
            <span className={tierBadgeClass(winner.tierIndex)}>
              {tierLabel(winner.tierIndex)}
            </span>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("amountWonColumn")}
          </p>
          <p className="text-base sm:text-lg font-bold font-mono text-primary mt-0.5 truncate">
            {formatTokenAmount(winner.amountOwed, tokenDecimals)} {tokenSymbol}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-primary/[0.03] border border-primary/20 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-primary font-semibold">
              {t("winningBondColumn")}
            </p>
            {winner.winningTicketIndex !== undefined && (
              <button
                type="button"
                onClick={handleCopyBond}
                className="text-[10px] text-on-surface-variant hover:text-primary transition cursor-pointer"
              >
                {copiedBond ? t("copied") : t("copy")}
              </button>
            )}
          </div>
          <p className="text-base sm:text-lg font-bold font-mono text-primary mt-0.5 flex items-center gap-1.5 truncate">
            <span>🎫</span>
            <span>
              {winner.winningTicketIndex !== undefined
                ? formatTicketNumber(winner.winningTicketIndex)
                : "—"}
            </span>
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("statusColumn")}
          </p>
          <div className="mt-1">
            {isVoided ? (
              <span className="font-mono text-[10px] font-semibold text-red-400/80 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                {t("voidedPrizesNotice")}
              </span>
            ) : !winner.processed && timelockState.isTimelocked ? (
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
                status={winner.processed ? "reinvested" : "processing"}
                isCranking={isCranking}
                size="sm"
              />
            )}
          </div>
        </div>
      </div>

      {/* Timelock Banner (if applicable) */}
      {!winner.processed && timelockState.isTimelocked && (
        <div className="p-4 rounded-xl border border-amber-500/25 bg-amber-500/10 space-y-2 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-amber-300">
            <span className="flex items-center gap-1.5">
              <span>🔒</span> {t("timelockActiveTitle")}
            </span>
            <span className="font-mono bg-amber-500/20 border border-amber-500/30 px-2 py-0.5 rounded-md text-amber-200">
              {timelockState.formattedRemaining}
            </span>
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {t("timelockActiveDesc", {
              unlockTime: timelockState.formattedUnlockTime,
              remaining: timelockState.formattedRemaining,
            })}
          </p>
        </div>
      )}

      {/* Auto-Reinvestment Breakdown Card */}
      <div className="shrink-0">
        <PrizeReinvestmentBreakdown
          amountWon={winner.amountOwed}
          breakdown={breakdown}
          config={{
            tokenDecimals,
            tokenSymbol,
            bondPrice,
          }}
          isOwnPrize={isConnectedWinner}
          isProcessed={winner.processed}
        />
      </div>

      {/* Cryptographic Verification Proofs */}
      <div className="shrink-0">
        <PrizeVerificationProofs
          vrfSeed={winner.vrfSeedHex}
          txSignature={winner.claimSignature ?? undefined}
        />
      </div>

      {/* Action Trigger Row */}
      <div className="flex items-center justify-between pt-3 border-t border-surface-bright/5 shrink-0">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-4 py-2 transition cursor-pointer"
        >
          {t("backToRegistry")}
        </button>

        <WinnerCrankActionButton
          winnerIndex={winner.winnerIndex}
          winnerAddress={winner.winnerAddress}
          isProcessed={winner.processed}
          timelockState={timelockState}
          isClaimingPaused={isClaimingPaused}
          isVoided={isVoided}
          isCranking={isCranking}
          onCrank={onCrank}
          size="md"
        />
      </div>
    </div>
  );
}
