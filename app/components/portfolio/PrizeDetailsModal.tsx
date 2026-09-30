"use client";

import React, { useEffect, useRef } from "react";
import type { PrizeHistoryEntry } from "@/app/types";
import {
  formatCurrency,
  formatLocalDate,
  formatTicketNumber,
} from "@/app/lib/formatters";
import { usePayoutTimelock } from "@/app/hooks/usePayoutTimelock";
import { useClipboard } from "@/app/hooks/useClipboard";
import { resolvePrizeBreakdown } from "@/app/lib/draw-helpers";
import { PrizeHeroCard } from "@/app/components/draws/PrizeHeroCard";
import { PrizeReinvestmentBreakdown } from "@/app/components/draws/PrizeReinvestmentBreakdown";
import { PrizeVerificationProofs } from "@/app/components/draws/PrizeVerificationProofs";
import { WinnerCrankActionButton } from "@/app/components/draws/WinnerCrankActionButton";
import { useTranslations, useFormatter } from "next-intl";
import { AdaptiveModal } from "@/app/components/common/AdaptiveModal";

export interface PrizeDetailsModalProps {
  entry: PrizeHistoryEntry | null;
  isOpen: boolean;
  onClose: () => void;
  tokenDecimals: number;
  tokenSymbol: string;
  ticketPrice?: number;
  bondPrice?: number;
  payoutTimelockSeconds?: number;
  unclaimedDust?: number;
  pool?: { isFrozenForDraw?: boolean; status?: string } | null;
  isFrozenForDraw?: boolean;
  onSimulateCrank: (drawCycleId: number, winnerIndex: number) => void;
  crankingCycles?: Record<string, boolean>;
}

