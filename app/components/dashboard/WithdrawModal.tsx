"use client";

import { useState, useCallback, useRef } from "react";
import { useTranslations } from "next-intl";
import { formatCurrency, formatBalanceAmount } from "@/app/lib/formatters";
import type { PoolInfo, UserTicketInfo } from "@/app/types";
import { TransactionFeeSummary } from "./TransactionFeeSummary";
import { isInFlightStage } from "./TransactionProgressModal";
import { useTransactionRunner } from "@/app/hooks/useTransactionRunner";
import { AdaptiveModal } from "@/app/components/common/AdaptiveModal";
import { TransactionProgressView } from "./TransactionProgressView";

interface WithdrawModalProps {
  pool: PoolInfo;
  userTickets: UserTicketInfo;
  onClose: () => void;
  onWithdrawSuccess: (
    tickets: number,
    value: number,
    signature?: string
  ) => void;
  onWithdraw?: (amount: number) => Promise<string>;
}

export function WithdrawModal({
  pool,
  userTickets,
  onClose,
  onWithdrawSuccess,
  onWithdraw,
}: WithdrawModalProps) {
  const t = useTranslations("Modals");
  const tPools = useTranslations("Pools");
  const [ticketAmount, setTicketAmount] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const runner = useTransactionRunner();

  const isBusy = isInFlightStage(runner.stage);

  const handleModalClose = useCallback(() => {
    runner.reset();
    onClose();
  }, [runner, onClose]);

  const handleBackToForm = useCallback(() => {
    runner.reset();
    setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
  }, [runner]);

  const maxTickets =
    userTickets.activeTicketsCount + userTickets.pendingTicketsCount;
  const parsedTickets = parseInt(ticketAmount, 10) || 0;
  const withdrawValue = parsedTickets * pool.bondPrice;
  const bondBalanceFormatted = formatBalanceAmount(
    maxTickets * pool.bondPrice,
    {
      decimals: pool.tokenDecimals,
      tokenSymbol: pool.tokenSymbol,
    }
  );
  const canWithdraw =
    parsedTickets > 0 &&
    parsedTickets <= maxTickets &&
    runner.stage === null &&
    !pool.isFrozenForDraw &&
    pool.status !== "Paused";

  const handleWithdraw = useCallback(async () => {
    if (!canWithdraw) return;
    const txFn = onWithdraw
      ? () => onWithdraw(withdrawValue)
      : async () => {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          return undefined;
        };

    try {
      await runner.runTransaction(txFn, (sig) => {
        onWithdrawSuccess(parsedTickets, withdrawValue, sig);
      });
    } catch {
      // Error state captured by useTransactionRunner
    }
  }, [
    canWithdraw,
    onWithdraw,
    withdrawValue,
    runner,
    onWithdrawSuccess,
    parsedTickets,
  ]);

  return (
    <AdaptiveModal
      isOpen={true}
      onClose={handleModalClose}
      onBack={runner.stage === "error" ? handleBackToForm : undefined}
      title={t("withdrawTitle")}
      subtitle={tPools("initiateHumaRedemption")}
      titleIcon={
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-error/20 to-secondary/20">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-error"
          >
            <path d="M12 5v14M5 12l7 7 7-7" />
          </svg>
        </div>
      }
      size="sm"
      isBusy={isBusy}
      initialFocusRef={runner.stage === null ? inputRef : undefined}
    >
      {runner.stage !== null ? (
        <TransactionProgressView
          stage={runner.stage}
          showHeading={true}
          title={t("withdrawTitle")}
          customSuccessMessage={
            runner.stage === "success"
              ? t("withdrawSuccessDesc", {
                  bonds: parsedTickets,
                  amount: formatCurrency(withdrawValue, pool, {
                    style: "withSymbol",
                  }),
                })
              : undefined
          }
          error={runner.error}
          txSignature={runner.txSignature}
          onRetry={runner.retry}
          onClose={handleModalClose}
          onBack={handleBackToForm}
          backLabel={t("editAmount")}
        />
      ) : (
        <div className="space-y-4">
          {/* Frozen Alert */}
          {pool.isFrozenForDraw && (
            <div className="flex items-center gap-3 rounded-xl border border-tertiary/20 bg-tertiary/5 px-4 py-3">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-tertiary animate-spin"
              >
                <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-tertiary">
                  {tPools("drawInProgressTitle")}
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {tPools("drawInProgressWithdrawDesc")}
                </p>
              </div>
            </div>
          )}

          {/* Paused Alert */}
          {pool.status === "Paused" && !pool.isFrozenForDraw && (
            <div className="flex items-center gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <svg
                className="w-5 h-5 text-amber-400 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div>
                <p className="text-sm font-semibold text-amber-200">
                  {tPools("poolPausedTitle")}
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {tPools("poolPausedWithdrawDesc")}
                </p>
              </div>
            </div>
          )}

          {/* Closed Sunset Notice */}
          {pool.status === "Closed" && (
            <div className="flex items-center gap-3 rounded-xl border border-surface-container-highest bg-surface-container-high/80 px-4 py-3">
              <svg
                className="w-5 h-5 text-primary shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <div>
                <p className="text-sm font-semibold text-on-surface">
                  {tPools("poolClosedSunsetTitle")}
                </p>
                <p className="text-xs text-on-surface-variant mt-0.5">
                  {tPools("poolClosedSunsetDesc")}
                </p>
              </div>
            </div>
          )}

          {/* Current Balance */}
          <div className="rounded-xl bg-surface-container/60 px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-on-surface-variant">
              {t("availableBalance")}
            </span>
            <div className="text-right">
              <p
                className="font-display text-lg font-bold text-on-surface cursor-help"
                title={bondBalanceFormatted.fullWithCurrency}
              >
                {bondBalanceFormatted.displayWithCurrency}
              </p>
              <p className="text-[10px] text-on-surface-variant">
                {tPools("bondsBalanceSummary", {
                  count: maxTickets,
                  active: userTickets.activeTicketsCount,
                  pending: userTickets.pendingTicketsCount,
                })}
              </p>
            </div>
          </div>

          {/* Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-on-surface-variant">
                {t("ticketsLabel")}
              </label>
              <button
                onClick={() => setTicketAmount(String(maxTickets))}
                disabled={pool.isFrozenForDraw}
                className="text-[10px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("max")}: {maxTickets.toLocaleString("en-US")}
              </button>
            </div>
            <input
              ref={inputRef}
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              value={ticketAmount}
              onKeyDown={(e) => {
                if (["e", "E", "+", "-", ".", ","].includes(e.key)) {
                  e.preventDefault();
                }
              }}
              onChange={(e) => {
                const val = e.target.value
                  .split(".")[0]
                  .split(",")[0]
                  .replace(/[^0-9]/g, "");
                setTicketAmount(val);
              }}
              placeholder="0"
              min="0"
              max={maxTickets}
              step="1"
              disabled={pool.isFrozenForDraw}
              className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition disabled:opacity-40"
            />
          </div>

          {/* Async Warning / Info */}
          {parsedTickets > 0 && !pool.isFrozenForDraw && (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 mt-0.5 text-amber-400"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="16" x2="12" y2="12" />
                <line x1="12" y1="8" x2="12.01" y2="8" />
              </svg>
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-amber-300">
                  {tPools("asyncRedemptionTitle")}
                </p>
                <p className="text-[11px] text-amber-200/70 leading-normal">
                  {tPools("asyncRedemptionDesc")}
                </p>
              </div>
            </div>
          )}

          {/* Summary */}
          {parsedTickets > 0 && (
            <div className="space-y-2 rounded-xl bg-surface-container/40 px-4 py-3 text-xs">
              <div className="flex justify-between text-on-surface-variant">
                <span>{tPools("bondsToSell")}</span>
                <span className="font-semibold text-on-surface">
                  {parsedTickets}
                </span>
              </div>
              <div className="flex justify-between text-on-surface-variant">
                <span>{tPools("youReceive")}</span>
                <span className="font-mono font-semibold text-on-surface">
                  {formatCurrency(withdrawValue, pool, {
                    style: "withSymbol",
                  })}
                </span>
              </div>
              <div className="flex justify-between text-on-surface-variant">
                <span>{tPools("remainingBonds")}</span>
                <span className="font-mono text-on-surface">
                  {(maxTickets - parsedTickets).toLocaleString("en-US")}
                </span>
              </div>

              {/* Centralized Fee Summary */}
              <TransactionFeeSummary isFirstDeposit={false} />
            </div>
          )}

          {/* CTA */}
          <button
            onClick={handleWithdraw}
            disabled={!canWithdraw}
            className="w-full rounded-xl bg-error/95 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-error cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pool.isFrozenForDraw
              ? tPools("drawInProgress")
              : pool.status === "Paused"
                ? tPools("statusPaused")
                : pool.status === "Closed"
                  ? tPools("statusClosed")
                  : parsedTickets > maxTickets
                    ? t("exceedsBalance")
                    : parsedTickets > 0
                      ? t("confirmWithdrawAmount", {
                          amount: formatCurrency(withdrawValue, pool, {
                            style: "withSymbol",
                          }),
                        })
                      : t("enterAmount")}
          </button>
        </div>
      )}
    </AdaptiveModal>
  );
}
