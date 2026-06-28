"use client";

import type { PrizeHistoryEntry } from "@/app/types";
import { formatTokenAmount, tierLabel, tierBadgeClass } from "@/app/mock-data";

interface PrizeHistoryLedgerProps {
  entries: PrizeHistoryEntry[];
  tokenDecimals: number;
  tokenSymbol: string;
  unclaimedTotal: number;
  onClaim: () => void;
  onSimulateCrank?: (drawCycleId: number) => void;
  onViewDetails?: (entry: PrizeHistoryEntry) => void;
  onViewCompleteLedger?: () => void;
}

function statusPill(status: PrizeHistoryEntry["status"]) {
  switch (status) {
    case "processing":
      return (
        <span className="pill pill-warning">
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          Processing
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Reinvesting
        </span>
      );
    case "reinvested":
      return (
        <span className="pill pill-success">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Reinvested
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
  onSimulateCrank,
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
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                {statusPill(entry.status)}
                {entry.reinvestedTickets !== undefined &&
                  entry.reinvestedTickets > 0 && (
                    <span className="text-xs text-tertiary font-medium">
                      (+{entry.reinvestedTickets} tkt)
                    </span>
                  )}
                {entry.dustAccumulated !== undefined &&
                  entry.dustAccumulated > 0 && (
                    <span className="text-[11px] text-on-surface-variant/70 font-mono">
                      ($
                      {formatTokenAmount(
                        entry.dustAccumulated,
                        tokenDecimals
                      )}{" "}
                      dust)
                    </span>
                  )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-start gap-3 md:border-l md:border-surface-bright/5 md:pl-6 w-full font-sans">
              {(entry.status === "processing" || entry.status === "partial") &&
                onSimulateCrank && (
                  <button
                    onClick={() => onSimulateCrank(entry.drawCycleId)}
                    className="rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black px-3.5 py-1.5 text-xs font-bold transition cursor-pointer shadow-[0_2px_8px_rgba(245,158,11,0.25)] flex items-center gap-1"
                  >
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="animate-spin duration-3000"
                    >
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
                    </svg>
                    Run Crank {entry.status === "partial" && "(Batch)"}
                  </button>
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