export default function PrizeDetailsModal({
  entry,
  isOpen,
  onClose,
  tokenDecimals,
  tokenSymbol,
  ticketPrice,
  bondPrice = 5_000_000,
  payoutTimelockSeconds = 300,
  unclaimedDust,
  pool,
  isFrozenForDraw,
  onSimulateCrank,
  crankingCycles = {},
}: PrizeDetailsModalProps) {
  const { copied: isShareCopied, copy: copyShare } = useClipboard({
    timeoutMs: 3000,
  });

  const t = useTranslations("PrizeDetails");
  const tLedger = useTranslations("Ledger");
  const format = useFormatter();

  const effectiveBondPrice = ticketPrice ?? bondPrice;
  const effectivePool =
    pool ?? (isFrozenForDraw !== undefined ? { isFrozenForDraw } : null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const timelockState = usePayoutTimelock(
    entry?.revealedAt,
    payoutTimelockSeconds
  );

  const isVoided = (entry?.status as string) === "voided";
  const isCranking = Boolean(
    entry && crankingCycles[`${entry.drawCycleId}-${entry.winnerIndex}`]
  );

  // Focus retention: When status transitions to reinvested and the crank button unmounts, retain focus inside modal
  useEffect(() => {
    if (!isOpen || !entry) return;
    if (entry.status === "reinvested") {
      closeButtonRef.current?.focus();
    }
  }, [isOpen, entry]);

  if (!isOpen || !entry) return null;

  const handleClose = () => {
    onClose();
  };

  const handleShare = async () => {
    const text = tLedger("shareTemplateText", {
      cycleId: entry.drawCycleId,
      amount: formatCurrency(entry.amount, {
        tokenSymbol,
        decimals: tokenDecimals,
      }),
    });
    await copyShare(text);
  };

  const formattedDate = formatLocalDate(
    entry.date,
    { month: "long", day: "numeric", year: "numeric" },
    format.dateTime
  );

  const hasWinningTicket =
    entry.winningTicket !== undefined && entry.winningTicket !== null;
  const formattedTicket = hasWinningTicket
    ? formatTicketNumber(entry.winningTicket)
    : "";
  const modalTitle = hasWinningTicket
    ? t("title", {
        drawCycleId: entry.drawCycleId,
        ticket: formattedTicket,
      })
    : t("titleNoTicket", { drawCycleId: entry.drawCycleId });

  const breakdown = resolvePrizeBreakdown({
    amountWon: entry.amount,
    status: entry.status,
    bondsBought: entry.bondsBought,
    usedPriorDust: entry.usedPriorDust,
    dustAccumulated: entry.dustAccumulated,
    bondPrice: effectiveBondPrice,
    unclaimedDust: unclaimedDust ?? 0,
    isClosed:
      (effectivePool as { status?: string } | null)?.status === "Closed",
  });

  return (
    <AdaptiveModal
      isOpen={isOpen}
      onClose={handleClose}
      title={modalTitle}
      subtitle={t("conductedOn", { date: formattedDate })}
      titleIcon={
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
          <svg
            className="w-5 h-5 text-primary shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
            />
          </svg>
        </div>
      }
      size="md"
      zIndex="z-[60]"
      bodyClassName="space-y-4"
      footer={
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5 sm:gap-3 w-full">
          {!isVoided ? (
            <div className="relative">
              <button
                type="button"
                onClick={handleShare}
                className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 text-primary font-semibold text-xs px-4 py-2 min-h-[44px] sm:min-h-0 transition cursor-pointer"
              >
                <span aria-hidden="true">✨</span>
                <span>{t("shareWin")}</span>
              </button>
              {isShareCopied && (
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute left-1/2 -translate-x-1/2 bottom-full mb-1.5 z-10 whitespace-nowrap bg-emerald-500 text-surface-container text-[10px] font-bold px-2 py-0.5 rounded shadow-lg"
                >
                  {tLedger("shareTemplateCopied")}
                </div>
              )}
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center justify-end gap-2.5 sm:gap-3">
            <button
              ref={closeButtonRef}
              type="button"
              onClick={handleClose}
              className="flex-1 sm:flex-none justify-center rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-4 py-2 min-h-[44px] sm:min-h-0 transition cursor-pointer flex items-center"
            >
              {t("close")}
            </button>
            <WinnerCrankActionButton
              winnerIndex={entry.winnerIndex}
              isProcessed={entry.status === "reinvested"}
              timelockState={timelockState}
              isClaimingPaused={effectivePool?.isFrozenForDraw}
              isVoided={isVoided}
              isCranking={isCranking}
              onCrank={() =>
                onSimulateCrank(entry.drawCycleId, entry.winnerIndex)
              }
              size="md"
            />
          </div>
        </div>
      }
    >
      {/* Hero Prize Summary Card */}
      <PrizeHeroCard
        tierIndex={entry.tierIndex}
        amountWon={entry.amount}
        tokenSymbol={tokenSymbol}
        tokenDecimals={tokenDecimals}
        winningTicket={entry.winningTicket}
        isProcessed={entry.status === "reinvested"}
        isVoided={isVoided}
        isCranking={isCranking}
        timelockState={timelockState}
      />

      {/* Timelock Security Notice when processing (strictly when not voided) */}
      {!isVoided &&
        entry.status === "processing" &&
        timelockState.isTimelocked && (
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

      {/* Auto-Reinvestment Receipt / Projected Ledger (rendered in all states!) */}
      <div className="shrink-0">
        <PrizeReinvestmentBreakdown
          amountWon={entry.amount}
          breakdown={breakdown}
          config={{
            tokenDecimals,
            tokenSymbol,
            bondPrice: effectiveBondPrice,
          }}
          isProcessed={entry.status === "reinvested"}
          isVoided={isVoided}
        />
      </div>

      {/* Cryptographic Verification Proofs */}
      <div className="shrink-0">
        <PrizeVerificationProofs
          vrfSeed={entry.vrfSeed}
          txSignature={entry.txSignature}
          isVoided={isVoided}
        />
      </div>
    </AdaptiveModal>
  );
}
