"use client";

import { useState } from "react";
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
  crankingCycles?: Record<number, boolean>;
}

function statusPill(
  status: PrizeHistoryEntry["status"],
  isCranking: boolean = false
) {
  if (isCranking) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300 animate-pulse">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-spin" />
        Cranking...
      </span>
    );
  }
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
  crankingCycles = {},
}: PrizeHistoryLedgerProps) {
  const [copiedDrawId, setCopiedDrawId] = useState<number | null>(null);

  const handleCopySeed = (
    e: React.MouseEvent,
    seed: string,
    drawCycleId: number
  ) => {
    e.stopPropagation();
    navigator.clipboard.writeText(seed);
    setCopiedDrawId(drawCycleId);
    setTimeout(() => setCopiedDrawId(null), 2000);
  };

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

      {/* ── Ledger Headers (Desktop Only) ─────────────────────────────── */}
      <div className="hidden md:grid md:grid-cols-[50px_90px_100px_100px_150px_1fr] lg:grid-cols-[60px_110px_110px_120px_180px_1fr] items-center gap-4 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/60 border-b border-surface-bright/5">
        <div>Draw</div>
        <div>Date</div>
        <div>Tier</div>
        <div>Amount Won</div>
        <div>Status</div>
        <div className="text-right">Actions</div>
      </div>

      {/* ── Ledger Cards / Rows ───────────────────────────────────────── */}
      <div className="space-y-3">
        {entries.map((entry) => (
          <div
            key={entry.drawCycleId}
            onClick={() => onViewDetails?.(entry)}
            className="flex flex-col md:grid md:grid-cols-[50px_90px_100px_100px_150px_1fr] lg:grid-cols-[60px_110px_110px_120px_180px_1fr] items-stretch md:items-center gap-4 p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-primary/20 hover:bg-surface-container/50 hover:shadow-ambient hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group"
          >
            {/* Draw ID & Date (grouped for mobile, split for desktop) */}
            <div className="flex items-center gap-4">
              <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                #{entry.drawCycleId}
              </div>
              <div className="md:hidden">
                <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                  Date
                </p>
                <p
                  className="text-xs text-on-surface font-semibold mt-0.5"
                  suppressHydrationWarning
                >
                  {formatDate(entry.date)}
                </p>
              </div>
            </div>

            {/* Date (Desktop Only) */}
            <div className="hidden md:block">
              <p
                className="text-xs text-on-surface font-medium"
                suppressHydrationWarning
              >
                {formatDate(entry.date)}
              </p>
            </div>

            {/* Tier Badge */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                Tier
              </p>
              <div className="mt-0.5 md:mt-0">
                <span className={tierBadgeClass(entry.tierIndex)}>
                  {tierLabel(entry.tierIndex)}
                </span>
              </div>
            </div>

            {/* Amount */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                Amount Won
              </p>
              <p
                className={`font-mono text-xs md:text-sm font-bold mt-0.5 md:mt-0 ${entry.tierIndex === 0 ? "text-amber-400" : "text-on-surface"}`}
              >
                {formatTokenAmount(entry.amount, tokenDecimals)}{" "}
                <span className="text-[10px] text-on-surface-variant/60 font-normal ml-0.5">
                  {tokenSymbol}
                </span>
              </p>
            </div>

            {/* Status */}
            <div>
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                Status
              </p>
              <div className="flex flex-wrap items-center gap-1.5 mt-0.5 md:mt-0">
                {statusPill(entry.status, !!crankingCycles[entry.drawCycleId])}
                {entry.reinvestedTickets !== undefined &&
                  entry.reinvestedTickets > 0 && (
                    <span className="inline-flex items-center gap-1 border border-tertiary/20 bg-tertiary/10 px-1.5 py-0.5 text-[10px] font-semibold text-tertiary rounded-md">
                      +{entry.reinvestedTickets} tkt
                    </span>
                  )}
                {entry.dustAccumulated !== undefined &&
                  entry.dustAccumulated > 0 && (
                    <div className="relative group/dust shrink-0">
                      <span className="inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant/40 px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant rounded-md cursor-help">
                        $
                        {formatTokenAmount(
                          entry.dustAccumulated,
                          tokenDecimals
                        )}{" "}
                        dust
                      </span>
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 rounded-lg bg-[#0F111A] border border-surface-bright/10 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/dust:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-center whitespace-normal">
                        <strong className="text-tertiary block mb-0.5">
                          Dust Remainder
                        </strong>
                        Leftover USDC winnings less than the $5.00 ticket price.
                        Automatically aggregated above to claim.
                      </div>
                    </div>
                  )}
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center justify-start md:justify-end gap-3 md:pl-0 w-full font-sans">
              {(entry.status === "processing" || entry.status === "partial") &&
                onSimulateCrank && (
                  <button
                    disabled={!!crankingCycles[entry.drawCycleId]}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSimulateCrank(entry.drawCycleId);
                    }}
                    className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                      crankingCycles[entry.drawCycleId]
                        ? "bg-surface-bright/10 text-on-surface-variant/40 cursor-not-allowed border border-surface-bright/5"
                        : "bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black cursor-pointer shadow-[0_2px_8px_rgba(245,158,11,0.25)]"
                    }`}
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
                      className={`animate-spin ${
                        crankingCycles[entry.drawCycleId]
                          ? "duration-1000 text-on-surface-variant/40"
                          : "duration-3000"
                      }`}
                    >
                      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
                    </svg>
                    {crankingCycles[entry.drawCycleId]
                      ? "Cranking..."
                      : `Run Crank ${entry.status === "partial" ? "(Batch)" : ""}`}
                  </button>
                )}

              {/* Monospace/truncated VRF indicator to reassure users of fairness */}
              {entry.vrfSeed && (
                <div
                  onClick={(e) =>
                    handleCopySeed(e, entry.vrfSeed!, entry.drawCycleId)
                  }
                  className="hidden lg:flex items-center gap-1 text-[10px] font-mono text-on-surface-variant/40 hover:text-primary hover:border-primary/20 bg-surface-container/50 border border-surface-bright/5 px-2 py-1 rounded-md max-w-[120px] truncate shrink-0 transition relative group/vrf cursor-pointer"
                >
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-tertiary animate-pulse"
                  >
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                  </svg>
                  {entry.vrfSeed.slice(0, 8)}

                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 rounded-lg bg-[#0F111A] border border-surface-bright/10 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/vrf:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-center whitespace-normal">
                    {copiedDrawId === entry.drawCycleId ? (
                      <span className="text-emerald-400 font-semibold flex items-center justify-center gap-1">
                        <svg
                          className="w-3 h-3"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        VRF Seed Copied!
                      </span>
                    ) : (
                      <span>
                        <strong className="text-primary block mb-0.5">
                          VRF Randomness Seed
                        </strong>
                        Provably fair draw entropy. Click to copy full seed.
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Row navigation indicator (Desktop Only) */}
              <div className="text-on-surface-variant/40 group-hover:text-primary transition-all duration-300 transform group-hover:translate-x-0.5 p-1 text-sm md:block hidden shrink-0">
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>

              {/* Row Details action (Mobile Only) */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onViewDetails?.(entry);
                }}
                className="text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer px-2 py-1.5 md:hidden"
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
