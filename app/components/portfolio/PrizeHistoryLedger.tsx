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

      {/* ── Table ─────────────────────────────────────────────────────── */}
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-outline-variant/10">
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
                Draw
              </th>
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
                Date
              </th>
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
                Tier
              </th>
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant text-right">
                Amount
              </th>
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant">
                Status
              </th>
              <th className="pb-3 text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/5">
            {entries.map((entry) => (
              <tr key={entry.drawCycleId} className="group">
                <td className="py-4 font-mono text-sm font-semibold text-on-surface">
                  #{entry.drawCycleId}
                </td>
                <td className="py-4 text-sm text-on-surface-variant">
                  {formatDate(entry.date)}
                </td>
                <td className="py-4">
                  <span className={tierBadgeClass(entry.tierIndex)}>
                    {tierLabel(entry.tierIndex)}
                  </span>
                </td>
                <td className="py-4 text-right font-mono text-sm font-semibold text-on-surface">
                  {formatTokenAmount(entry.amount, tokenDecimals)} {tokenSymbol}
                </td>
                <td className="py-4">
                  <div className="flex items-center gap-2">
                    {statusPill(entry.status)}
                    {entry.reinvestedTickets && (
                      <span className="text-xs text-tertiary font-medium">
                        (+{entry.reinvestedTickets})
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-4 text-right">
                  <div className="flex items-center justify-end gap-3">
                    {entry.status === "unclaimed" && (
                      <button
                        onClick={() => onClaimSinglePrize(entry.drawCycleId)}
                        className="rounded-lg bg-emerald-500/20 hover:bg-emerald-500 text-emerald-300 hover:text-white px-2.5 py-1 text-xs font-semibold transition cursor-pointer border border-emerald-500/30 shadow-sm"
                      >
                        Claim
                      </button>
                    )}
                    {entry.status === "claiming" && (
                      <span className="inline-flex items-center text-xs text-on-surface-variant font-medium">
                        <span className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                        Claiming...
                      </span>
                    )}
                    <button className="text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer">
                      Details
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ── View All ──────────────────────────────────────────────────── */}
      <div className="text-center pt-2">
        <button className="text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer">
          View Complete Ledger →
        </button>
      </div>
    </div>
  );
}
