"use client";

import React, { useState, useMemo, useEffect } from "react";
import type { PrizeHistoryEntry } from "@/app/types";
import {
  formatTokenAmount,
  tierLabel,
  tierBadgeClass,
  formatLocalDate,
} from "@/app/lib/formatters";
import {
  getPayoutTimelockState,
  sortPrizeHistoryEntries,
} from "@/app/lib/draw-helpers";
import { useClusterTime } from "@/app/hooks/useOnChainClock";
import { PaginationControls } from "./PaginationControls";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { VrfSeedBadge } from "@/app/components/common/VrfSeedBadge";
import { exportToCsv } from "@/app/lib/export-utils";
import { useTranslations, useFormatter } from "next-intl";
import { CustomSelect } from "@/app/components/common/CustomSelect";
import { BonusBondDustBadge } from "@/app/components/common/BonusBondDustBadge";
import { RemainingWinningsBadge } from "@/app/components/common/RemainingWinningsBadge";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "@/app/components/draws/TimelockTooltipContent";

interface CompleteLedgerModalProps {
  entries: PrizeHistoryEntry[];
  isOpen: boolean;
  onClose: () => void;
  tokenDecimals: number;
  tokenSymbol: string;
  bondPrice?: number;
  /** @deprecated Use `bondPrice` */
  ticketPrice?: number;
  payoutTimelockSeconds?: number;
  pool?: { isFrozenForDraw?: boolean } | null;
  isFrozenForDraw?: boolean;
  onSimulateCrank: (drawCycleId: number, winnerIndex: number) => void;
  onViewDetails: (entry: PrizeHistoryEntry) => void;
  crankingCycles?: Record<string, boolean>;
  isLoading?: boolean;
}

