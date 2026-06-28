"use client";

import React, { useState } from "react";
import type { PrizeHistoryEntry } from "@/app/types";
import { formatTokenAmount, tierLabel, tierBadgeClass } from "@/app/mock-data";

interface PrizeDetailsModalProps {
  entry: PrizeHistoryEntry | null;
  isOpen: boolean;
  onClose: () => void;
  tokenDecimals: number;
  tokenSymbol: string;
  onSimulateCrank: (drawCycleId: number) => void;
}

export default function PrizeDetailsModal({
  entry,
  isOpen,
  onClose,
  tokenDecimals,
  tokenSymbol,
  onSimulateCrank,
}: PrizeDetailsModalProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [shareStatus, setShareStatus] = useState<string | null>(null);

  if (!isOpen || !entry) return null;

  const handleClose = () => {
    setCopiedField(null);
    setShareStatus(null);
    onClose();
  };

  const handleCopy = (text: string, fieldName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(fieldName);
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleShare = () => {
    const text = `Just checked my Premium Bonds draw cycle ${entry.drawCycleId} - my ticket #${entry.winningTicket} won ${formatTokenAmount(entry.amount, tokenDecimals)} ${tokenSymbol}! 🚀 Verification verified by VRF seed. Join the pool at premiumbonds.sol`;
    navigator.clipboard.writeText(text);
    setShareStatus("Copied share template to clipboard!");
    setTimeout(() => setShareStatus(null), 3000);
  };

  // Calculate ticket visualizer percentage
  let visualPct = 50;
  let isWinningTicketInRange = false;

  if (entry.userTicketRange && entry.winningTicket) {
    const winVal = parseInt(entry.winningTicket, 10);
    const { start, end } = entry.userTicketRange;
    if (end > start) {
      visualPct = ((winVal - start) / (end - start)) * 100;
      visualPct = Math.max(0, Math.min(100, visualPct));
      isWinningTicketInRange = winVal >= start && winVal <= end;
    }
  }

  const formattedDate = new Date(entry.date + "T00:00:00").toLocaleDateString(
    "en-US",
    {
      month: "long",
      day: "numeric",
      year: "numeric",
    }
  );

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
        onClick={handleClose}
      />

      {/* Modal Card */}
      <div className="relative w-full max-w-2xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-6 shadow-ambient z-10 overflow-y-auto max-h-[90vh] glass-strong">
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-surface-bright/5">
          <div>
            <h3 className="text-xl font-bold font-display text-on-surface flex items-center gap-2">
              <svg
                className="w-5 h-5 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                />
              </svg>
              Draw Cycle #{entry.drawCycleId} Verification
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Draw conducted on {formattedDate}
            </p>
          </div>
          <button
            onClick={handleClose}
            className="rounded-lg p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/5 transition cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Modal Content */}
        <div className="space-y-6 pt-5">
          {/* Summary Row */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="p-4 rounded-xl bg-surface-container/20 border border-surface-bright/5">
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                Tier Won
              </p>
              <div className="mt-1">
                <span className={tierBadgeClass(entry.tierIndex)}>
                  {tierLabel(entry.tierIndex)}
                </span>
              </div>
            </div>
            <div className="p-4 rounded-xl bg-surface-container/20 border border-surface-bright/5">
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                Amount Won
              </p>
              <p className="text-lg font-bold font-mono text-primary mt-0.5">
                {formatTokenAmount(entry.amount, tokenDecimals)} {tokenSymbol}
              </p>
            </div>
            <div className="p-4 rounded-xl bg-surface-container/20 border border-surface-bright/5">
              <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                Verification Status
              </p>
              <div className="mt-1">
                {entry.status === "processing" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Processing
                  </span>
                )}
                {entry.status === "partial" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                    Reinvesting (Partial)
                  </span>
                )}
                {entry.status === "reinvested" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-300">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Reinvested
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Ticket Range Visualizer */}
          {entry.userTicketRange && entry.winningTicket && (
            <div className="p-5 rounded-xl bg-surface-container/20 border border-surface-bright/5 space-y-4">
              <h4 className="text-sm font-semibold text-on-surface">
                Ticket Match Visualizer
              </h4>

              <div className="grid grid-cols-2 text-xs text-on-surface-variant">
                <div>
                  Your Held Range:{" "}
                  <span className="font-mono text-on-surface font-semibold">
                    #{entry.userTicketRange.start} - #
                    {entry.userTicketRange.end}
                  </span>
                </div>
                <div className="text-right">
                  Winning Ticket:{" "}
                  <span className="font-mono text-primary font-bold">
                    #{entry.winningTicket}
                  </span>
                </div>
              </div>

              {/* Visual Slider Bar */}
              <div className="relative pt-6 pb-2">
                {/* Horizontal range bar */}
                <div className="h-2 w-full rounded-full bg-surface-container border border-surface-bright/10 relative">
                  {/* Winning ticket highlighted position */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex flex-col items-center"
                    style={{ left: `${visualPct}%` }}
                  >
                    {/* Glowing Pointer */}
                    <div className="h-4 w-4 rounded-full bg-primary border-2 border-[#0F111A] shadow-[0_0_8px_var(--color-primary)] animate-pulse" />

                    {/* Tooltip Label */}
                    <div className="absolute bottom-6 whitespace-nowrap bg-primary text-surface-container text-[10px] font-bold px-2 py-0.5 rounded shadow-lg">
                      Win Match
                    </div>
                  </div>
                </div>

                {/* Tick Labels */}
                <div className="flex justify-between text-[10px] text-on-surface-variant font-mono mt-2">
                  <span>#{entry.userTicketRange.start}</span>
                  <span className="text-on-surface-variant/40">
                    Range Midpoint
                  </span>
                  <span>#{entry.userTicketRange.end}</span>
                </div>
              </div>

              {isWinningTicketInRange ? (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5 bg-emerald-500/5 border border-emerald-500/10 p-2.5 rounded-lg">
                  <svg
                    className="w-4 h-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                  Verification Pass: The drawn winning ticket fell directly
                  inside your held ticket range.
                </p>
              ) : (
                <p className="text-xs text-amber-400 flex items-center gap-1.5 bg-amber-500/5 border border-amber-500/10 p-2.5 rounded-lg">
                  <svg
                    className="w-4 h-4 shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    />
                  </svg>
                  Visual mismatch: Simulated out-of-range indicator for
                  secondary proof checking.
                </p>
              )}
            </div>
          )}

          {/* Auto-Reinvestment Detail Section */}
          {(entry.status === "reinvested" || entry.status === "partial") && (
            <div className="p-5 rounded-xl border border-emerald-500/10 bg-emerald-500/[0.02] space-y-3">
              <h4 className="text-sm font-semibold text-emerald-300 flex items-center gap-1.5">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17"
                  />
                </svg>
                Auto-Reinvestment Breakdown
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
                  <p className="text-on-surface-variant font-medium">
                    Reinvested Tickets
                  </p>
                  <p className="font-mono text-base font-bold text-on-surface mt-1">
                    +{entry.reinvestedTickets || 0} Tickets
                  </p>
                </div>
                <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
                  <p className="text-on-surface-variant font-medium">
                    Purchase Cost
                  </p>
                  <p className="font-mono text-base font-bold text-on-surface mt-1">
                    5.00 USDC / tkt
                  </p>
                </div>
                <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
                  <p className="text-on-surface-variant font-medium">
                    Target Pool
                  </p>
                  <p className="font-mono text-base font-bold text-on-surface mt-1">
                    Solana Yield Pool
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs mt-2">
                <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
                  <p className="text-on-surface-variant font-medium">
                    Amount Reinvested
                  </p>
                  <p className="font-mono text-sm font-bold text-primary mt-1">
                    {formatTokenAmount(
                      entry.amountReinvested || 0,
                      tokenDecimals
                    )}{" "}
                    {tokenSymbol}
                  </p>
                </div>
                <div className="bg-surface-container/10 p-3 rounded-lg border border-surface-bright/5">
                  <p className="text-on-surface-variant font-medium">
                    Leftover Dust Remainder
                  </p>
                  <p className="font-mono text-sm font-bold text-primary mt-1">
                    {formatTokenAmount(
                      entry.dustAccumulated || 0,
                      tokenDecimals
                    )}{" "}
                    {tokenSymbol}
                  </p>
                </div>
              </div>
              <p className="text-xs text-on-surface-variant leading-relaxed">
                {entry.status === "partial"
                  ? "This win draw is currently being reinvested in batches via permissionless crank on-chain. Progress can be monitored above."
                  : "Your reward was compound-reinvested into new active tickets. Reinvestment transaction verified by on-chain smart contract instructions, leaving a small dust balance."}
              </p>
            </div>
          )}

          {/* Verification Code Fields */}
          <div className="space-y-4">
            <h4 className="text-sm font-semibold text-on-surface">
              On-Chain Cryptographic Proofs
            </h4>

            {/* VRF Seed */}
            {entry.vrfSeed && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-semibold uppercase tracking-wider">
                  <span>Randomness VRF Seed (SHA-256)</span>
                  <button
                    onClick={() => handleCopy(entry.vrfSeed!, "vrf")}
                    className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
                  >
                    {copiedField === "vrf" ? (
                      <>
                        <svg
                          className="w-3.5 h-3.5 text-emerald-400"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M5 13l4 4L19 7"
                          />
                        </svg>
                        <span className="text-emerald-400">Copied</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-3.5 h-3.5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                          />
                        </svg>
                        <span>Copy</span>
                      </>
                    )}
                  </button>
                </div>
                <div className="rounded-xl border border-surface-bright/5 bg-[#08090E] p-3">
                  <code className="text-xs font-mono text-on-surface break-all select-all block">
                    {entry.vrfSeed}
                  </code>
                </div>
              </div>
            )}

            {/* Transaction Signature */}
            {entry.txSignature && (
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-semibold uppercase tracking-wider">
                  <span>Transaction Signature</span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleCopy(entry.txSignature!, "tx")}
                      className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
                    >
                      {copiedField === "tx" ? (
                        <>
                          <svg
                            className="w-3.5 h-3.5 text-emerald-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          <span className="text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                            />
                          </svg>
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                    <a
                      href={`https://explorer.solana.com/tx/${entry.txSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
                    >
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                        />
                      </svg>
                      <span>Solana Explorer</span>
                    </a>
                  </div>
                </div>
                <div className="rounded-xl border border-surface-bright/5 bg-[#08090E] p-3">
                  <code className="text-xs font-mono text-on-surface break-all select-all block">
                    {entry.txSignature}
                  </code>
                </div>
              </div>
            )}
          </div>

          {/* Social Share Card */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between p-4 rounded-xl border border-primary/10 bg-primary/[0.02] gap-4">
            <div className="space-y-0.5">
              <h5 className="text-sm font-semibold text-on-surface flex items-center gap-1.5">
                <svg
                  className="w-4 h-4 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z"
                  />
                </svg>
                Bragging Rights
              </h5>
              <p className="text-xs text-on-surface-variant">
                Tell your friends about your winning verification.
              </p>
            </div>

            <div className="relative">
              <button
                onClick={handleShare}
                className="w-full sm:w-auto flex items-center justify-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-surface-container font-semibold text-xs px-4 py-2.5 transition cursor-pointer"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M8.684 10.742l4.632-2.316m0 4.632l-4.632-2.316M12 10.5a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm7.5-6a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zm-7.5 12a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z"
                  />
                </svg>
                Share Win
              </button>

              {shareStatus && (
                <div className="absolute right-0 top-full mt-2 z-10 whitespace-nowrap bg-emerald-500 text-surface-container text-[10px] font-bold px-2 py-1 rounded shadow-lg">
                  {shareStatus}
                </div>
              )}
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-surface-bright/5">
            <button
              onClick={handleClose}
              className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-5 py-2.5 transition cursor-pointer"
            >
              Close
            </button>

            {(entry.status === "processing" || entry.status === "partial") && (
              <button
                onClick={() => onSimulateCrank(entry.drawCycleId)}
                className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black font-semibold text-xs px-5 py-2.5 transition cursor-pointer shadow-[0_4px_14px_rgba(245,158,11,0.25)] animate-yield-pulse"
              >
                <svg
                  width="16"
                  height="16"
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
          </div>
        </div>
      </div>
    </div>
  );
}
