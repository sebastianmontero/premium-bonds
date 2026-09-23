"use client";

import React, { useState, useEffect, useMemo } from "react";
import type {
  PrizeHistoryEntry,
  DrawDisplayConfig,
  PoolInfo,
} from "@/app/types";
import {
  formatCurrency,
  formatLocalDate,
  formatTicketNumber,
} from "@/app/lib/formatters";
import { TierBadge } from "@/app/components/common/TierBadge";
import {
  getPayoutTimelockState,
  getEffectivePrizeDust,
} from "@/app/lib/draw-helpers";
import { useClusterTime } from "@/app/hooks/useOnChainClock";
import { PaginationControls } from "./PaginationControls";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { VrfSeedBadge } from "@/app/components/common/VrfSeedBadge";
import { useTranslations, useFormatter } from "next-intl";
import { useTierLabel } from "@/app/hooks/useTierLabel";
import { CustomSelect } from "@/app/components/common/CustomSelect";
import { BonusBondDustBadge } from "@/app/components/common/BonusBondDustBadge";
import { RemainingWinningsBadge } from "@/app/components/common/RemainingWinningsBadge";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "@/app/components/draws/TimelockTooltipContent";
import { useUserPrizeLedger } from "@/app/hooks/useUserPrizeLedger";
import { useCrankPrize } from "@/app/hooks/mutations/useCrankPrize";
import { AdaptiveModal } from "@/app/components/common/AdaptiveModal";
import { SearchInput } from "@/app/components/common/SearchInput";

export interface CompleteLedgerModalProps {
  userAddress?: string;
  poolId?: number;
  isOpen: boolean;
  onClose: () => void;
  config?: DrawDisplayConfig;
  tokenDecimals?: number;
  tokenSymbol?: string;
  bondPrice?: number;
  /** @deprecated Use `bondPrice` */
  ticketPrice?: number;
  payoutTimelockSeconds?: number;
  unclaimedDust?: number;
  pool?:
    | PoolInfo
    | { isFrozenForDraw?: boolean; prizeTiers?: PoolInfo["prizeTiers"] }
    | null;
  isFrozenForDraw?: boolean;
  onSimulateCrank?: (drawCycleId: number, winnerIndex: number) => void;
  onViewDetails: (entry: PrizeHistoryEntry) => void;
  crankingCycles?: Record<string, boolean>;
  isLoading?: boolean;
  /** @deprecated Fallback entries if unconnected */
  entries?: PrizeHistoryEntry[];
}

