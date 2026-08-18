"use client";

import type { PrizeHistoryEntry } from "@/app/types";
import {
  formatTokenAmount,
  tierLabel,
  tierBadgeClass,
  formatLocalDate,
} from "@/app/lib/formatters";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { VrfSeedBadge } from "@/app/components/common/VrfSeedBadge";
import { useTranslations, useFormatter } from "next-intl";

interface PrizeHistoryLedgerProps {
  entries: PrizeHistoryEntry[];
  tokenDecimals: number;
  tokenSymbol: string;
  ticketPrice?: number;
  unclaimedTotal?: number;
  onClaim?: () => void;
  onSimulateCrank?: (drawCycleId: number, winnerIndex: number) => void;
  onViewDetails?: (entry: PrizeHistoryEntry) => void;
  onViewCompleteLedger?: () => void;
  crankingCycles?: Record<string, boolean>;
  isLoading?: boolean;
}

export function PrizeHistoryLedger({
  entries,
  tokenDecimals,
  tokenSymbol,
  ticketPrice = 5_000_000,
  unclaimedTotal = 0,
  onClaim,
  onSimulateCrank,
  onViewDetails,
  onViewCompleteLedger,
  crankingCycles = {},
  isLoading = false,
}: PrizeHistoryLedgerProps) {
  const t = useTranslations("Ledger");
  const format = useFormatter();

  const formatDate = (isoDate: string): string => {
    return formatLocalDate(
      isoDate,
      { month: "short", day: "numeric", year: "numeric" },
      format.dateTime
    );
  };

  return (
    <div className="glass rounded-2xl p-6 space-y-5">
      {/* ── Section Header ────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-lg font-bold text-on-surface">
              {t("title")}
            </h2>
            {isLoading && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-spin" />
                {t("syncing")}
              </span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant">{t("subtitle")}</p>
        </div>
        {unclaimedTotal > 0 && (
          <button
            onClick={onClaim}
            className="btn-claim rounded-xl px-5 py-2.5 text-sm cursor-pointer animate-yield-pulse"
          >
            {t("claimAll")} ({formatTokenAmount(unclaimedTotal, tokenDecimals)}{" "}
            {tokenSymbol})
          </button>
        )}
      </div>

      {isLoading ? (
        /* ── Loading Skeleton State ───────────────────────────────────── */
        <div
          className="space-y-3 pointer-events-none select-none"
          aria-hidden="true"
        >
          <div className="hidden md:grid md:grid-cols-[50px_150px_100px_110px_150px_1fr] lg:grid-cols-[60px_160px_110px_130px_170px_1fr] items-center gap-4 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/60 border-b border-surface-bright/5">
            <div>{t("draw")}</div>
            <div>{t("date")}</div>
            <div>{t("tier")}</div>
            <div>{t("amountWon")}</div>
            <div>{t("status")}</div>
            <div className="text-right">{t("actions")}</div>
          </div>
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex flex-col md:grid md:grid-cols-[50px_150px_100px_110px_150px_1fr] lg:grid-cols-[60px_160px_110px_130px_170px_1fr] items-stretch md:items-center gap-4 p-4 rounded-xl skeleton-card"
            >
              <div className="h-5 w-12 rounded-md skeleton-box" />
              <div className="h-3.5 w-28 rounded-md skeleton-box" />
              <div className="h-6 w-24 rounded-full skeleton-box" />
              <div className="h-4 w-20 rounded-md skeleton-box" />
              <div className="h-6 w-28 rounded-full skeleton-box" />
              <div className="h-8 w-24 rounded-xl skeleton-box md:ml-auto" />
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        /* ── Empty State ──────────────────────────────────────────────── */
        <div className="flex flex-col items-center justify-center py-8 text-center h-full border border-dashed border-on-surface-variant/10 rounded-xl bg-surface-container/20">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-on-surface-variant/40 mb-2"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M16 8l-8 8M8 8l8 8" className="opacity-0" />
            <path d="M12 6v6l4 2" />
          </svg>
          <p className="text-xs font-semibold text-on-surface-variant">
            {t("noPrizes")}
          </p>
          <p className="text-[10px] text-on-surface-variant/60 max-w-[200px] mt-0.5">
            {t("noPrizesSub")}
          </p>
        </div>
      ) : (
        <>
          {/* ── Ledger Headers (Desktop Only) ─────────────────────────────── */}
          <div className="hidden md:grid md:grid-cols-[50px_150px_100px_110px_150px_1fr] lg:grid-cols-[60px_160px_110px_130px_170px_1fr] items-center gap-4 px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/60 border-b border-surface-bright/5">
            <div>{t("draw")}</div>
            <div>{t("date")}</div>
            <div>{t("tier")}</div>
            <div>{t("amountWon")}</div>
            <div>{t("status")}</div>
            <div className="text-right">{t("actions")}</div>
          </div>

          {/* ── Ledger Cards / Rows ───────────────────────────────────────── */}
          <div className="space-y-3">
            {entries.slice(0, 5).map((entry, index) => (
              <div
                key={`${entry.drawCycleId}-${entry.tierIndex}-${index}`}
                onClick={() => onViewDetails?.(entry)}
                className="flex flex-col md:grid md:grid-cols-[50px_150px_100px_110px_150px_1fr] lg:grid-cols-[60px_160px_110px_130px_170px_1fr] items-stretch md:items-center gap-4 p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-primary/20 hover:bg-surface-container/50 hover:shadow-ambient hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group"
              >
                {/* Draw ID & Date (grouped for mobile, split for desktop) */}
                <div className="flex items-center gap-4">
                  <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                    #{entry.drawCycleId}
                  </div>
                  <div className="md:hidden">
                    <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
                      {t("date")}
                    </p>
                    <p
                      className="text-xs text-on-surface font-semibold mt-0.5 whitespace-nowrap"
                      suppressHydrationWarning
                    >
                      {formatDate(entry.date)}
                    </p>
                  </div>
                </div>

                {/* Date (Desktop Only) */}
                <div className="hidden md:block">
                  <p
                    className="text-xs text-on-surface font-medium whitespace-nowrap"
                    suppressHydrationWarning
                  >
                    {formatDate(entry.date)}
                  </p>
                </div>

                {/* Tier Badge */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                    {t("tier")}
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
                    {t("amountWon")}
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
                    {t("status")}
                  </p>
                  <div className="flex flex-wrap items-center gap-1.5 mt-0.5 md:mt-0">
                    <StatusBadge
                      status={entry.status}
                      isCranking={
                        !!crankingCycles[
                          `${entry.drawCycleId}-${entry.winnerIndex}`
                        ]
                      }
                      size="sm"
                    />
                    {(() => {
                      const priorDustApplied =
                        entry.usedPriorDust ??
                        Math.max(
                          0,
                          (entry.reinvestedTickets || 0) * ticketPrice -
                            entry.amount
                        );

                      if (
                        entry.reinvestedTickets === undefined ||
                        entry.reinvestedTickets <= 0
                      ) {
                        return null;
                      }

                      if (priorDustApplied > 0) {
                        return (
                          <div
                            className="relative group/priorDust shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <span
                              className="inline-flex items-center gap-1 border border-tertiary/30 bg-tertiary/15 px-1.5 py-0.5 text-[10px] font-semibold text-tertiary rounded-md cursor-help"
                              aria-label={`Reinvested ${entry.reinvestedTickets} bonds using ${formatTokenAmount(priorDustApplied, tokenDecimals)} ${tokenSymbol} prior dust`}
                            >
                              +{entry.reinvestedTickets} bonds
                              <span className="text-[9px] px-1 bg-tertiary/20 rounded text-tertiary-bright font-bold">
                                +dust
                              </span>
                            </span>
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-56 p-2.5 rounded-lg bg-[#0F111A] border border-tertiary/20 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/priorDust:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-center whitespace-normal">
                              <strong className="text-tertiary block mb-1">
                                {t("bonusTicket")}
                              </strong>
                              Combined $
                              {formatTokenAmount(
                                priorDustApplied,
                                tokenDecimals
                              )}{" "}
                              {tokenSymbol} of previous dust with this
                              draw&apos;s winnings to purchase an extra bond.
                            </div>
                          </div>
                        );
                      }

                      return (
                        <span className="inline-flex items-center gap-1 border border-tertiary/20 bg-tertiary/10 px-1.5 py-0.5 text-[10px] font-semibold text-tertiary rounded-md">
                          +{entry.reinvestedTickets} bonds
                        </span>
                      );
                    })()}
                    {entry.dustAccumulated !== undefined &&
                      entry.dustAccumulated > 0 && (
                        <div
                          className="relative group/dust shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
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
                              {t("dustRemainder")}
                            </strong>
                            Leftover {tokenSymbol} winnings less than the{" "}
                            {formatTokenAmount(ticketPrice, tokenDecimals)}{" "}
                            {tokenSymbol} bond price. Automatically aggregated
                            above to claim.
                          </div>
                        </div>
                      )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-start md:justify-end gap-3 md:pl-0 w-full font-sans">
                  {entry.status === "processing" && onSimulateCrank && (
                    <button
                      disabled={
                        !!crankingCycles[
                          `${entry.drawCycleId}-${entry.winnerIndex}`
                        ]
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        onSimulateCrank(entry.drawCycleId, entry.winnerIndex);
                      }}
                      className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                        crankingCycles[
                          `${entry.drawCycleId}-${entry.winnerIndex}`
                        ]
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
                          crankingCycles[
                            `${entry.drawCycleId}-${entry.winnerIndex}`
                          ]
                            ? "duration-1000 text-on-surface-variant/40"
                            : "duration-3000"
                        }`}
                      >
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
                      </svg>
                      {crankingCycles[
                        `${entry.drawCycleId}-${entry.winnerIndex}`
                      ]
                        ? t("cranking")
                        : t("runCrank")}
                    </button>
                  )}

                  {/* Monospace/truncated VRF indicator to reassure users of fairness */}
                  {entry.vrfSeed && (
                    <VrfSeedBadge
                      seedHex={entry.vrfSeed}
                      drawCycleId={entry.drawCycleId}
                      className="hidden lg:inline-flex"
                    />
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
                    {t("details")}
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
              {t("viewComplete", { count: entries.length })}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
