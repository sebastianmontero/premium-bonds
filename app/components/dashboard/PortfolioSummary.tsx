"use client";

import { formatTokenAmount } from "@/app/mock-data";

interface PortfolioSummaryProps {
  totalDeposited: number; // base units
  walletBalance: number; // base units
  autoReinvest: boolean;
  tokenSymbol: string;
  tokenDecimals: number;
  activeTickets: number;
}

export function PortfolioSummary({
  totalDeposited,
  walletBalance,
  autoReinvest,
  tokenSymbol,
  tokenDecimals,
  activeTickets,
}: PortfolioSummaryProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {/* ── Total Bonds ────────────────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 space-y-1.5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0110 0v4" />
          </svg>
          <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            Total Bonds
          </p>
        </div>
        <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
          {formatTokenAmount(totalDeposited, tokenDecimals)}
          <span className="ml-1.5 text-base font-medium text-on-surface-variant">
            {tokenSymbol}
          </span>
        </p>
        <p className="text-xs text-on-surface-variant">
          {activeTickets.toLocaleString()} active tickets
        </p>
      </div>

      {/* ── Wallet Balance ─────────────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 space-y-1.5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-tertiary">
            <path d="M21 12V7H5a2 2 0 010-4h14v4" />
            <path d="M3 5v14a2 2 0 002 2h16v-5" />
            <path d="M18 12a2 2 0 000 4h4v-4h-4z" />
          </svg>
          <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            Wallet Balance
          </p>
        </div>
        <p className="font-display text-3xl font-bold tracking-tight text-on-surface">
          {formatTokenAmount(walletBalance, tokenDecimals)}
          <span className="ml-1.5 text-base font-medium text-on-surface-variant">
            {tokenSymbol}
          </span>
        </p>
        <p className="text-xs text-on-surface-variant">
          Available to deposit
        </p>
      </div>

      {/* ── Auto-Reinvest Status ────────────────────────────────────────── */}
      <div className="glass-strong rounded-2xl p-6 space-y-1.5">
        <div className="flex items-center gap-2">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
            <polyline points="23 4 23 10 17 10" />
            <polyline points="1 20 1 14 7 14" />
            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
          </svg>
          <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
            Auto-Reinvest
          </p>
        </div>
        <div className="flex items-center gap-3 pt-1">
          <span
            className={`pill ${autoReinvest ? "pill-success" : "pill-warning"}`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {autoReinvest ? "Active" : "Inactive"}
          </span>
        </div>
        <p className="text-xs text-on-surface-variant">
          {autoReinvest
            ? "Winnings auto-compound into new tickets"
            : "Winnings must be claimed manually"}
        </p>
      </div>
    </div>
  );
}