export default function CompleteLedgerModal({
  userAddress,
  poolId = 1,
  isOpen,
  onClose,
  config,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  bondPrice,
  ticketPrice = 5_000_000,
  payoutTimelockSeconds = 300,
  pool,
  isFrozenForDraw,
  onSimulateCrank,
  onViewDetails,
  crankingCycles = {},
  isLoading: initialLoading = false,
  entries: fallbackEntries = [],
}: CompleteLedgerModalProps) {
  const t = useTranslations("Ledger");
  const getTierLabel = useTierLabel();
  const format = useFormatter();
  const { now } = useClusterTime({ tick: true });
  const effectiveDecimals = config?.tokenDecimals ?? tokenDecimals;
  const effectiveSymbol = config?.tokenSymbol ?? tokenSymbol;
  const effectiveBondPrice = config?.bondPrice ?? bondPrice ?? ticketPrice;
  const effectiveTimelockSeconds =
    config?.payoutTimelockSeconds ?? payoutTimelockSeconds;

  const effectivePool =
    pool ?? (isFrozenForDraw !== undefined ? { isFrozenForDraw } : null);

  // Stateful Filtering
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Debounce search term by 300ms to prevent query storms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  // Query server-side paginated winners
  const {
    entries: serverEntries,
    pagination,
    aggregates,
    isLoading: isQueryLoading,
    isFetching,
    isPlaceholderData,
  } = useUserPrizeLedger({
    userAddress,
    poolId,
    page: currentPage,
    pageSize,
    status: statusFilter,
    tierIndex: tierFilter === "all" ? undefined : Number(tierFilter),
    search: debouncedSearchTerm,
    enabled: isOpen && Boolean(userAddress),
  });

  const crankPrizeMutation = useCrankPrize(poolId);

  // Effective entries: server entries when userAddress is present, else client-side filtered fallback entries
  const displayEntries = userAddress ? serverEntries : fallbackEntries;
  const totalCount = userAddress
    ? pagination.totalCount
    : fallbackEntries.length;
  const totalPages = userAddress ? pagination.totalPages : 1;
  const totalValue = userAddress
    ? Number(aggregates.totalFilteredValue)
    : displayEntries.reduce((sum, e) => sum + (e.amount || 0), 0);
  const isLoading = initialLoading || (Boolean(userAddress) && isQueryLoading);

  const tierOptions = useMemo(() => {
    const opts = [{ value: "all", label: t("allTiers") }];
    const count = pool?.prizeTiers?.length ?? 3;
    for (let i = 0; i < count; i++) {
      opts.push({
        value: String(i),
        label: getTierLabel(i, { format: "full" }),
      });
    }
    return opts;
  }, [pool?.prizeTiers, getTierLabel, t]);

  const formatDateOnly = (isoDate: string): string => {
    return formatLocalDate(
      isoDate,
      {
        month: "short",
        day: "numeric",
        year: "numeric",
        includeTimeIfPresent: false,
      },
      format.dateTime
    );
  };

  const formatTimeOnly = (isoDate: string): string => {
    return formatLocalDate(
      isoDate,
      { hour: "2-digit", minute: "2-digit", hour12: true },
      format.dateTime
    );
  };

  const resetFilters = () => {
    setSearchTerm("");
    setDebouncedSearchTerm("");
    setStatusFilter("all");
    setTierFilter("all");
    setCurrentPage(1);
  };

  const handleCrank = async (entry: PrizeHistoryEntry) => {
    if (onSimulateCrank) {
      onSimulateCrank(entry.drawCycleId, entry.winnerIndex);
      return;
    }
    try {
      await crankPrizeMutation.mutateAsync({
        entry,
        bondPrice: effectiveBondPrice,
      });
    } catch {
      // Error handled by mutation runner
    }
  };

  return (
    <AdaptiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("modalTitle")}
      subtitle={t("modalSubtitle")}
      size="xl"
      height="tall"
      scrollable={false}
    >
      {/* Off-screen live status announcement for screen readers */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {!isFetching &&
          (totalCount === 0
            ? t("noDrawsFound")
            : `${totalCount} entries loaded, page ${currentPage} of ${totalPages}`)}
      </div>

      {/* Filter bar */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 py-3 border-b border-surface-bright/5 shrink-0">
        {/* Search */}
        <SearchInput
          containerClassName="col-span-2 lg:col-span-1"
          placeholder={t("searchPlaceholder")}
          value={searchTerm}
          disabled={isLoading}
          onChange={(val) => {
            setSearchTerm(val);
            setCurrentPage(1);
          }}
          onClear={() => {
            setSearchTerm("");
            setCurrentPage(1);
          }}
        />

        {/* Status Dropdown */}
        <div className="col-span-1 flex items-center">
          <CustomSelect
            value={statusFilter}
            disabled={isLoading}
            onChange={(val) => {
              setStatusFilter(val);
              setCurrentPage(1);
            }}
            options={[
              { value: "all", label: t("allStatuses") },
              { value: "processing", label: t("processing") },
              { value: "reinvested", label: t("reinvested") },
            ]}
            ariaLabel="Filter ledger by status"
            className="w-full"
          />
        </div>

        {/* Tier Dropdown */}
        <div className="col-span-1 flex items-center">
          <CustomSelect
            value={tierFilter}
            disabled={isLoading}
            onChange={(val) => {
              setTierFilter(val);
              setCurrentPage(1);
            }}
            options={tierOptions}
            ariaLabel="Filter ledger by tier"
            className="w-full"
          />
        </div>

        {/* Action Row */}
        <div className="col-span-2 lg:col-span-1 flex gap-2 justify-end items-center">
          {(searchTerm || statusFilter !== "all" || tierFilter !== "all") && (
            <button
              onClick={resetFilters}
              disabled={isLoading}
              className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("clear")}
            </button>
          )}
        </div>
      </div>

      {/* Aggregate Stats Summary */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5 py-2.5 px-4 bg-surface-container/10 border-b border-surface-bright/5 text-xs text-on-surface-variant shrink-0">
        <div className="flex items-center gap-6 flex-wrap">
          <div>
            {t("matchingEntries")}{" "}
            {isLoading ? (
              <span className="inline-block h-3.5 w-8 rounded bg-surface-bright/10 animate-pulse align-middle" />
            ) : (
              <span className="font-mono text-on-surface font-bold">
                {totalCount}
              </span>
            )}
          </div>
          <div>
            {t("totalFilteredValue")}{" "}
            {isLoading ? (
              <span className="inline-block h-3.5 w-20 rounded bg-surface-bright/10 animate-pulse align-middle" />
            ) : (
              <span className="font-mono text-primary font-bold">
                {formatCurrency(totalValue, {
                  tokenSymbol: effectiveSymbol,
                  decimals: effectiveDecimals,
                })}
              </span>
            )}
          </div>
        </div>
        <div className="text-[10px] text-on-surface-variant/60 font-semibold uppercase tracking-wider">
          {t("drawHistoryAudit")}
        </div>
      </div>

      {/* Content area: Mobile card scroll & Desktop table scroll */}
      <div className="flex-1 min-h-0 flex flex-col p-2">
        {isLoading ? (
          <div
            className="flex-1 min-h-0 flex flex-col space-y-3 select-none"
            aria-hidden="true"
          >
            {/* Mobile/Tablet Skeleton Cards (< lg) */}
            <div className="lg:hidden flex-1 overflow-y-auto space-y-3 pr-1">
              {[1, 2, 3, 4].map((i) => (
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

            {/* Desktop Table Skeleton (>= lg) */}
            <div className="hidden lg:block flex-1 min-h-0 overflow-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
              <table className="w-full min-w-[750px] text-left text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-[#12141F] text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 w-16">
                      {t("draw")}
                    </th>
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 text-center whitespace-nowrap">
                      {t("winningBond")}
                    </th>
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3">
                      {t("date")}
                    </th>
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3">
                      {t("tier")}
                    </th>
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 text-right">
                      {t("amountWon")}
                    </th>
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3">
                      {t("status")}
                    </th>
                    <th className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3.5 text-right">
                      {t("actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-bright/5">
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <tr key={i} className="p-4">
                      <td className="py-3 px-3">
                        <div className="h-8 w-11 rounded-lg skeleton-box" />
                      </td>
                      <td className="py-3 px-3 text-center">
                        <div className="h-5 w-16 rounded-md skeleton-box mx-auto" />
                      </td>
                      <td className="py-3 px-3">
                        <div className="h-4 w-24 rounded skeleton-box" />
                      </td>
                      <td className="py-3 px-3">
                        <div className="h-5 w-24 rounded-full skeleton-box" />
                      </td>
                      <td className="py-3 px-3 text-right">
                        <div className="h-4 w-24 rounded skeleton-box ml-auto" />
                      </td>
                      <td className="py-3 px-3">
                        <div className="h-5 w-28 rounded-full skeleton-box" />
                      </td>
                      <td className="py-3 px-3.5 text-right">
                        <div className="h-8 w-24 rounded-lg skeleton-box ml-auto" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : displayEntries.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-12 text-center border border-dashed border-surface-bright/10 rounded-2xl bg-[#08090E]/40">
            <svg
              className="w-10 h-10 text-on-surface-variant/20 mb-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h4 className="text-sm font-semibold text-on-surface">
              {t("noDrawsFound")}
            </h4>
            <p className="text-xs text-on-surface-variant max-w-xs mt-1 leading-relaxed">
              {t("noDrawsSub")}
            </p>
            <button
              onClick={resetFilters}
              className="mt-4 rounded-xl bg-primary hover:bg-primary-hover text-surface-container font-semibold text-xs px-4 py-2 transition cursor-pointer"
            >
              {t("clear")}
            </button>
          </div>
        ) : (
          <div
            className={`flex-1 min-h-0 flex flex-col ${
              isPlaceholderData ? "opacity-60 transition-opacity" : ""
            }`}
          >
            {/* ── Mobile & Tablet Card Layout (< lg) ─────────────────── */}
            <div className="lg:hidden flex-1 overflow-y-auto space-y-3 pr-1">
              {displayEntries.map((entry) => {
                const isCranking =
                  !!crankingCycles[
                    `${entry.drawCycleId}-${entry.winnerIndex}`
                  ] ||
                  (crankPrizeMutation.isPending &&
                    crankPrizeMutation.variables?.entry.drawCycleId ===
                      entry.drawCycleId &&
                    crankPrizeMutation.variables?.entry.winnerIndex ===
                      entry.winnerIndex);

                const entryTimelock = getPayoutTimelockState(
                  entry.revealedAt,
                  effectiveTimelockSeconds,
                  now
                );
                const isEntryTimelocked =
                  entry.status === "processing" && entryTimelock.isTimelocked;

                return (
                  <div
                    key={`${entry.drawCycleId}-${entry.winnerIndex}`}
                    className="p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-primary/20 hover:bg-surface-container/50 hover:shadow-ambient hover:-translate-y-0.5 transition-all duration-300 space-y-3 group"
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
                            {formatDateOnly(entry.date)}{" "}
                            <span className="text-[10px] text-on-surface-variant/60 font-mono font-normal">
                              {formatTimeOnly(entry.date)}
                            </span>
                          </p>
                          <p className="text-[10px] text-on-surface-variant/60 uppercase tracking-wider font-semibold flex items-center gap-1.5">
                            <span>{t("date")}</span>
                            {entry.winningTicket && (
                              <>
                                <span className="text-on-surface-variant/30">
                                  •
                                </span>
                                <span className="inline-flex items-center gap-1 font-mono text-primary font-bold normal-case">
                                  <span aria-hidden="true">🎫</span>
                                  <span>
                                    {formatTicketNumber(entry.winningTicket)}
                                  </span>
                                </span>
                              </>
                            )}
                          </p>
                        </div>
                      </div>
                      <TierBadge tierIndex={entry.tierIndex} />
                    </div>

                    {/* Tier 2: Amount Won & Status Metrics */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg bg-surface-container/40 border border-surface-bright/5">
                      <div>
                        <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                          {t("amountWon")}
                        </p>
                        <p
                          className={`font-mono text-sm font-bold mt-0.5 ${entry.tierIndex === 0 ? "text-amber-400" : "text-on-surface"}`}
                        >
                          {formatCurrency(entry.amount, {
                            tokenSymbol: effectiveSymbol,
                            decimals: effectiveDecimals,
                          })}
                        </p>
                      </div>

                      <div>
                        <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                          {t("status")}
                        </p>
                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                          {isEntryTimelocked ? (
                            <InteractiveTooltip
                              ariaLabel={t("timelocked")}
                              align="center"
                              side="top"
                              triggerClassName="inline-flex p-0"
                              panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                              content={
                                <TimelockTooltipContent
                                  timelock={entryTimelock}
                                />
                              }
                            >
                              <StatusBadge
                                status="timelocked"
                                isCranking={isCranking}
                                size="sm"
                                className="cursor-help"
                              />
                            </InteractiveTooltip>
                          ) : (
                            <StatusBadge
                              status={entry.status}
                              isCranking={isCranking}
                              size="sm"
                            />
                          )}
                          {entry.reinvestedTickets !== undefined &&
                            entry.reinvestedTickets > 0 && (
                              <BonusBondDustBadge
                                bondsBought={entry.reinvestedTickets}
                                amountWon={entry.amount}
                                bondPrice={effectiveBondPrice}
                                usedPriorDust={entry.usedPriorDust}
                                tokenDecimals={effectiveDecimals}
                                tokenSymbol={effectiveSymbol}
                                tooltipAlign="center"
                              />
                            )}
                          {(() => {
                            const effectiveDust = getEffectivePrizeDust(
                              entry,
                              effectiveBondPrice
                            );
                            return effectiveDust !== undefined &&
                              effectiveDust > 0 ? (
                              <RemainingWinningsBadge
                                amount={effectiveDust}
                                tokenDecimals={effectiveDecimals}
                                tokenSymbol={effectiveSymbol}
                                bondPrice={effectiveBondPrice}
                                tooltipAlign="center"
                              />
                            ) : null;
                          })()}
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
                        {isEntryTimelocked ? (
                          <InteractiveTooltip
                            ariaLabel={`Crank locked: ${t("timelockTooltip", { remaining: entryTimelock.formattedRemaining })}`}
                            align="right"
                            side="bottom"
                            triggerClassName="inline-flex p-0"
                            panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                            content={
                              <TimelockTooltipContent
                                timelock={entryTimelock}
                              />
                            }
                          >
                            <span
                              aria-disabled="true"
                              className="rounded-lg px-2.5 py-1.5 text-xs font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/80 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0"
                            >
                              <span>🔒</span> {entryTimelock.formattedRemaining}
                            </span>
                          </InteractiveTooltip>
                        ) : effectivePool?.isFrozenForDraw ? (
                          <InteractiveTooltip
                            ariaLabel={t("frozenCrankTooltip")}
                            align="right"
                            side="top"
                            triggerClassName="inline-flex"
                            panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                            content={
                              <p className="text-xs leading-relaxed text-amber-200">
                                {t("frozenCrankTooltip")}
                              </p>
                            }
                          >
                            <span
                              aria-disabled="true"
                              className="rounded-lg px-2.5 py-1.5 text-xs font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/60 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0"
                            >
                              <span>⏸️</span> {t("frozenDrawStatus")}
                            </span>
                          </InteractiveTooltip>
                        ) : (
                          entry.status === "processing" && (
                            <button
                              disabled={isCranking}
                              onClick={() => handleCrank(entry)}
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
                          )
                        )}

                        <button
                          onClick={() => onViewDetails(entry)}
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

            {/* ── Desktop Semantic Table Layout (>= lg) ─────────────────── */}
            <div className="hidden lg:block flex-1 min-h-0 overflow-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
              <table className="w-full min-w-[750px] text-left text-xs border-separate border-spacing-0">
                <thead>
                  <tr className="bg-[#12141F] text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 w-16"
                    >
                      {t("draw")}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 text-center whitespace-nowrap"
                    >
                      {t("winningBond")}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 whitespace-nowrap"
                    >
                      {t("date")}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 w-28 min-w-[110px] whitespace-nowrap"
                    >
                      {t("tier")}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 text-right whitespace-nowrap"
                    >
                      {t("amountWon")}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 whitespace-nowrap"
                    >
                      {t("status")}
                    </th>
                    <th
                      scope="col"
                      className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3.5 text-right whitespace-nowrap"
                    >
                      {t("actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-bright/5 font-medium text-on-surface">
                  {displayEntries.map((entry) => {
                    const isCranking =
                      !!crankingCycles[
                        `${entry.drawCycleId}-${entry.winnerIndex}`
                      ] ||
                      (crankPrizeMutation.isPending &&
                        crankPrizeMutation.variables?.entry.drawCycleId ===
                          entry.drawCycleId &&
                        crankPrizeMutation.variables?.entry.winnerIndex ===
                          entry.winnerIndex);

                    const entryTimelock = getPayoutTimelockState(
                      entry.revealedAt,
                      effectiveTimelockSeconds,
                      now
                    );
                    const isEntryTimelocked =
                      entry.status === "processing" &&
                      entryTimelock.isTimelocked;
                    const hasCrankAction =
                      entry.status === "processing" &&
                      (!!onSimulateCrank || !!crankPrizeMutation);

                    return (
                      <tr
                        key={`${entry.drawCycleId}-${entry.winnerIndex}`}
                        onClick={(e) => {
                          if (
                            (e.target as HTMLElement).closest(
                              "button, a, [data-prevent-row-click]"
                            )
                          ) {
                            return;
                          }
                          onViewDetails(entry);
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
                            onViewDetails(entry);
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
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex h-8 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                            #{entry.drawCycleId}
                          </div>
                        </td>

                        {/* Winning Bond */}
                        <td className="py-3 px-3 whitespace-nowrap text-center">
                          {entry.winningTicket ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold font-mono bg-primary/15 border border-primary/40 text-primary shadow-xs">
                              <span aria-hidden="true">🎫</span>
                              <span>
                                {formatTicketNumber(entry.winningTicket)}
                              </span>
                            </span>
                          ) : (
                            <span className="text-on-surface-variant/40">
                              —
                            </span>
                          )}
                        </td>

                        {/* Date */}
                        <td
                          className="py-3 px-3 whitespace-nowrap text-on-surface font-medium"
                          suppressHydrationWarning
                        >
                          <div className="flex flex-col">
                            <span className="text-xs text-on-surface font-medium">
                              {formatDateOnly(entry.date)}
                            </span>
                            <span className="text-[10px] text-on-surface-variant/70 font-mono">
                              {formatTimeOnly(entry.date)}
                            </span>
                          </div>
                        </td>

                        {/* Tier Badge */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <TierBadge tierIndex={entry.tierIndex} />
                        </td>

                        {/* Amount Won */}
                        <td className="py-3 px-3 whitespace-nowrap text-right font-mono font-bold">
                          <span
                            className={
                              entry.tierIndex === 0
                                ? "text-amber-400"
                                : "text-on-surface"
                            }
                          >
                            {formatCurrency(entry.amount, {
                              tokenSymbol: effectiveSymbol,
                              decimals: effectiveDecimals,
                            })}
                          </span>
                        </td>

                        {/* Status + Badges */}
                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex flex-wrap items-center gap-1.5 max-w-[220px]">
                            {isEntryTimelocked ? (
                              <InteractiveTooltip
                                ariaLabel={t("timelocked")}
                                align="center"
                                side="top"
                                triggerClassName="inline-flex p-0"
                                panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                                content={
                                  <TimelockTooltipContent
                                    timelock={entryTimelock}
                                  />
                                }
                              >
                                <StatusBadge
                                  status="timelocked"
                                  isCranking={isCranking}
                                  size="sm"
                                  className="cursor-help"
                                />
                              </InteractiveTooltip>
                            ) : (
                              <StatusBadge
                                status={entry.status}
                                isCranking={isCranking}
                                size="sm"
                              />
                            )}
                            {entry.reinvestedTickets !== undefined &&
                              entry.reinvestedTickets > 0 && (
                                <BonusBondDustBadge
                                  bondsBought={entry.reinvestedTickets}
                                  amountWon={entry.amount}
                                  bondPrice={effectiveBondPrice}
                                  usedPriorDust={entry.usedPriorDust}
                                  tokenDecimals={effectiveDecimals}
                                  tokenSymbol={effectiveSymbol}
                                  tooltipAlign="center"
                                />
                              )}
                            {(() => {
                              const effectiveDust = getEffectivePrizeDust(
                                entry,
                                effectiveBondPrice
                              );
                              return effectiveDust !== undefined &&
                                effectiveDust > 0 ? (
                                <RemainingWinningsBadge
                                  amount={effectiveDust}
                                  tokenDecimals={effectiveDecimals}
                                  tokenSymbol={effectiveSymbol}
                                  bondPrice={effectiveBondPrice}
                                  tooltipAlign="center"
                                />
                              ) : null;
                            })()}
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-3 px-3.5 whitespace-nowrap text-right">
                          <div className="inline-flex items-center justify-end gap-2 font-sans">
                            {isEntryTimelocked ? (
                              <InteractiveTooltip
                                ariaLabel={`Crank locked: ${t("timelockTooltip", { remaining: entryTimelock.formattedRemaining })}`}
                                align="right"
                                side="bottom"
                                triggerClassName="inline-flex p-0"
                                panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                                content={
                                  <TimelockTooltipContent
                                    timelock={entryTimelock}
                                  />
                                }
                              >
                                <span
                                  aria-disabled="true"
                                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/80 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0"
                                >
                                  <span>🔒</span>{" "}
                                  {entryTimelock.formattedRemaining}
                                </span>
                              </InteractiveTooltip>
                            ) : effectivePool?.isFrozenForDraw ? (
                              <InteractiveTooltip
                                ariaLabel={t("frozenCrankTooltip")}
                                align="right"
                                side="top"
                                triggerClassName="inline-flex"
                                panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                                content={
                                  <p className="text-xs leading-relaxed text-amber-200">
                                    {t("frozenCrankTooltip")}
                                  </p>
                                }
                              >
                                <span
                                  aria-disabled="true"
                                  className="rounded-lg px-2.5 py-1.5 text-xs font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/60 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0"
                                >
                                  <span>⏸️</span> {t("frozenDrawStatus")}
                                </span>
                              </InteractiveTooltip>
                            ) : (
                              hasCrankAction && (
                                <button
                                  disabled={isCranking}
                                  onClick={() => handleCrank(entry)}
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
                              )
                            )}

                            {entry.vrfSeed && (
                              <VrfSeedBadge
                                seedHex={entry.vrfSeed}
                                drawCycleId={entry.drawCycleId}
                                variant="compact"
                                tooltipAlign="right"
                              />
                            )}

                            <button
                              onClick={() => onViewDetails(entry)}
                              aria-label={t("viewPrizeDetailsAria", {
                                drawCycleId: entry.drawCycleId,
                              })}
                              className="text-on-surface-variant/60 hover:text-primary transition-all duration-300 transform hover:translate-x-0.5 p-1 text-sm shrink-0 cursor-pointer"
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
                              >
                                <path d="M5 12h14M12 5l7 7-7 7" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Pagination Controls */}
      <div className="border-t border-surface-bright/5 pt-3 shrink-0">
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          totalItems={totalCount}
          pageSize={pageSize}
          onPageChange={(page) => setCurrentPage(page)}
          onPageSizeChange={(newSize) => {
            setPageSize(newSize);
            setCurrentPage(1);
          }}
          variant="full"
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-4 border-t border-surface-bright/5 shrink-0 mt-auto">
        <p className="text-[10px] text-on-surface-variant/40 uppercase tracking-wider font-semibold">
          {t("cryptographicLedgersFooter")}
        </p>
        <button
          onClick={onClose}
          className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-5 py-2.5 transition cursor-pointer"
        >
          {t("close")}
        </button>
      </div>
    </AdaptiveModal>
  );
}
