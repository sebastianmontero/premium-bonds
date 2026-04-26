"use client";

import { formatTokenAmount, tierLabel, tierColor } from "@/app/mock-data";
import type { RecentWinner } from "@/app/types";

interface RecentWinnersTickerProps {
  winners: RecentWinner[];
  tokenDecimals: number;
}

export function RecentWinnersTicker({ winners, tokenDecimals }: RecentWinnersTickerProps) {
  if (winners.length === 0) return null;

  // Duplicate the list so the marquee loops seamlessly
  const items = [...winners, ...winners];

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 px-1">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
          Recent Winners
        </p>
      </div>

      <div className="relative overflow-hidden rounded-xl glass py-3">
        {/* Left fade */}
        <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-12 bg-gradient-to-r from-surface-container-high/70 to-transparent" />
        {/* Right fade */}
        <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-surface-container-high/70 to-transparent" />

        <div className="flex animate-marquee w-max gap-6 px-4">
          {items.map((winner, i) => (
            <div
              key={`${winner.address}-${i}`}
              className="flex shrink-0 items-center gap-3 rounded-lg bg-surface-container/60 px-4 py-2"
            >
              {/* Trophy badge */}
              <span className={`text-sm ${tierColor(winner.tierIndex)}`}>
                {winner.tierIndex === 0 ? "🏆" : winner.tierIndex === 1 ? "🥈" : "🎖️"}
              </span>

              {/* Address */}
              <span className="font-mono text-xs text-on-surface-variant">
                {winner.address}
              </span>

              {/* Amount */}
              <span className="font-mono text-xs font-semibold text-amber-300">
                +{formatTokenAmount(winner.amount, tokenDecimals)} {winner.tokenSymbol}
              </span>

              {/* Tier pill */}
              <span className={`pill text-[10px] ${
                winner.tierIndex === 0
                  ? "pill-warning"
                  : winner.tierIndex === 1
                    ? "pill-info"
                    : "pill-success"
              }`}>
                {tierLabel(winner.tierIndex)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
