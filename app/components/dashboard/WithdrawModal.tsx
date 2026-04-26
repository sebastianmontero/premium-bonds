"use client";

import { useState, useCallback } from "react";
import { formatTokenAmount } from "@/app/mock-data";
import type { PoolInfo, UserTicketInfo } from "@/app/types";

interface WithdrawModalProps {
  pool: PoolInfo;
  userTickets: UserTicketInfo;
  onClose: () => void;
}

export function WithdrawModal({ pool, userTickets, onClose }: WithdrawModalProps) {
  const [ticketAmount, setTicketAmount] = useState("");

  const maxTickets = userTickets.activeTicketsCount;
  const parsedTickets = parseInt(ticketAmount, 10) || 0;
  const withdrawValue = parsedTickets * pool.bondPrice;
  const canWithdraw = parsedTickets > 0 && parsedTickets <= maxTickets && !pool.isFrozenForDraw;

  const handleWithdraw = useCallback(() => {
    // Placeholder: will call the on-chain sell_bonds instruction
    console.log("Withdraw", {
      tickets: parsedTickets,
      value: withdrawValue,
    });
    onClose();
  }, [parsedTickets, withdrawValue, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl glass-strong p-6 space-y-5 shadow-ambient mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-error/20 to-secondary/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-error">
                <path d="M12 5v14M5 12l7 7 7-7" />
              </svg>
            </div>
            <div>
              <h2 className="font-display text-lg font-bold text-on-surface">
                Withdraw {pool.tokenSymbol}
              </h2>
              <p className="text-xs text-on-surface-variant">
                Sell bonds and retrieve principal
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-highest transition cursor-pointer"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Frozen Alert ───────────────────────────────────────────── */}
        {pool.isFrozenForDraw && (
          <div className="flex items-center gap-3 rounded-xl border border-tertiary/20 bg-tertiary/5 px-4 py-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-tertiary">
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
            </svg>
            <div>
              <p className="text-sm font-semibold text-tertiary">
                Draw in progress!
              </p>
              <p className="text-xs text-on-surface-variant mt-0.5">
                The pool is temporarily frozen to pick winners. Please check back in a few minutes.
              </p>
            </div>
          </div>
        )}

        {/* ── Current Balance ────────────────────────────────────────── */}
        <div className="rounded-xl bg-surface-container/60 px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-on-surface-variant">
            Your Deposited Balance
          </span>
          <div className="text-right">
            <p className="font-display text-lg font-bold text-on-surface">
              {formatTokenAmount(maxTickets * pool.bondPrice, pool.tokenDecimals)} {pool.tokenSymbol}
            </p>
            <p className="text-[10px] text-on-surface-variant">
              {maxTickets.toLocaleString()} tickets
            </p>
          </div>
        </div>

        {/* ── Input ──────────────────────────────────────────────────── */}
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

        {/* ── Warning ────────────────────────────────────────────────── */}
        {parsedTickets > 0 && !pool.isFrozenForDraw && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/5 px-4 py-3">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5 text-amber-400">
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <p className="text-xs text-amber-200/80">
              Withdrawing now means you forfeit your tickets for the upcoming draw.
            </p>
          </div>
        )}

        {/* ── Summary ────────────────────────────────────────────────── */}
        {parsedTickets > 0 && (
          <div className="space-y-2 rounded-xl bg-surface-container/40 px-4 py-3 text-xs">
            <div className="flex justify-between text-on-surface-variant">
              <span>Tickets to sell</span>
              <span className="font-semibold text-on-surface">{parsedTickets}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>You receive</span>
              <span className="font-mono font-semibold text-on-surface">
                {formatTokenAmount(withdrawValue, pool.tokenDecimals)} {pool.tokenSymbol}
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

        {/* ── CTA ────────────────────────────────────────────────────── */}
        <button
          onClick={handleWithdraw}
          disabled={!canWithdraw}
          className="w-full rounded-xl bg-error/90 px-4 py-3.5 text-sm font-semibold text-white transition hover:bg-error cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {pool.isFrozenForDraw
            ? "Pool Frozen — Try Later"
            : parsedTickets > maxTickets
              ? "Exceeds Balance"
              : parsedTickets > 0
                ? `Confirm Withdrawal — ${formatTokenAmount(withdrawValue, pool.tokenDecimals)} ${pool.tokenSymbol}`
                : "Enter an amount"}
        </button>
      </div>
    </div>
  );
}