export default function CompleteLedgerModal({
  entries,
  isOpen,
  onClose,
  tokenDecimals,
  tokenSymbol,
  bondPrice,
  ticketPrice = 5_000_000,
  payoutTimelockSeconds = 300,
  pool,
  isFrozenForDraw,
  onSimulateCrank,
  onViewDetails,
  crankingCycles = {},
  isLoading = false,
}: CompleteLedgerModalProps) {
  const t = useTranslations("Ledger");
  const format = useFormatter();
  const { now } = useClusterTime({ tick: true });

  const effectivePool =
    pool ?? (isFrozenForDraw !== undefined ? { isFrozenForDraw } : null);

  const effectiveBondPrice = bondPrice ?? ticketPrice;
  // Stateful Filtering
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

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

  // Close on Escape key press
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  const resetFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setTierFilter("all");
    setCurrentPage(1);
  };

  // Ensure entries are sorted once per prop change
  const sortedEntries = useMemo(
    () => sortPrizeHistoryEntries(entries),
    [entries]
  );

  // Filtered dataset computation: filter natively preserves sorted order
  const filteredEntries = useMemo(() => {
    return sortedEntries.filter((entry) => {
      // 1. Search Matching (Draw ID, Tx Signature, Ticket Seed, or Tier Label)
      const matchesSearch =
        searchTerm === "" ||
        entry.drawCycleId.toString().includes(searchTerm) ||
        entry.txSignature?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        entry.winningTicket?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tierLabel(entry.tierIndex)
          .toLowerCase()
          .includes(searchTerm.toLowerCase());

      // 2. Status Matching
      const matchesStatus =
        statusFilter === "all" || entry.status === statusFilter;

      // 3. Tier Matching
      const matchesTier =
        tierFilter === "all" ||
        (tierFilter === "grand" && entry.tierIndex === 0) ||
        (tierFilter === "runnerup" && entry.tierIndex === 1) ||
        (tierFilter === "consolation" && entry.tierIndex >= 2);

      return matchesSearch && matchesStatus && matchesTier;
    });
  }, [sortedEntries, searchTerm, statusFilter, tierFilter]);

  // Aggregate stats across matching records
  const totalCount = filteredEntries.length;
  const totalValue = useMemo(() => {
    return filteredEntries.reduce((sum, entry) => sum + entry.amount, 0);
  }, [filteredEntries]);

  // Safe page clamping
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));

  const paginatedEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredEntries.slice(start, start + pageSize);
  }, [filteredEntries, safePage, pageSize]);

  const handleExportCSV = () => {
    if (filteredEntries.length === 0) return;

    const headers = [
      "Draw Cycle",
      "Date",
      "Winner Index",
      "Tier Index",
      "Tier Name",
      "Amount Won (USDC Base Units)",
      "Status",
      "Winning Bond Seed",
      "Tx Signature",
    ];

    const rows = filteredEntries.map((e) => [
      e.drawCycleId,
      e.date,
      e.winnerIndex,
      e.tierIndex,
      tierLabel(e.tierIndex),
      e.amount,
      e.status,
      e.winningTicket || "",
      e.txSignature || "",
    ]);

    exportToCsv(`premium_bonds_prizes_export_${Date.now()}`, headers, rows);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("modalTitle")}
        className="relative w-full max-w-5xl 2xl:max-w-6xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-4 sm:p-6 shadow-ambient z-10 overflow-hidden flex flex-col h-[85vh] glass-strong"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-surface-bright/5 shrink-0">
          <div>
            <h3 className="text-xl font-bold font-display text-on-surface">
              {t("modalTitle")}
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              {t("modalSubtitle")}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
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

        {/* Filter bar: 2-column on mobile/tablet, 4-column on desktop */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 py-3 border-b border-surface-bright/5 shrink-0">
          {/* Search: Full width on mobile/tablet */}
          <div className="relative col-span-2 lg:col-span-1">
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              disabled={isLoading}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 pl-9 pr-4 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed"
            />
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant/40"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
          </div>

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
              options={[
                { value: "all", label: t("allTiers") },
                { value: "grand", label: t("grandPrize") },
                { value: "runnerup", label: t("runnerUp") },
                { value: "consolation", label: t("consolation") },
              ]}
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
            <button
              onClick={handleExportCSV}
              disabled={isLoading || filteredEntries.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-surface-bright/15 hover:bg-surface-bright/5 disabled:opacity-40 disabled:cursor-not-allowed text-on-surface font-semibold text-xs px-3.5 py-2 transition cursor-pointer"
            >
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
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              {t("exportCSV")}
            </button>
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
                  {formatTokenAmount(totalValue, tokenDecimals)} {tokenSymbol}
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
              className="flex-1 min-h-0 flex flex-col space-y-3 pointer-events-none select-none"
              aria-hidden="true"
            >
              {/* Mobile/Tablet Skeleton Cards (< lg) */}
              <div className="lg:hidden flex-1 overflow-y-auto space-y-3 pr-1">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl skeleton-card space-y-3"
                  >
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
                        <td className="py-3 px-3">
                          <div className="h-4 w-24 rounded skeleton-box" />
                        </td>
                        <td className="py-3 px-3">
                          <div className="h-5 w-20 rounded-full skeleton-box" />
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
          ) : filteredEntries.length === 0 ? (
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
            <div className="flex-1 min-h-0 flex flex-col">
              {/* ── Mobile & Tablet Card Layout (< lg) ─────────────────── */}
              <div className="lg:hidden flex-1 overflow-y-auto space-y-3 pr-1">
                {paginatedEntries.map((entry) => {
                  const isCranking =
                    !!crankingCycles[
                      `${entry.drawCycleId}-${entry.winnerIndex}`
                    ];
                  const entryTimelock = getPayoutTimelockState(
                    entry.revealedAt,
                    payoutTimelockSeconds,
                    now
                  );
                  const isEntryTimelocked =
                    entry.status === "processing" && entryTimelock.isTimelocked;

                  return (
                    <div
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
                              {formatDateOnly(entry.date)}{" "}
                              <span className="text-[10px] text-on-surface-variant/60 font-mono font-normal">
                                {formatTimeOnly(entry.date)}
                              </span>
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
                                  tokenDecimals={tokenDecimals}
                                  tokenSymbol={tokenSymbol}
                                  tooltipAlign="center"
                                />
                              )}
                            {entry.dustAccumulated !== undefined &&
                              entry.dustAccumulated > 0 && (
                                <RemainingWinningsBadge
                                  amount={entry.dustAccumulated}
                                  tokenDecimals={tokenDecimals}
                                  tokenSymbol={tokenSymbol}
                                  bondPrice={effectiveBondPrice}
                                  tooltipAlign="center"
                                />
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
                            entry.status === "processing" && (
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
                            )
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewDetails(entry);
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
                        className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 whitespace-nowrap"
                      >
                        {t("date")}
                      </th>
                      <th
                        scope="col"
                        className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-3 whitespace-nowrap"
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
                    {paginatedEntries.map((entry) => {
                      const isCranking =
                        !!crankingCycles[
                          `${entry.drawCycleId}-${entry.winnerIndex}`
                        ];
                      const entryTimelock = getPayoutTimelockState(
                        entry.revealedAt,
                        payoutTimelockSeconds,
                        now
                      );
                      const isEntryTimelocked =
                        entry.status === "processing" &&
                        entryTimelock.isTimelocked;
                      const hasCrankAction =
                        entry.status === "processing" && !isEntryTimelocked;

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
                            <span className={tierBadgeClass(entry.tierIndex)}>
                              {tierLabel(entry.tierIndex)}
                            </span>
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
                              {formatTokenAmount(entry.amount, tokenDecimals)}{" "}
                              <span className="text-[10px] text-on-surface-variant/60 font-normal ml-0.5">
                                {tokenSymbol}
                              </span>
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
                                    tokenDecimals={tokenDecimals}
                                    tokenSymbol={tokenSymbol}
                                    tooltipAlign="center"
                                  />
                                )}
                              {entry.dustAccumulated !== undefined &&
                                entry.dustAccumulated > 0 && (
                                  <RemainingWinningsBadge
                                    amount={entry.dustAccumulated}
                                    tokenDecimals={tokenDecimals}
                                    tokenSymbol={tokenSymbol}
                                    bondPrice={effectiveBondPrice}
                                    tooltipAlign="center"
                                  />
                                )}
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
            </div>
          )}
        </div>

        {/* Pagination Controls */}
        <div className="border-t border-surface-bright/5 pt-3 shrink-0">
          <PaginationControls
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={filteredEntries.length}
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
      </div>
    </div>
  );
}
