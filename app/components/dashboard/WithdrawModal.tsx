"use client";

import { useState, useCallback } from "react";
import { useTranslations } from "next-intl";
import { formatTokenAmount } from "@/app/lib/formatters";
import type { PoolInfo, UserTicketInfo } from "@/app/types";
import {
  parseTransactionError,
  ParsedTransactionError,
} from "@/app/lib/errors";
import { SolanaErrorAlert } from "@/app/components/SolanaErrorAlert";
import { TransactionFeeSummary } from "./TransactionFeeSummary";
import {
  TransactionProgressModal,
  TransactionStage,
} from "./TransactionProgressModal";

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
  const [ticketAmount, setTicketAmount] = useState("");
  const [stage, setStage] = useState<TransactionStage>(null);
  const [parsedError, setParsedError] = useState<ParsedTransactionError | null>(
    null
  );
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const maxTickets =
    userTickets.activeTicketsCount + userTickets.pendingTicketsCount;
  const parsedTickets = parseInt(ticketAmount, 10) || 0;
  const withdrawValue = parsedTickets * pool.bondPrice;
  const canWithdraw =
    parsedTickets > 0 && parsedTickets <= maxTickets && !pool.isFrozenForDraw;

  const handleWithdraw = useCallback(async () => {
    if (!canWithdraw) return;
    setStage("signing");
    setParsedError(null);
    setTxSignature(null);

    try {
      let capturedSig: string | undefined;
      if (onWithdraw) {
        const sig = await onWithdraw(withdrawValue);
        if (sig) {
          capturedSig = sig;
          setTxSignature(sig);
        }
        setStage("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setStage("success");
      } else {
        // Simulate wallet signature
        await new Promise((resolve) => setTimeout(resolve, 1200));
        setStage("confirming");

        // Simulate blockchain transaction confirmation
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setStage("success");
      }
      onWithdrawSuccess(parsedTickets, withdrawValue, capturedSig);
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Withdraw transaction cancelled by user.");
      } else {
        console.error("Withdraw transaction failed:", err);
      }
      setParsedError(parsed);
      setStage(null);
    }
  }, [
    canWithdraw,
    withdrawValue,
    onWithdraw,
    parsedTickets,
    onWithdrawSuccess,
  ]);

  const handleModalClose = useCallback(() => {
    setStage(null);
    onClose();
  }, [onClose]);

  if (stage !== null) {
    return (
      <TransactionProgressModal
        isOpen={stage !== null}
        stage={stage}
        customSuccessMessage={
          stage === "success"
            ? `Your ${parsedTickets.toLocaleString("en-US")} bonds have been burned. Redemption request for ${formatTokenAmount(withdrawValue, pool.tokenDecimals)} ${pool.tokenSymbol} is now pending settlement.`
            : undefined
        }
        txSignature={txSignature}
        onClose={handleModalClose}
      />
    );
  }

  return (
    <div className="modal-backdrop animate-fade-in" onClick={handleModalClose}>
      <div
        className="w-full max-w-md rounded-2xl glass-strong p-6 space-y-5 shadow-ambient mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-error/20 to-secondary/20">
              <svg
                width="20"
                height="20"
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
            <div>
              <h2 className="font-display text-lg font-bold text-on-surface">
                {t("withdrawTitle")}
              </h2>
              <p className="text-xs text-on-surface-variant">
                Initiate Huma redemption to sell bonds
              </p>
            </div>
          </div>
          <button
            onClick={handleModalClose}
            className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-highest transition cursor-pointer"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Error Alert */}
        {parsedError && (
          <SolanaErrorAlert
            error={parsedError}
            onDismiss={() => setParsedError(null)}
            onRetry={canWithdraw ? handleWithdraw : undefined}
          />
        )}

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
                Draw in progress!
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                The pool is temporarily frozen to pick winners. Please check
                back in a few minutes.
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
            <p className="font-display text-lg font-bold text-on-surface">
              {formatTokenAmount(
                maxTickets * pool.bondPrice,
                pool.tokenDecimals
              )}{" "}
              {pool.tokenSymbol}
            </p>
            <p className="text-[10px] text-on-surface-variant">
              {maxTickets.toLocaleString("en-US")} bonds (
              {userTickets.activeTicketsCount} active ·{" "}
              {userTickets.pendingTicketsCount} pending)
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
                Asynchronous Redemption
              </p>
              <p className="text-[11px] text-amber-200/70 leading-normal">
                Withdrawing initiates a Huma Finance redemption request. This
                process is asynchronous. Once requested, your tickets are burned
                immediately, and your funds will settle. You will need to claim
                the settled USDC from the pending redemptions panel once
                complete.
              </p>
            </div>
          </div>
        )}

        {/* Summary */}
        {parsedTickets > 0 && (
          <div className="space-y-2 rounded-xl bg-surface-container/40 px-4 py-3 text-xs">
            <div className="flex justify-between text-on-surface-variant">
              <span>Tickets to sell</span>
              <span className="font-semibold text-on-surface">
                {parsedTickets}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>You receive</span>
              <span className="font-mono font-semibold text-on-surface">
                {formatTokenAmount(withdrawValue, pool.tokenDecimals)}{" "}
                {pool.tokenSymbol}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Remaining tickets</span>
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
            ? "Pool Frozen — Try Later"
            : parsedTickets > maxTickets
              ? "Exceeds Balance"
              : parsedTickets > 0
                ? `Request Withdrawal — ${formatTokenAmount(withdrawValue, pool.tokenDecimals)} ${pool.tokenSymbol}`
                : t("enterAmount")}
        </button>
      </div>
    </div>
  );
}
