"use client";

import type { PrizeHistoryEntry } from "@/app/types";
import { formatTokenAmount, tierLabel, tierBadgeClass } from "@/app/mock-data";

interface PrizeHistoryLedgerProps {
  entries: PrizeHistoryEntry[];
  tokenDecimals: number;
  tokenSymbol: string;
  unclaimedTotal: number;
  onClaim: () => void;
  onClaimSinglePrize: (drawCycleId: number) => void;
  onViewDetails?: (entry: PrizeHistoryEntry) => void;
  onViewCompleteLedger?: () => void;
}

function statusPill(status: PrizeHistoryEntry["status"]) {
  switch (status) {
    case "unclaimed":
      return (
        <span className="pill pill-warning">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Unclaimed
        </span>
      );
    case "claiming":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Claiming
        </span>
      );
    case "auto-reinvested":
      return (
        <span className="pill pill-success">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Auto-Reinvested
        </span>
      );
    case "claimed":
      return (
        <span className="pill pill-neutral">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Claimed
        </span>
      );
  }
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function PrizeHistoryLedger({
  entries,
  tokenDecimals,
  tokenSymbol,
  unclaimedTotal,
  onClaim,
  onClaimSinglePrize,
  onViewDetails,
  onViewCompleteLedger,
}: PrizeHistoryLedgerProps) {
  return (
    <div className="glass-strong rounded-2xl p-6 space-y-5">
      {/* ── Section Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="font-display text-lg font-bold text-on-surface">
            Prize History Ledger
          </h2>
          <p className="text-xs text-on-surface-variant">
            Historical verification of all win draw allocations.
          </p>
        </div>
        {unclaimedTotal > 0 && (
          <button
            onClick={onClaim}
            className="btn-claim rounded-xl px-5 py-2.5 text-sm cursor-pointer animate-yield-pulse"
          >
            Claim All ({formatTokenAmount(unclaimedTotal, tokenDecimals)}{" "}
            {tokenSymbol})
          </button>
        )}
      </div>

      {/* ── Ledger Cards ─────────────────────────────────────────────── */}
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.drawCycleId}
            className="flex flex-col md:grid md:grid-cols-[150px_120px_130px_220px_1fr] items-stretch md:items-center gap-4 p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-surface-bright/10 hover:bg-surface-container/50 hover:shadow-ambient transition-all duration-300"
          >
            {/* Draw ID & Date */}
            <div className="flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-mono text-sm font-bold">
                #{entry.drawCycleId}
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                  Draw Cycle
                </p>
                <p
                  className="text-xs text-on-surface font-semibold mt-0.5"
                  suppressHydrationWarning
                >
                  {formatDate(entry.date)}
                </p>
              </div>
            </div>

            {/* Tier Badge */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                Tier
              </p>
              <div className="mt-0.5">
                <span className={tierBadgeClass(entry.tierIndex)}>
                  {tierLabel(entry.tierIndex)}
                </span>
              </div>
            </div>

            {/* Amount */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                Amount Won
              </p>
              <p className="font-mono text-sm font-semibold text-on-surface mt-0.5">
                {formatTokenAmount(entry.amount, tokenDecimals)} {tokenSymbol}
              </p>
            </div>

            {/* Status */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                Status
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {statusPill(entry.status)}
                {entry.reinvestedTickets && (
                  <span className="text-xs text-tertiary font-medium">
                    (+{entry.reinvestedTickets} tkt)
                  </span>
                )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-start gap-3 md:border-l md:border-surface-bright/5 md:pl-6 w-full">
              {entry.status === "unclaimed" && (
                <button
                  onClick={() => onClaimSinglePrize(entry.drawCycleId)}
                  className="rounded-lg bg-emerald-500 hover:bg-emerald-400 text-surface-container px-3.5 py-1.5 text-xs font-bold transition cursor-pointer shadow-[0_2px_8px_rgba(16,185,129,0.25)]"
                >
                  Claim
                </button>
              )}
              {entry.status === "claiming" && (
                <span className="inline-flex items-center text-xs text-on-surface-variant font-medium py-1.5">
                  <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                  Claiming...
                </span>
              )}
              <button
                onClick={() => onViewDetails?.(entry)}
                className="text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer px-2 py-1.5"
              >
                Details
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ── View All ──────────────────────────────────────────────────── */}
      <div className="text-center pt-2">
        <button
          onClick={onViewCompleteLedger}
          className="text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer"
        >
          View Complete Ledger →
        </button>
      </div>
    </div>
  );
}
