"use client";

import React, { useEffect, useRef } from "react";
import type { PrizeHistoryEntry } from "@/app/types";
import {
  formatCurrency,
  formatLocalDate,
  formatTicketNumber,
} from "@/app/lib/formatters";
import { TierBadge } from "@/app/components/common/TierBadge";
import { usePayoutTimelock } from "@/app/hooks/usePayoutTimelock";
import { useClipboard } from "@/app/hooks/useClipboard";
import { CopyButton } from "@/app/components/common/CopyButton";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "@/app/components/draws/TimelockTooltipContent";
import { resolvePrizeBreakdown } from "@/app/lib/draw-helpers";
import { PrizeReinvestmentBreakdown } from "@/app/components/draws/PrizeReinvestmentBreakdown";
import { PrizeVerificationProofs } from "@/app/components/draws/PrizeVerificationProofs";
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
    >
      {/* Hero Prize Summary Card */}
      <div className="p-3.5 sm:p-4 rounded-xl bg-surface-container/20 border border-surface-bright/10 shrink-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Tier */}
          <div className="flex flex-col justify-between min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
              {t("tierWon")}
            </p>
            <div className="mt-1">
              <TierBadge tierIndex={entry.tierIndex} size="md" />
            </div>
          </div>

          {/* Amount Won */}
          <div className="flex flex-col justify-between min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
              {t("amountWon")}
            </p>
            <p
              className={`text-base sm:text-lg font-bold font-mono mt-0.5 truncate ${
                isVoided
                  ? "line-through text-on-surface-variant/60"
                  : "text-primary"
              }`}
            >
              {formatCurrency(entry.amount, {
                tokenSymbol,
                decimals: tokenDecimals,
              })}
            </p>
          </div>

          {/* Winning Bond */}
          <div className="flex flex-col justify-between min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
              {t("winningTicket")}
            </p>
            <div className="mt-0.5 flex items-center gap-1.5 min-w-0">
              <p className="text-base sm:text-lg font-bold font-mono text-on-surface flex items-center gap-1.5 truncate">
                <span aria-hidden="true">🎫</span>
                <span>
                  {entry.winningTicket !== undefined &&
                  entry.winningTicket !== null
                    ? formatTicketNumber(entry.winningTicket)
                    : "—"}
                </span>
              </p>
              {entry.winningTicket !== undefined &&
                entry.winningTicket !== null && (
                  <CopyButton
                    text={formatTicketNumber(entry.winningTicket)}
                    ariaLabel={`${t("copy")} ${t("winningTicket")}`}
                  />
                )}
            </div>
          </div>

          {/* Verification Status */}
          <div className="flex flex-col justify-between min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
              {t("verificationStatus")}
            </p>
            <div className="mt-1">
              {isVoided ? (
                <span className="font-mono text-[10px] font-semibold text-red-400 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 inline-block">
                  {tLedger("prizesRevoked")}
                </span>
              ) : crankingCycles[
                  `${entry.drawCycleId}-${entry.winnerIndex}`
                ] ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300 animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-spin" />
                  {tLedger("cranking")}
                </span>
              ) : entry.status === "reinvested" ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {tLedger("reinvested")}
                </span>
              ) : timelockState.isTimelocked ? (
                <InteractiveTooltip
                  ariaLabel={tLedger("timelocked")}
                  align="center"
                  side="top"
                  triggerClassName="inline-flex p-0"
                  panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                  content={<TimelockTooltipContent timelock={timelockState} />}
                >
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300 cursor-help">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
                    🔒 {tLedger("timelocked")}
                  </span>
                </InteractiveTooltip>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {tLedger("processing")}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

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
          isOwnPrize={true}
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

      {/* Social Share Card (rendered strictly when not voided) */}
      {!isVoided && (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-3.5 rounded-xl border border-primary/10 bg-primary/[0.02] gap-3 shrink-0">
          <div className="space-y-0.5">
            <h5 className="text-xs font-semibold text-on-surface flex items-center gap-1.5 uppercase tracking-wider">
              <svg
                className="w-4 h-4 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                />
              </svg>
              {t("braggingRights")}
            </h5>
            <p className="text-xs text-on-surface-variant">
              {t("braggingSubtitle")}
            </p>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={handleShare}
              className="w-full sm:w-auto flex items-center justify-center gap-1.5 rounded-xl bg-primary hover:bg-primary-hover text-surface-container font-semibold text-xs px-4 py-2 transition cursor-pointer"
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
                  d="M8.684 10.742l4.632-2.316m0 4.632l-4.632-2.316M12 10.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm7.5-6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-7.5 12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
                />
              </svg>
              {t("shareWin")}
            </button>

            {isShareCopied && (
              <div className="absolute right-0 top-full mt-1.5 z-10 whitespace-nowrap bg-emerald-500 text-surface-container text-[10px] font-bold px-2 py-0.5 rounded shadow-lg">
                {tLedger("shareTemplateCopied")}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Action Row */}
      <div className="flex items-center justify-end gap-3 pt-3 border-t border-surface-bright/5 shrink-0">
        <button
          ref={closeButtonRef}
          type="button"
          onClick={handleClose}
          className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-4 py-2 transition cursor-pointer"
        >
          {t("close")}
        </button>

        {!isVoided &&
          entry.status === "processing" &&
          (timelockState.isTimelocked ? (
            <InteractiveTooltip
              ariaLabel={`Crank locked: ${tLedger("timelockTooltip", { remaining: timelockState.formattedRemaining })}`}
              align="right"
              side="top"
              triggerClassName="inline-flex p-0"
              panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
              content={<TimelockTooltipContent timelock={timelockState} />}
            >
              <span
                aria-disabled="true"
                className="flex items-center gap-1.5 rounded-xl font-semibold text-xs px-4 py-2 bg-surface-container/60 border border-amber-500/20 text-amber-300/80 cursor-not-allowed opacity-80 shadow-xs shrink-0"
              >
                <span aria-hidden="true">🔒</span> {tLedger("timelocked")} (
                {timelockState.formattedRemaining})
              </span>
            </InteractiveTooltip>
          ) : effectivePool?.isFrozenForDraw ? (
            <InteractiveTooltip
              ariaLabel={tLedger("frozenCrankTooltip")}
              align="right"
              side="top"
              triggerClassName="inline-flex"
              panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
              content={
                <p className="text-xs leading-relaxed text-amber-200">
                  {tLedger("frozenCrankTooltip")}
                </p>
              }
            >
              <span
                aria-disabled="true"
                className="flex items-center gap-1.5 rounded-xl font-semibold text-xs px-4 py-2 bg-surface-container/60 border border-amber-500/20 text-amber-300/60 cursor-not-allowed opacity-80 shadow-xs shrink-0"
              >
                <span aria-hidden="true">⏸️</span> {tLedger("frozenDrawStatus")}
              </span>
            </InteractiveTooltip>
          ) : (
            <button
              type="button"
              disabled={
                !!crankingCycles[`${entry.drawCycleId}-${entry.winnerIndex}`]
              }
              onClick={() =>
                onSimulateCrank(entry.drawCycleId, entry.winnerIndex)
              }
              className={`flex items-center gap-1.5 rounded-xl font-semibold text-xs px-4 py-2 transition shrink-0 ${
                crankingCycles[`${entry.drawCycleId}-${entry.winnerIndex}`]
                  ? "bg-surface-bright/10 text-on-surface-variant/40 cursor-not-allowed border border-surface-bright/5"
                  : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black cursor-pointer shadow-[0_4px_14px_rgba(245,158,11,0.25)]"
              }`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`animate-spin ${
                  crankingCycles[`${entry.drawCycleId}-${entry.winnerIndex}`]
                    ? "duration-1000 text-on-surface-variant/40"
                    : "duration-3000"
                }`}
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
              </svg>
              {crankingCycles[`${entry.drawCycleId}-${entry.winnerIndex}`]
                ? tLedger("cranking")
                : tLedger("runCrank")}
            </button>
          ))}
      </div>
    </AdaptiveModal>
  );
}
