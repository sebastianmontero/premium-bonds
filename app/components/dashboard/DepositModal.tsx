"use client";

import { useState, useCallback } from "react";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { formatTokenAmount } from "@/app/lib/formatters";
import type { PoolInfo } from "@/app/types";
import {
  parseTransactionError,
  ParsedTransactionError,
} from "@/app/lib/errors";
import { SolanaErrorAlert } from "@/app/components/SolanaErrorAlert";
import { useTranslations } from "next-intl";
import { TransactionFeeSummary } from "./TransactionFeeSummary";
import {
  TransactionProgressModal,
  TransactionStage,
} from "./TransactionProgressModal";

interface DepositModalProps {
  pool: PoolInfo;
  walletBalance: number; // base units
  isFirstDeposit?: boolean;
  onClose: () => void;
  onDepositSuccess: (tickets: number, cost: number, signature?: string) => void;
  onDeposit?: (tickets: number) => Promise<string>;
}

export function DepositModal({
  pool,
  walletBalance,
  isFirstDeposit = true,
  onClose,
  onDepositSuccess,
  onDeposit,
}: DepositModalProps) {
  const t = useTranslations("Modals");
  const [inputValue, setInputValue] = useState("");
  const [activeInput, setActiveInput] = useState<"token" | "ticket">("token");
  const [txStage, setTxStage] = useState<TransactionStage>(null);
  const [parsedError, setParsedError] = useState<ParsedTransactionError | null>(
    null
  );
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const bondPriceHuman = pool.bondPrice / 10 ** pool.tokenDecimals;

  // Derive both values from the single source of truth
  let tokenDisplay = "";
  let ticketDisplay = "";
  let parsedTickets = 0;

  if (activeInput === "token") {
    tokenDisplay = inputValue;
    const val = parseFloat(inputValue);
    if (!isNaN(val) && val > 0) {
      parsedTickets = Math.floor(val / bondPriceHuman);
      ticketDisplay = String(parsedTickets);
    }
  } else {
    ticketDisplay = inputValue;
    const val = parseInt(inputValue, 10);
    if (!isNaN(val) && val > 0) {
      parsedTickets = val;
      tokenDisplay = String(val * bondPriceHuman);
    }
  }

  const totalCostBase = parsedTickets * pool.bondPrice;
  const canDeposit =
    parsedTickets > 0 &&
    totalCostBase <= walletBalance &&
    txStage === null &&
    !pool.isFrozenForDraw &&
    pool.status === "Active";

  const handleDeposit = useCallback(async () => {
    setTxStage("signing");
    setParsedError(null);
    setTxSignature(null);
    let capturedSig: string | undefined;
    try {
      if (onDeposit) {
        const sig = await onDeposit(parsedTickets);
        if (sig) {
          capturedSig = sig;
          setTxSignature(sig);
        }
        setTxStage("broadcasting");
        await new Promise((resolve) => setTimeout(resolve, 800));
        setTxStage("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setTxStage("success");
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        setTxStage("broadcasting");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setTxStage("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setTxStage("success");
      }
      onDepositSuccess(parsedTickets, totalCostBase, capturedSig);
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Deposit transaction cancelled by user.");
      } else {
        console.error(
          `Deposit transaction failed: ${parsed.message || parsed.title}`,
          err
        );
      }
      setParsedError(parsed);
      setTxStage(null);
    }
  }, [parsedTickets, totalCostBase, onDepositSuccess, onDeposit]);

  const handleModalClose = useCallback(() => {
    setTxStage(null);
    onClose();
  }, [onClose]);

  if (txStage !== null) {
    return (
      <TransactionProgressModal
        isOpen={txStage !== null}
        stage={txStage}
        customSuccessMessage={
          txStage === "success"
            ? `Successfully purchased ${parsedTickets.toLocaleString("en-US")} bonds for ${formatTokenAmount(totalCostBase, pool.tokenDecimals)} ${pool.tokenSymbol}!`
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
        className="w-full max-w-md rounded-2xl glass-strong p-6 space-y-5 shadow-ambient mx-4 relative overflow-hidden animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20">
              <span className="font-display text-base font-bold text-primary">
                {pool.tokenSymbol.charAt(0)}
              </span>
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-on-surface">
                {t("depositHeader", { symbol: pool.tokenSymbol })}
              </h2>
              <p className="text-xs text-on-surface-variant">
                {t("poolName", { symbol: pool.tokenSymbol })}
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
            onRetry={canDeposit ? handleDeposit : undefined}
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
                The pool is temporarily frozen to pick winners. Deposits are
                paused until the draw completes.
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
                Pool is paused
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Deposits are temporarily halted while the emergency pause is
                active.
              </p>
            </div>
          </div>
        )}

        {/* Closed Alert */}
        {pool.status === "Closed" && (
          <div className="flex items-center gap-3 rounded-xl border border-surface-container-highest bg-surface-container-high/80 px-4 py-3">
            <svg
              className="w-5 h-5 text-on-surface-variant shrink-0"
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
                Pool is closed
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                This pool is permanently closed. New bond deposits are disabled.
              </p>
            </div>
          </div>
        )}

        {/* ── Current Prize Pot ───────────────────────────────────────── */}
        <div className="rounded-xl bg-surface-container/60 px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-on-surface-variant">
            {t("currentPrizePot")}
          </span>
          <LiveYieldTicker
            pool={pool}
            showBadge={false}
            valueClassName="font-display text-lg font-bold text-gradient"
          />
        </div>

        {/* ── Dual Input ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Token amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-on-surface-variant">
                {t("amountLabel", { symbol: pool.tokenSymbol })}
              </label>
              <button
                type="button"
                disabled={pool.isFrozenForDraw}
                onClick={() => {
                  const maxTokens = walletBalance / 10 ** pool.tokenDecimals;
                  setActiveInput("token");
                  setInputValue(
                    String(
                      Math.floor(maxTokens / bondPriceHuman) * bondPriceHuman
                    )
                  );
                }}
                className="text-[10px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {t("max")}:{" "}
                {formatTokenAmount(walletBalance, pool.tokenDecimals)}
              </button>
            </div>
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              value={tokenDisplay}
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
                setActiveInput("token");
                setInputValue(val);
              }}
              disabled={pool.isFrozenForDraw}
              placeholder="0"
              min="0"
              step="1"
              className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </div>

          {/* Swap indicator */}
          <div className="flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-highest border border-outline-variant/20">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-on-surface-variant"
              >
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
          </div>

          {/* Ticket amount */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-on-surface-variant">
              {t("ticketsLabel")}
            </label>
            <input
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              value={ticketDisplay}
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
                setActiveInput("ticket");
                setInputValue(val);
              }}
              disabled={pool.isFrozenForDraw}
              placeholder="0"
              min="0"
              step="1"
              className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition disabled:opacity-40 disabled:cursor-not-allowed"
            />
          </div>
        </div>

        {/* ── Summary ────────────────────────────────────────────────── */}
        {parsedTickets > 0 && (
          <div className="space-y-2 rounded-xl bg-surface-container/40 px-4 py-3 text-xs">
            <div className="flex justify-between items-center text-on-surface-variant">
              <span>{t("ticketsReceived")}</span>
              <span
                key={parsedTickets > 0 ? parsedTickets : "zero"}
                className={`font-semibold text-on-surface ${parsedTickets > 0 ? "text-primary animate-scale-pop" : ""}`}
              >
                {parsedTickets.toLocaleString("en-US")}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>{t("bondPriceLabel")}</span>
              <span className="font-mono text-on-surface">
                {t("oneTicket", {
                  price: formatTokenAmount(pool.bondPrice, pool.tokenDecimals),
                  symbol: pool.tokenSymbol,
                })}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>{t("totalCostLabel")}</span>
              <span className="font-mono font-semibold text-on-surface">
                {formatTokenAmount(totalCostBase, pool.tokenDecimals)}{" "}
                {pool.tokenSymbol}
              </span>
            </div>

            {/* Centralized Fee Summary */}
            <TransactionFeeSummary isFirstDeposit={isFirstDeposit} />
          </div>
        )}

        {/* ── Principal Protection Guarantee ────────────────────────── */}
        <div className="flex items-center gap-2.5 rounded-xl bg-secondary/10 border border-secondary/20 px-3.5 py-2.5 text-xs text-on-surface-variant">
          <svg
            className="w-4 h-4 text-secondary shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <p className="leading-snug">
            <strong className="text-on-surface font-semibold">
              {t("principalSafeBold")}
            </strong>{" "}
            {t("withdrawAnytimeText")}
          </p>
        </div>

        {/* ── CTA ────────────────────────────────────────────────────── */}
        <button
          onClick={handleDeposit}
          disabled={!canDeposit}
          className="w-full btn-gradient rounded-xl py-3.5 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pool.isFrozenForDraw
            ? "Pool Frozen During Draw"
            : pool.status === "Paused"
              ? "Pool Paused"
              : pool.status === "Closed"
                ? "Pool Closed"
                : totalCostBase > walletBalance
                  ? t("insufficientBalance")
                  : parsedTickets > 0
                    ? t("confirmDepositAmount", {
                        amount: formatTokenAmount(
                          totalCostBase,
                          pool.tokenDecimals
                        ),
                        symbol: pool.tokenSymbol,
                      })
                    : t("enterAmount")}
        </button>
      </div>
    </div>
  );
}
