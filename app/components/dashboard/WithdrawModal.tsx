"use client";

import { useState, useCallback } from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import type { PoolInfo, UserTicketInfo } from "@/app/types";
import {
  parseTransactionError,
  ParsedTransactionError,
  getExplorerUrl,
  truncateSignature,
} from "@/app/lib/errors";
import { SolanaErrorAlert } from "@/app/components/SolanaErrorAlert";

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
  const [ticketAmount, setTicketAmount] = useState("");
  const [step, setStep] = useState<
    "input" | "signing" | "confirming" | "success"
  >("input");
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
    setStep("signing");
    setParsedError(null);
    setTxSignature(null);

    try {
      if (onWithdraw) {
        const sig = await onWithdraw(withdrawValue);
        if (sig) setTxSignature(sig);
        setStep("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setStep("success");
      } else {
        // Simulate wallet signature
        await new Promise((resolve) => setTimeout(resolve, 1200));
        setStep("confirming");

        // Simulate blockchain transaction confirmation
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setStep("success");
      }
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Withdraw transaction cancelled by user.");
      } else {
        console.error("Withdraw transaction failed:", err);
      }
      setParsedError(parsed);
      setStep("input");
    }
  }, [canWithdraw, withdrawValue, onWithdraw]);

  const handleDone = useCallback(() => {
    onWithdrawSuccess(parsedTickets, withdrawValue, txSignature || undefined);
    onClose();
  }, [parsedTickets, withdrawValue, txSignature, onWithdrawSuccess, onClose]);

  return (
    <div className="modal-backdrop animate-fade-in" onClick={onClose}>
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
                Request Withdrawal
              </h2>
              <p className="text-xs text-on-surface-variant">
                Initiate Huma redemption to sell bonds
              </p>
            </div>
          </div>
          {step === "input" && (
            <button
              onClick={onClose}
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
          )}
        </div>

        {/* ── Progress Stepper ───────────────────────────────────────── */}
        {step !== "input" && (
          <div className="flex items-center justify-between px-6 py-2 bg-surface-container/30 rounded-xl">
            <div className="flex items-center gap-2">
              <StepDot
                active={step === "signing"}
                completed={step !== "signing"}
              />
              <span
                className={`text-xs font-medium transition ${step === "signing" ? "text-primary" : "text-on-surface-variant"}`}
              >
                Sign
              </span>
            </div>
            <StepLine active={step !== "signing"} />
            <div className="flex items-center gap-2">
              <StepDot
                active={step === "confirming"}
                completed={step === "success"}
              />
              <span
                className={`text-xs font-medium transition ${step === "confirming" ? "text-primary" : "text-on-surface-variant"}`}
              >
                Confirm
              </span>
            </div>
            <StepLine active={step === "success"} />
            <div className="flex items-center gap-2">
              <StepDot
                active={step === "success"}
                completed={step === "success"}
              />
              <span
                className={`text-xs font-medium transition ${step === "success" ? "text-primary" : "text-on-surface-variant"}`}
              >
                Done
              </span>
            </div>
          </div>
        )}

        {/* ── Step Views ────────────────────────────────────────────── */}
        {step === "input" && (
          <>
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
                Your Deposited Balance
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
                  {maxTickets.toLocaleString()} tickets (
                  {userTickets.activeTicketsCount} active ·{" "}
                  {userTickets.pendingTicketsCount} pending)
                </p>
              </div>
            </div>

            {/* Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-on-surface-variant">
                  Tickets to withdraw
                </label>
                <button
                  onClick={() => setTicketAmount(String(maxTickets))}
                  disabled={pool.isFrozenForDraw}
                  className="text-[10px] font-semibold text-primary hover:underline cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  MAX: {maxTickets.toLocaleString()}
                </button>
              </div>
              <input
                type="number"
                value={ticketAmount}
                onChange={(e) => setTicketAmount(e.target.value)}
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
                    Withdrawing initiates a Huma Finance redemption request.
                    This process is asynchronous. Once requested, your tickets
                    are burned immediately, and your funds will settle. You will
                    need to claim the settled USDC from the pending redemptions
                    panel once complete.
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
                    {(maxTickets - parsedTickets).toLocaleString()}
                  </span>
                </div>
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
                    : "Enter an amount"}
            </button>
          </>
        )}

        {step === "signing" && (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-4 animate-fade-in">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-surface-container">
              <div className="absolute inset-0 rounded-full border-2 border-primary/20 border-t-primary animate-spin" />
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-primary animate-pulse"
              >
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                <path d="M7 11V7a5 5 0 0 1 10 0v4" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-on-surface">
                Approve in Wallet
              </h3>
              <p className="text-xs text-on-surface-variant max-w-[280px]">
                Please sign the transaction in your Solana wallet extension to
                request redemption.
              </p>
            </div>
          </div>
        )}

        {step === "confirming" && (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-4 animate-fade-in">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-surface-container">
              <div className="absolute inset-0 rounded-full border-2 border-tertiary/20 border-t-tertiary animate-spin" />
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-tertiary"
              >
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
                <line x1="12" y1="22.08" x2="12" y2="12" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-base font-bold text-on-surface">
                Confirming Transaction
              </h3>
              <p className="text-xs text-on-surface-variant max-w-[280px]">
                Waiting for Solana block confirmation. Burning tickets and
                creating redemption request...
              </p>
            </div>
          </div>
        )}

        {step === "success" && (
          <div className="flex flex-col items-center justify-center py-8 text-center space-y-5 animate-fade-in">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-tertiary/10 text-tertiary shadow-[0_0_20px_rgba(34,197,94,0.15)] animate-scale-in">
              <svg
                width="32"
                height="32"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="space-y-1">
              <h3 className="text-lg font-bold text-on-surface">
                Redemption Requested!
              </h3>
              <p className="text-xs text-on-surface-variant max-w-[280px]">
                Your {parsedTickets.toLocaleString()} tickets have been burned.
                The redemption request is now pending settlement.
              </p>
            </div>

            <div className="w-full space-y-2 rounded-xl bg-surface-container/40 px-4 py-3.5 text-xs text-left">
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Redeemed Amount</span>
                <span className="font-semibold text-on-surface">
                  {formatTokenAmount(withdrawValue, pool.tokenDecimals)}{" "}
                  {pool.tokenSymbol}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Tickets Burned</span>
                <span className="font-mono text-on-surface">
                  -{parsedTickets}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant">Settlement Mode</span>
                <span className="font-semibold text-amber-400">
                  Asynchronous
                </span>
              </div>
              {txSignature && (
                <div className="flex justify-between pt-1 border-t border-white/10">
                  <span className="text-on-surface-variant">Solana Tx</span>
                  <a
                    href={getExplorerUrl(txSignature, "devnet", "solscan")}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-primary hover:underline font-medium"
                  >
                    {truncateSignature(txSignature)} ↗
                  </a>
                </div>
              )}
            </div>

            <button
              onClick={handleDone}
              className="w-full btn-gradient rounded-xl py-3.5 text-sm font-semibold cursor-pointer"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StepDot({
  active,
  completed,
}: {
  active: boolean;
  completed: boolean;
}) {
  return (
    <div
      className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
        completed
          ? "bg-tertiary"
          : active
            ? "bg-primary scale-125 shadow-[0_0_8px_rgba(135,173,255,0.6)]"
            : "bg-surface-bright"
      }`}
    />
  );
}

function StepLine({ active }: { active: boolean }) {
  return (
    <div
      className={`h-0.5 w-6 transition-all duration-500 ${
        active ? "bg-primary/50" : "bg-surface-bright"
      }`}
    />
  );
}
