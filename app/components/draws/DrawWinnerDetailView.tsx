"use client";

import React from "react";
import type { DrawWinnerRecord, DrawDisplayConfig } from "@/app/types";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import { WinnerCrankActionButton } from "./WinnerCrankActionButton";
import { usePayoutTimelock } from "@/app/hooks/usePayoutTimelock";
import { useClipboard } from "@/app/hooks/useClipboard";
import {
  resolvePrizeBreakdown,
  formatWinnerShareMessage,
} from "@/app/lib/draw-helpers";
import { PrizeHeroCard } from "./PrizeHeroCard";
import { PrizeReinvestmentBreakdown } from "./PrizeReinvestmentBreakdown";
import { PrizeVerificationProofs } from "./PrizeVerificationProofs";
import { useTranslations } from "next-intl";

export interface DrawWinnerDetailViewProps {
  winner: DrawWinnerRecord;
  cycleId: number;
  revealedAt?: number;
  config?: DrawDisplayConfig;
  connectedUserAddress?: string;
  unclaimedDust?: number;
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
  unclaimedDust,
  isClaimingPaused = false,
  isVoided = false,
  onBack,
  onCrank,
  isCranking = false,
}: DrawWinnerDetailViewProps) {
  const { copied: isShareCopied, copy: copyShare } = useClipboard({
    timeoutMs: 3000,
  });
  const t = useTranslations("DrawInspector");
  const tCommon = useTranslations("Common.aria");

  const tokenDecimals = config?.tokenDecimals ?? 6;
  const tokenSymbol = config?.tokenSymbol ?? "USDC";
  const bondPrice = config?.bondPrice ?? 5_000_000;
  const payoutTimelockSeconds = config?.payoutTimelockSeconds ?? 300;

  const timelockState = usePayoutTimelock(revealedAt, payoutTimelockSeconds);

  const isConnectedWinner =
    !!connectedUserAddress &&
    winner.winnerAddress.toLowerCase() === connectedUserAddress.toLowerCase();

  const handleShare = async () => {
    const text = formatWinnerShareMessage(
      cycleId,
      winner,
      tokenDecimals,
      tokenSymbol
    );
    await copyShare(text);
  };

  const breakdown = resolvePrizeBreakdown({
    amountWon: winner.amountOwed,
    status: winner.processed ? "reinvested" : "processing",
    bondsBought: winner.bondsBought,
    dustAccumulated: winner.dustAccumulated,
    bondPrice,
    unclaimedDust: isConnectedWinner ? (unclaimedDust ?? 0) : 0,
  });

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-3 overflow-y-auto pr-1">
      {/* Top Navigation & Breadcrumb Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-2.5 border-b border-surface-bright/5 shrink-0">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 rounded-xl bg-surface-container/60 hover:bg-surface-container border border-surface-bright/15 px-3 py-1.5 text-xs font-semibold text-on-surface transition cursor-pointer shadow-xs"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
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

          <nav
            aria-label={tCommon("breadcrumb")}
            className="flex items-center gap-1.5 text-xs text-on-surface-variant font-medium"
          >
            <button
              type="button"
              onClick={onBack}
              className="hover:text-on-surface transition cursor-pointer"
            >
              {t("modalTitle", { cycleId })}
            </button>
            <span aria-hidden="true">&gt;</span>
            <span className="text-on-surface font-semibold" aria-current="page">
              {t("winnerDetailBreadcrumb", {
                winnerIndex: winner.winnerIndex + 1,
              })}
            </span>
          </nav>
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
            {!isVoided && isConnectedWinner && (
              <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                <span aria-hidden="true">🎉</span> {t("youWonBadge")}
              </span>
            )}
          </div>

          {!isVoided && isConnectedWinner && (
            <button
              type="button"
              onClick={handleShare}
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/30 px-3 py-1 text-xs font-semibold text-primary transition cursor-pointer"
            >
              <span aria-hidden="true">📢</span>
              <span>
                {isShareCopied ? t("copiedShareLink") : t("shareWin")}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Hero Prize Header Card */}
      <PrizeHeroCard
        tierIndex={winner.tierIndex}
        amountWon={winner.amountOwed}
        tokenSymbol={tokenSymbol}
        tokenDecimals={tokenDecimals}
        winningTicket={winner.winningTicketIndex}
        isProcessed={winner.processed}
        isVoided={isVoided}
        isCranking={isCranking}
        timelockState={timelockState}
      />

      {/* Voided Audit Notice (rendered ONLY when isVoided is true) */}
      {isVoided && (
        <div className="p-3.5 rounded-xl border border-red-500/25 bg-red-500/10 space-y-1.5 shrink-0">
          <div className="flex items-center gap-2 text-xs font-bold text-red-400">
            <span aria-hidden="true">🛑</span>
            <span>{t("voidedBannerTitle")}</span>
          </div>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            {t("voidedBannerDesc")}
          </p>
        </div>
      )}

      {/* Timelock Banner (rendered ONLY when NOT voided and actively timelocked) */}
      {!isVoided && !winner.processed && timelockState.isTimelocked && (
        <div className="p-3.5 rounded-xl border border-amber-500/25 bg-amber-500/10 space-y-1.5 shrink-0">
          <div className="flex items-center justify-between text-xs font-bold text-amber-300">
            <span className="flex items-center gap-1.5">
              <span aria-hidden="true">🔒</span> {t("timelockActiveTitle")}
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

      {/* Auto-Reinvestment Breakdown / Receipt */}
      <div className="shrink-0">
        <PrizeReinvestmentBreakdown
          amountWon={winner.amountOwed}
          breakdown={breakdown}
          config={{
            tokenDecimals,
            tokenSymbol,
            bondPrice,
          }}
          isProcessed={winner.processed}
          isVoided={isVoided}
        />
      </div>

      {/* Cryptographic Verification Proofs */}
      <div className="shrink-0">
        <PrizeVerificationProofs
          vrfSeed={winner.vrfSeedHex}
          txSignature={winner.claimSignature ?? undefined}
          isVoided={isVoided}
        />
      </div>

      {/* Action Trigger Row (only rendered when crank action is pending) */}
      {!isVoided && !winner.processed && (
        <div className="flex items-center justify-end pt-2 border-t border-surface-bright/5 shrink-0">
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
      )}
    </div>
  );
}
