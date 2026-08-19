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
import { BonusBondDustBadge } from "@/app/components/common/BonusBondDustBadge";
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
    <div className="glass rounded-2xl p-4 sm:p-6 space-y-5">
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
          <p className="text-xs text-on-surface-variant mt-0.5">{t("subtitle")}</p>
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
          {/* Mobile/Tablet Card Skeleton (< xl) */}
          <div className="xl:hidden space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-xl skeleton-card space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-11 rounded-lg skeleton-box" />
                    <div className="h-4 w-28 rounded skeleton-box" />
                  </div>
                  <div className="h-5 w-20 rounded-full skeleton-box" />
                </div>
                <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-surface-container/20">
                  <div className="h-8 rounded skeleton-box" />
                  <div className="h-8 rounded skeleton-box" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="h-5 w-28 rounded-lg skeleton-box" />
                  <div className="h-8 w-24 rounded-lg skeleton-box" />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table Skeleton (>= xl) */}
          <div className="hidden xl:block overflow-x-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
            <table className="w-full min-w-[860px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-bright/10 bg-surface-container/40 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4 w-16">{t("draw")}</th>
                  <th className="py-3.5 px-4">{t("date")}</th>
                  <th className="py-3.5 px-4">{t("tier")}</th>
                  <th className="py-3.5 px-4 text-right">{t("amountWon")}</th>
                  <th className="py-3.5 px-4">{t("status")}</th>
                  <th className="py-3.5 px-4 text-right">{t("actions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-bright/5">
                {[1, 2, 3, 4].map((i) => (
                  <tr key={i} className="p-4">
                    <td className="py-3.5 px-4">
                      <div className="h-8 w-11 rounded-lg skeleton-box" />
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="h-4 w-24 rounded skeleton-box" />
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="h-5 w-20 rounded-full skeleton-box" />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="h-4 w-24 rounded skeleton-box ml-auto" />
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="h-5 w-28 rounded-full skeleton-box" />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="h-8 w-24 rounded-lg skeleton-box ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          {/* ── Mobile & Tablet Card Layout (< xl) ─────────────────────── */}
          <div className="xl:hidden space-y-3">
            {entries.slice(0, 5).map((entry, index) => {
              const isCranking =
                !!crankingCycles[`${entry.drawCycleId}-${entry.winnerIndex}`];

              return (
                <div
                  key={`${entry.drawCycleId}-${entry.tierIndex}-${index}`}
                  onClick={(e) => {
                    if (
                      (e.target as HTMLElement).closest(
                        "button, a, [data-prevent-row-click]"
                      )
                    ) {
                      return;
                    }
                    onViewDetails?.(entry);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      if (
                        (e.target as HTMLElement).closest(
                          "button, a, [data-prevent-row-click]"
                        )
                      ) {
                        return;
                      }
                      e.preventDefault();
                      onViewDetails?.(entry);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={t("viewPrizeDetailsAria", {
                    drawCycleId: entry.drawCycleId,
                  })}
                  className="p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-primary/20 hover:bg-surface-container/50 hover:shadow-ambient hover:-translate-y-0.5 transition-all duration-300 cursor-pointer space-y-3 group focus-visible:ring-1 focus-visible:ring-primary outline-none"
                >
                  {/* Tier 1: Draw #, Date & Tier Badge */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                        #{entry.drawCycleId}
                      </div>
                      <div>
                        <p
                          className="text-xs font-semibold text-on-surface"
                          suppressHydrationWarning
                        >
                          {formatDate(entry.date)}
                        </p>
                        <p className="text-[10px] text-on-surface-variant/60 uppercase tracking-wider font-semibold">
                          {t("date")}
                        </p>
                      </div>
                    </div>
                    <span className={tierBadgeClass(entry.tierIndex)}>
                      {tierLabel(entry.tierIndex)}
                    </span>
                  </div>

                  {/* Tier 2: Amount Won & Status Metrics */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-surface-container/40 border border-surface-bright/5">
                    <div>
                      <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                        {t("amountWon")}
                      </p>
                      <p
                        className={`font-mono text-sm font-bold mt-0.5 ${
                          entry.tierIndex === 0
                            ? "text-amber-400"
                            : "text-on-surface"
                        }`}
                      >
                        {formatTokenAmount(entry.amount, tokenDecimals)}{" "}
                        <span className="text-[10px] text-on-surface-variant/60 font-normal">
                          {tokenSymbol}
                        </span>
                      </p>
                    </div>

                    <div>
                      <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                        {t("status")}
                      </p>
                      <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                        <StatusBadge
                          status={entry.status}
                          isCranking={isCranking}
                          size="sm"
                        />
                        {entry.reinvestedTickets !== undefined &&
                          entry.reinvestedTickets > 0 && (
                            <BonusBondDustBadge
                              bondsBought={entry.reinvestedTickets}
                              amountWon={entry.amount}
                              bondPrice={ticketPrice || 5_000_000}
                              usedPriorDust={entry.usedPriorDust}
                              tokenDecimals={tokenDecimals}
                              tokenSymbol={tokenSymbol}
                              tooltipAlign="center"
                            />
                          )}
                        {entry.dustAccumulated !== undefined &&
                          entry.dustAccumulated > 0 && (
                            <div
                              data-prevent-row-click="true"
                              className="relative group/dust shrink-0"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <span className="inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant/40 px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant rounded-md cursor-help whitespace-nowrap">
                                $
                                {formatTokenAmount(
                                  entry.dustAccumulated,
                                  tokenDecimals
                                )}{" "}
                                dust
                              </span>
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 max-w-[calc(100vw-32px)] p-2.5 rounded-xl bg-[#0F111A] border border-surface-bright/10 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/dust:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-center whitespace-normal">
                                <strong className="text-tertiary block mb-0.5">
                                  {t("dustRemainder")}
                                </strong>
                                {t("dustRemainderDesc", {
                                  bondPrice: formatTokenAmount(
                                    ticketPrice,
                                    tokenDecimals
                                  ),
                                  symbol: tokenSymbol,
                                })}
                              </div>
                            </div>
                          )}
                      </div>
                    </div>
                  </div>

                  {/* Tier 3: Actions Footer */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-surface-bright/5">
                    <div>
                      {entry.vrfSeed && (
                        <VrfSeedBadge
                          seedHex={entry.vrfSeed}
                          drawCycleId={entry.drawCycleId}
                          variant="default"
                        />
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      {entry.status === "processing" && onSimulateCrank && (
                        <button
                          disabled={isCranking}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSimulateCrank(
                              entry.drawCycleId,
                              entry.winnerIndex
                            );
                          }}
                          className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                            isCranking
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
                              isCranking
                                ? "duration-1000 text-on-surface-variant/40"
                                : "duration-3000"
                            }`}
                          >
                            <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
                          </svg>
                          {isCranking ? t("cranking") : t("runCrank")}
                        </button>
                      )}

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onViewDetails?.(entry);
                        }}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer group-hover:translate-x-0.5 transition-transform shrink-0"
                      >
                        <span>{t("details")}</span>
                        <span>→</span>
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ── Desktop Semantic Table Layout (>= xl) ─────────────────── */}
          <div className="hidden xl:block overflow-x-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
            <table className="w-full min-w-[860px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-bright/10 bg-surface-container/40 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3.5 px-4 w-16">
                    {t("draw")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 whitespace-nowrap">
                    {t("date")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 whitespace-nowrap">
                    {t("tier")}
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 px-4 text-right whitespace-nowrap"
                  >
                    {t("amountWon")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 whitespace-nowrap">
                    {t("status")}
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 px-4 text-right whitespace-nowrap min-w-[190px]"
                  >
                    {t("actions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-bright/5 font-medium text-on-surface">
                {entries.slice(0, 5).map((entry, index) => {
                  const isCranking =
                    !!crankingCycles[
                      `${entry.drawCycleId}-${entry.winnerIndex}`
                    ];
                  const hasCrankAction =
                    entry.status === "processing" && !!onSimulateCrank;

                  return (
                    <tr
                      key={`${entry.drawCycleId}-${entry.tierIndex}-${index}`}
                      onClick={(e) => {
                        if (
                          (e.target as HTMLElement).closest(
                            "button, a, [data-prevent-row-click]"
                          )
                        ) {
                          return;
                        }
                        onViewDetails?.(entry);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          if (
                            (e.target as HTMLElement).closest(
                              "button, a, [data-prevent-row-click]"
                            )
                          ) {
                            return;
                          }
                          e.preventDefault();
                          onViewDetails?.(entry);
                        }
                      }}
                      tabIndex={0}
                      role="button"
                      aria-label={t("viewPrizeDetailsAria", {
                        drawCycleId: entry.drawCycleId,
                      })}
                      className="hover:bg-surface-container/40 transition-colors cursor-pointer group focus-visible:bg-surface-container/40 outline-none"
                    >
                      {/* Draw ID */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex h-8 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                          #{entry.drawCycleId}
                        </div>
                      </td>

                      {/* Date */}
                      <td
                        className="py-3.5 px-4 whitespace-nowrap text-on-surface font-medium"
                        suppressHydrationWarning
                      >
                        {formatDate(entry.date)}
                      </td>

                      {/* Tier Badge */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className={tierBadgeClass(entry.tierIndex)}>
                          {tierLabel(entry.tierIndex)}
                        </span>
                      </td>

                      {/* Amount Won */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right font-mono font-bold">
                        <span
                          className={
                            entry.tierIndex === 0
                              ? "text-amber-400"
                              : "text-on-surface"
                          }
                        >
                          {formatTokenAmount(entry.amount, tokenDecimals)}{" "}
                          <span className="text-[10px] text-on-surface-variant/60 font-normal ml-0.5">
                            {tokenSymbol}
                          </span>
                        </span>
                      </td>

                      {/* Status + Badges */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <div className="flex items-center gap-1.5 flex-nowrap">
                          <StatusBadge
                            status={entry.status}
                            isCranking={isCranking}
                            size="sm"
                          />
                          {entry.reinvestedTickets !== undefined &&
                            entry.reinvestedTickets > 0 && (
                              <BonusBondDustBadge
                                bondsBought={entry.reinvestedTickets}
                                amountWon={entry.amount}
                                bondPrice={ticketPrice || 5_000_000}
                                usedPriorDust={entry.usedPriorDust}
                                tokenDecimals={tokenDecimals}
                                tokenSymbol={tokenSymbol}
                                tooltipAlign="center"
                              />
                            )}
                          {entry.dustAccumulated !== undefined &&
                            entry.dustAccumulated > 0 && (
                              <div
                                data-prevent-row-click="true"
                                className="relative group/dust shrink-0"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <span className="inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant/40 px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant rounded-md cursor-help whitespace-nowrap">
                                  $
                                  {formatTokenAmount(
                                    entry.dustAccumulated,
                                    tokenDecimals
                                  )}{" "}
                                  dust
                                </span>
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 max-w-[calc(100vw-32px)] p-2.5 rounded-xl bg-[#0F111A] border border-surface-bright/10 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/dust:opacity-100 transition-opacity duration-200 shadow-xl z-50 text-center whitespace-normal">
                                  <strong className="text-tertiary block mb-0.5">
                                    {t("dustRemainder")}
                                  </strong>
                                  {t("dustRemainderDesc", {
                                    bondPrice: formatTokenAmount(
                                      ticketPrice,
                                      tokenDecimals
                                    ),
                                    symbol: tokenSymbol,
                                  })}
                                </div>
                              </div>
                            )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        <div className="inline-flex items-center justify-end gap-2.5 font-sans">
                          {hasCrankAction && (
                            <button
                              disabled={isCranking}
                              onClick={(e) => {
                                e.stopPropagation();
                                onSimulateCrank(
                                  entry.drawCycleId,
                                  entry.winnerIndex
                                );
                              }}
                              className={`rounded-lg px-2.5 py-1.5 text-xs font-bold transition flex items-center gap-1 shrink-0 ${
                                isCranking
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
                                  isCranking
                                    ? "duration-1000 text-on-surface-variant/40"
                                    : "duration-3000"
                                }`}
                              >
                                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
                              </svg>
                              {isCranking ? t("cranking") : t("runCrank")}
                            </button>
                          )}

                          {entry.vrfSeed && (
                            <VrfSeedBadge
                              seedHex={entry.vrfSeed}
                              drawCycleId={entry.drawCycleId}
                              variant={hasCrankAction ? "compact" : "default"}
                            />
                          )}

                          <div className="text-on-surface-variant/40 group-hover:text-primary transition-all duration-300 transform group-hover:translate-x-0.5 p-1 text-sm shrink-0">
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
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
