"use client";

import { useState, useCallback } from "react";
import { formatTokenAmount } from "@/app/mock-data";
import type { PoolInfo } from "@/app/types";

interface DepositModalProps {
  pool: PoolInfo;
  walletBalance: number; // base units
  onClose: () => void;
  autoReinvestDefault: boolean;
}

export function DepositModal({
  pool,
  walletBalance,
  onClose,
}: DepositModalProps) {
  const [inputValue, setInputValue] = useState("");
  const [activeInput, setActiveInput] = useState<"token" | "ticket">("token");
  const [optOutReinvest, setOptOutReinvest] = useState(false);

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
  const canDeposit = parsedTickets > 0 && totalCostBase <= walletBalance;

  const handleDeposit = useCallback(() => {
    // Placeholder: will call the on-chain buy_bonds instruction
    console.log("Deposit", {
      tickets: parsedTickets,
      cost: totalCostBase,
      autoReinvest: !optOutReinvest,
    });
    onClose();
  }, [parsedTickets, totalCostBase, optOutReinvest, onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-2xl glass-strong p-6 space-y-5 shadow-ambient mx-4"
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
                Deposit {pool.tokenSymbol}
              </h2>
              <p className="text-xs text-on-surface-variant">
                {pool.tokenSymbol} Premium Pool
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

        {/* ── Current Prize Pot ───────────────────────────────────────── */}
        <div className="rounded-xl bg-surface-container/60 px-4 py-3 flex items-center justify-between">
          <span className="text-xs font-medium text-on-surface-variant">
            Current Prize Pot
          </span>
          <span className="font-display text-lg font-bold text-gradient">
            ${formatTokenAmount(pool.estimatedPrizePot, pool.tokenDecimals, 0)}
          </span>
        </div>

        {/* ── Dual Input ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          {/* Token amount */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-on-surface-variant">
                Amount ({pool.tokenSymbol})
              </label>
              <button
                onClick={() => {
                  const maxTokens = walletBalance / 10 ** pool.tokenDecimals;
                  setActiveInput("token");
                  setInputValue(String(Math.floor(maxTokens / bondPriceHuman) * bondPriceHuman));
                }}
                className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
              >
                MAX: {formatTokenAmount(walletBalance, pool.tokenDecimals)}
              </button>
            </div>
            <input
              type="number"
              value={tokenDisplay}
              onChange={(e) => {
                setActiveInput("token");
                setInputValue(e.target.value);
              }}
              placeholder="0.00"
              min="0"
              step={bondPriceHuman}
              className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition"
            />
          </div>

          {/* Swap indicator */}
          <div className="flex items-center justify-center">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-highest border border-outline-variant/20">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
                <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
              </svg>
            </div>
          </div>

          {/* Ticket amount */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-on-surface-variant">
              Tickets
            </label>
            <input
              type="number"
              value={ticketDisplay}
              onChange={(e) => {
                setActiveInput("ticket");
                setInputValue(e.target.value);
              }}
              placeholder="0"
              min="0"
              step="1"
              className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition"
            />
          </div>
        </div>

        {/* ── Auto-Reinvest Opt-out ──────────────────────────────────── */}
        <label className="flex items-start gap-3 rounded-xl bg-surface-container/60 px-4 py-3 cursor-pointer group">
          <input
            type="checkbox"
            checked={optOutReinvest}
            onChange={(e) => setOptOutReinvest(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-outline-variant accent-primary cursor-pointer"
          />
          <div>
            <p className="text-sm font-medium text-on-surface group-hover:text-primary transition">
              Opt-out of auto-reinvest
            </p>
            <p className="text-xs text-on-surface-variant mt-0.5">
              If unchecked, your winnings will automatically compound into new tickets.
            </p>
          </div>
        </label>

        {/* ── Summary ────────────────────────────────────────────────── */}
        {parsedTickets > 0 && (
          <div className="space-y-2 rounded-xl bg-surface-container/40 px-4 py-3 text-xs">
            <div className="flex justify-between text-on-surface-variant">
              <span>Tickets received</span>
              <span className="font-semibold text-on-surface">{parsedTickets}</span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Bond price</span>
              <span className="font-mono text-on-surface">
                1 ticket = {formatTokenAmount(pool.bondPrice, pool.tokenDecimals)} {pool.tokenSymbol}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Total cost</span>
              <span className="font-mono font-semibold text-on-surface">
                {formatTokenAmount(totalCostBase, pool.tokenDecimals)} {pool.tokenSymbol}
              </span>
            </div>
            <div className="flex justify-between text-on-surface-variant">
              <span>Est. network fee</span>
              <span className="font-mono text-on-surface">~0.00005 SOL</span>
            </div>
          </div>
        )}

        {/* ── CTA ────────────────────────────────────────────────────── */}
        <button
          onClick={handleDeposit}
          disabled={!canDeposit}
          className="w-full btn-gradient rounded-xl py-3.5 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {totalCostBase > walletBalance
            ? "Insufficient Balance"
            : parsedTickets > 0
              ? `Confirm Deposit — ${formatTokenAmount(totalCostBase, pool.tokenDecimals)} ${pool.tokenSymbol}`
              : "Enter an amount"}
        </button>
      </div>
    </div>
  );
}
