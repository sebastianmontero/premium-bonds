"use client";

import { CountdownTimer } from "./CountdownTimer";
import { formatTokenAmount } from "@/app/mock-data";
import type { PoolInfo, UserTicketInfo } from "@/app/types";

interface PoolCardProps {
  pool: PoolInfo;
  userTickets: UserTicketInfo | null;
  onDeposit: () => void;
  onWithdraw: () => void;
}

export function PoolCard({ pool, userTickets, onDeposit, onWithdraw }: PoolCardProps) {
  const isFrozen = pool.isFrozenForDraw;
  const ticketCount = userTickets?.activeTicketsCount ?? 0;

  return (
    <div
      className={`glass-strong rounded-2xl p-6 space-y-5 transition-all ${isFrozen ? "frozen-overlay" : ""}`}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Token icon */}
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/10">
            <span className="font-display text-base font-bold text-primary">
              {pool.tokenSymbol.charAt(0)}
            </span>
          </div>
          <div>
            <h3 className="font-display text-lg font-bold text-on-surface">
              {pool.tokenSymbol} Premium Pool
            </h3>
            <p className="text-xs text-on-surface-variant">
              Draw #{pool.currentDrawCycleId} · Weekly
            </p>
          </div>
        </div>

        <span className={`pill ${pool.status === "Active" ? "pill-success" : "pill-warning"}`}>
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {pool.status}
        </span>
      </div>

      {/* ── Stats Grid ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4">
        <StatCell
          label="Pool TVL"
          value={`$${formatTokenAmount(pool.totalDepositedPrincipal, pool.tokenDecimals, 0)}`}
          accent="text-on-surface"
        />
        <StatCell
          label="Prize Pot"
          value={`$${formatTokenAmount(pool.estimatedPrizePot, pool.tokenDecimals, 0)}`}
          accent="text-gradient"
        />
        <StatCell
          label="Your Tickets"
          value={ticketCount.toLocaleString()}
          accent="text-primary"
        />
        <StatCell
          label="Bond Price"
          value={`${formatTokenAmount(pool.bondPrice, pool.tokenDecimals)} ${pool.tokenSymbol}`}
          accent="text-on-surface"
        />
      </div>

      {/* ── Countdown ────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between rounded-xl bg-surface-container/80 px-4 py-3">
        <div className="flex items-center gap-2">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <span className="text-xs font-medium text-on-surface-variant">
            Next Draw In
          </span>
        </div>
        <CountdownTimer targetTimestamp={pool.currentCycleEndAt} />
      </div>

      {/* ── Prize Tiers ──────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
          Prize Tiers
        </p>
        <div className="flex gap-2">
          {pool.prizeTiers.map((tier, i) => (
            <div
              key={i}
              className="flex-1 rounded-lg bg-surface-container/60 px-3 py-2 text-center"
            >
              <p className="text-[10px] font-medium text-on-surface-variant">
                {i === 0 ? "Grand" : i === 1 ? "Runner-up" : "Consolation"}
              </p>
              <p className="mt-0.5 font-mono text-sm font-semibold text-on-surface">
                {(tier.basisPoints / 100).toFixed(0)}%
              </p>
              <p className="text-[10px] text-on-surface-variant">
                ×{tier.numWinners}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Actions ──────────────────────────────────────────────────── */}
      <div className="flex gap-3 relative z-10">
        <button
          onClick={onDeposit}
          disabled={isFrozen}
          className="btn-gradient flex-1 rounded-xl px-4 py-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Deposit
        </button>
        <button
          onClick={onWithdraw}
          disabled={isFrozen || ticketCount === 0}
          className="btn-ghost flex-1 rounded-xl px-4 py-3 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Withdraw
        </button>
      </div>

      {/* ── Frozen Message ───────────────────────────────────────────── */}
      {isFrozen && (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl">
          <div className="flex items-center gap-2 rounded-xl bg-surface-container-high/90 px-5 py-3 shadow-ambient">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-tertiary animate-yield-pulse">
              <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48l2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48l2.83-2.83" />
            </svg>
            <p className="text-sm font-semibold text-on-surface">
              Draw in progress…
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCell({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  return (
    <div className="space-y-0.5">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
        {label}
      </p>
      <p className={`font-display text-xl font-bold tracking-tight ${accent}`}>
        {value}
      </p>
    </div>
  );
}
