"use client";

import { useState } from "react";
import { formatTokenAmount } from "@/app/mock-data";

interface UnclaimedBannerProps {
  totalUnclaimed: number; // base units
  tokenSymbol: string;
  tokenDecimals: number;
  onClaim: () => void;
}

export function UnclaimedBanner({
  totalUnclaimed,
  tokenSymbol,
  tokenDecimals,
  onClaim,
}: UnclaimedBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || totalUnclaimed <= 0) return null;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-yellow-500/8 to-amber-600/10 px-6 py-4">
      {/* Glow accent */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-400/15 blur-[60px]"
      />

      <div className="relative flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          {/* Trophy icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
          </div>

          <div>
            <p className="text-sm font-semibold text-amber-200">
              You have unclaimed winnings!
            </p>
            <p className="mt-0.5 text-xs text-amber-200/70">
              <span className="font-mono font-semibold text-amber-300">
                {formatTokenAmount(totalUnclaimed, tokenDecimals)} {tokenSymbol}
              </span>{" "}
              ready to claim from recent draws.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClaim}
            className="shrink-0 rounded-xl bg-amber-500/90 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 cursor-pointer"
          >
            Claim Now
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded-lg p-1.5 text-amber-300/60 transition hover:bg-amber-500/10 hover:text-amber-300 cursor-pointer"
            aria-label="Dismiss"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
