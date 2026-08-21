"use client";

import React, { useState, useMemo } from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import {
  formatDrawDisplayDate,
  hasDrawVrfRandomness,
  buildDrawStatusOptions,
  getPayoutTimelockState,
} from "@/app/lib/draw-helpers";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { VrfSeedBadge } from "@/app/components/common/VrfSeedBadge";
import { CustomSelect } from "@/app/components/common/CustomSelect";
import { PaginationControls } from "@/app/components/common/PaginationControls";
import { useClusterTime } from "@/app/hooks/useOnChainClock";
import type { DrawCycleSummary } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawHistoryListProps {
  draws: DrawCycleSummary[];
  onSelectDraw: (cycleId: number) => void;
  tokenDecimals?: number;
  tokenSymbol?: string;
  payoutTimelockSeconds?: number;
  isLoading?: boolean;
  isSyncing?: boolean;
}

export function DrawHistoryList({
  draws,
  onSelectDraw,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  payoutTimelockSeconds = 300,
  isLoading = false,
  isSyncing = false,
}: DrawHistoryListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const t = useTranslations("DrawHistory");
  const { now } = useClusterTime({ tick: true });

  const statusOptions = useMemo(() => {
    return buildDrawStatusOptions(draws, t);
  }, [draws, t]);

  // Derive the effective status filter during render without triggering cascading re-renders
  const effectiveStatusFilter = useMemo(() => {
    if (statusFilter === "all") return "all";
    const exists = statusOptions.some((opt) => opt.value === statusFilter);
    return exists ? statusFilter : "all";
  }, [statusOptions, statusFilter]);

  const resetFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setCurrentPage(1);
  };

  const filteredDraws = useMemo(() => {
    return draws.filter((draw) => {
      // 1. Search matching (strictly by cycle #, sanitizing prefixes like # or draw #)
      const cleaned = searchTerm
        .trim()
        .toLowerCase()
        .replace(/^draw\s*#?/i, "")
        .replace(/^#/, "")
        .trim();
      const matchesSearch =
        cleaned === "" || draw.cycleId.toString().includes(cleaned);

      // 2. Status matching (matches exact status or top-level 'Halted' matching any circuit breaker)
      const matchesStatus =
        effectiveStatusFilter === "all" ||
        draw.status === effectiveStatusFilter ||
        (effectiveStatusFilter === "Halted" &&
          draw.status.startsWith("Halted"));

      return matchesSearch && matchesStatus;
    });
  }, [draws, searchTerm, effectiveStatusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredDraws.length / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));

  const paginatedDraws = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredDraws.slice(start, start + pageSize);
  }, [filteredDraws, safePage, pageSize]);

  const formatDate = (draw: DrawCycleSummary): string => {
    return formatDrawDisplayDate(draw, undefined, {
      estimatedPrefix: t("estimatedPrefix"),
    });
  };

  return (
    <div className="glass rounded-2xl p-4 sm:p-6 space-y-5">
      {/* ── Header & Toolbar ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-lg font-bold text-on-surface">
              {t("listTitle")}
            </h2>
            {(isLoading || isSyncing) && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary animate-pulse">
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-spin" />
                {t("syncing")}
              </span>
            )}
          </div>
          <p className="text-xs text-on-surface-variant mt-0.5">
            {t("listSubtitle")}
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-48 md:w-56">
            <input
              type="text"
              placeholder={t("searchPlaceholder")}
              value={searchTerm}
              disabled={isLoading}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 pl-8 pr-3 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none"
            />
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-on-surface-variant/40"
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

          {/* Status Filter */}
          <div className="w-full sm:w-52 md:w-60">
            <CustomSelect
              value={effectiveStatusFilter}
              disabled={isLoading}
              onChange={(val) => {
                setStatusFilter(val);
                setCurrentPage(1);
              }}
              options={statusOptions}
              align="right"
              ariaLabel="Filter draws by status"
            />
          </div>

          {(searchTerm || effectiveStatusFilter !== "all") && (
            <button
              onClick={resetFilters}
              className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 py-1 cursor-pointer self-end sm:self-center"
            >
              {t("clear")}
            </button>
          )}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3 pointer-events-none select-none">
          {/* Mobile Skeleton Cards */}
          <div className="lg:hidden space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-4 rounded-xl skeleton-card space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-11 rounded-lg skeleton-box" />
                    <div className="h-4 w-24 rounded skeleton-box" />
                  </div>
                  <div className="h-5 w-20 rounded-full skeleton-box" />
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-surface-container/20">
                  <div className="col-span-2 sm:col-span-1 h-8 rounded skeleton-box" />
                  <div className="h-8 rounded skeleton-box" />
                  <div className="h-8 rounded skeleton-box" />
                </div>
                <div className="flex items-center justify-between pt-1">
                  <div className="h-5 w-28 rounded-lg skeleton-box" />
                  <div className="h-4 w-20 rounded skeleton-box" />
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Skeleton Table */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
            <table className="w-full min-w-[920px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-bright/10 bg-surface-container/40 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4 w-20">{t("colDraw")}</th>
                  <th className="py-3.5 px-4">{t("colDate")}</th>
                  <th className="py-3.5 px-4">{t("colStatus")}</th>
                  <th className="py-3.5 px-4 text-right">{t("colPrizePot")}</th>
                  <th className="py-3.5 px-4 text-center">{t("colBonds")}</th>
                  <th className="py-3.5 px-4 text-center">{t("colPayouts")}</th>
                  <th className="py-3.5 px-4 text-right">{t("colActions")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-bright/5">
                {[1, 2, 3, 4, 5].map((i) => (
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
                    <td className="py-3.5 px-4 text-center">
                      <div className="h-4 w-12 rounded skeleton-box mx-auto" />
                    </td>
                    <td className="py-3.5 px-4 text-center">
                      <div className="h-4 w-12 rounded skeleton-box mx-auto" />
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="h-5 w-28 rounded-lg skeleton-box ml-auto" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : filteredDraws.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-surface-bright/10 rounded-2xl bg-surface-container/20">
          <svg
            className="w-10 h-10 text-on-surface-variant/20 mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 6v6l4 2" />
          </svg>
          <p className="text-xs font-semibold text-on-surface-variant">
            {t("noDrawsFound")}
          </p>
          <p className="text-[10px] text-on-surface-variant/60 max-w-xs mt-0.5">
            {t("noDrawsSub")}
          </p>
        </div>
      ) : (
        <>
          {/* ── Mobile & Tablet Card Layout (< lg) ────────────────────── */}
          <div className="lg:hidden space-y-3">
            {paginatedDraws.map((draw) => (
              <div
                key={draw.cycleId}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("button")) return;
                  onSelectDraw(draw.cycleId);
                }}
                className="p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-primary/20 hover:bg-surface-container/50 hover:shadow-ambient hover:-translate-y-0.5 transition-all duration-300 cursor-pointer space-y-3 group"
              >
                {/* 1. Header Tier: Cycle ID + Date & StatusBadge */}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-8 w-11 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                      #{draw.cycleId}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-on-surface">
                        {formatDate(draw)}
                      </p>
                      <p className="text-[10px] text-on-surface-variant/60 uppercase tracking-wider font-semibold">
                        {t("colDate")}
                      </p>
                    </div>
                  </div>
                  <StatusBadge status={draw.status} size="sm" />
                </div>

                {/* 2. Metrics Grid Tier: 2-column mobile, 3-column tablet */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg bg-surface-container/40 border border-surface-bright/5">
                  <div className="col-span-2 sm:col-span-1">
                    <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                      {t("colPrizePot")}
                    </p>
                    <p className="font-mono text-sm font-bold text-on-surface mt-0.5">
                      ${formatTokenAmount(draw.prizePot, tokenDecimals)}{" "}
                      <span className="text-[10px] text-on-surface-variant/60 font-normal">
                        {tokenSymbol}
                      </span>
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                      {t("colBonds")}
                    </p>
                    <p className="font-mono text-xs text-on-surface mt-0.5">
                      {draw.lockedTicketCount.toLocaleString("en-US")}
                    </p>
                  </div>

                  <div>
                    <p className="text-[10px] uppercase font-semibold text-on-surface-variant/70">
                      {t("colPayouts")}
                    </p>
                    <div className="mt-0.5">
                      {draw.hasPayoutRegistry ? (
                        (() => {
                          const timelock = getPayoutTimelockState(
                            draw.revealedAt,
                            payoutTimelockSeconds,
                            now
                          );
                          if (
                            draw.status === "Complete" &&
                            timelock.isTimelocked &&
                            draw.payoutsCompleted === 0
                          ) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md"
                                title={`Payout settlement timelocked (${timelock.formattedRemaining} remaining)`}
                              >
                                <span>🔒</span> {draw.payoutsCompleted} /{" "}
                                {draw.winnersCount}
                              </span>
                            );
                          }
                          return (
                            <span className="font-mono text-xs font-semibold text-tertiary">
                              {draw.payoutsCompleted} / {draw.winnersCount}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-xs text-on-surface-variant/40">
                          —
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* 3. Footer Tier: VRF Randomness Badge & Action Button */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-surface-bright/5">
                  <div>
                    {hasDrawVrfRandomness(draw) ? (
                      <VrfSeedBadge
                        seedHex={draw.vrfSeedHex}
                        drawCycleId={draw.cycleId}
                      />
                    ) : (
                      <span className="text-[10px] text-on-surface-variant/40 font-mono">
                        —
                      </span>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDraw(draw.cycleId);
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer group-hover:translate-x-0.5 transition-transform shrink-0"
                  >
                    <span>{t("inspectPayouts")}</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* ── Desktop Semantic Table Layout (>= lg) ─────────────────── */}
          <div className="hidden lg:block overflow-x-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
            <table className="w-full min-w-[920px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-bright/10 bg-surface-container/40 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                  <th scope="col" className="py-3.5 px-4 w-20">
                    {t("colDraw")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 whitespace-nowrap">
                    {t("colDate")}
                  </th>
                  <th scope="col" className="py-3.5 px-4 whitespace-nowrap">
                    {t("colStatus")}
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 px-4 text-right whitespace-nowrap"
                  >
                    {t("colPrizePot")}
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 px-4 text-center whitespace-nowrap"
                  >
                    {t("colBonds")}
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 px-4 text-center whitespace-nowrap"
                  >
                    {t("colPayouts")}
                  </th>
                  <th
                    scope="col"
                    className="py-3.5 px-4 text-right whitespace-nowrap min-w-[220px]"
                  >
                    {t("colActions")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-bright/5 font-medium text-on-surface">
                {paginatedDraws.map((draw) => (
                  <tr
                    key={draw.cycleId}
                    onClick={() => onSelectDraw(draw.cycleId)}
                    className="hover:bg-surface-container/40 transition-colors cursor-pointer group hover:relative hover:z-20"
                  >
                    {/* Cycle # */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <div className="flex h-8 w-11 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                        #{draw.cycleId}
                      </div>
                    </td>

                    {/* Date */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-on-surface font-medium">
                      {formatDate(draw)}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusBadge status={draw.status} size="sm" />
                    </td>

                    {/* Prize Pot */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-right font-mono font-bold text-on-surface">
                      ${formatTokenAmount(draw.prizePot, tokenDecimals)}{" "}
                      <span className="text-[10px] text-on-surface-variant/60 font-normal">
                        {tokenSymbol}
                      </span>
                    </td>

                    {/* Participating Bonds */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-center font-mono text-on-surface-variant">
                      {draw.lockedTicketCount.toLocaleString("en-US")}
                    </td>

                    {/* Payout Progress */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-center">
                      {draw.hasPayoutRegistry ? (
                        (() => {
                          const timelock = getPayoutTimelockState(
                            draw.revealedAt,
                            payoutTimelockSeconds,
                            now
                          );
                          if (
                            draw.status === "Complete" &&
                            timelock.isTimelocked &&
                            draw.payoutsCompleted === 0
                          ) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-amber-300 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md"
                                title={`Payout settlement timelocked (${timelock.formattedRemaining} remaining)`}
                              >
                                <span>🔒</span> {draw.payoutsCompleted} /{" "}
                                {draw.winnersCount}
                              </span>
                            );
                          }
                          return (
                            <span className="font-mono text-xs font-semibold text-tertiary">
                              {draw.payoutsCompleted} / {draw.winnersCount}
                            </span>
                          );
                        })()
                      ) : (
                        <span className="text-xs text-on-surface-variant/40">
                          —
                        </span>
                      )}
                    </td>

                    {/* Actions & VRF Randomness Seed */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-right">
                      <div className="inline-flex items-center justify-end gap-2.5">
                        {hasDrawVrfRandomness(draw) && (
                          <VrfSeedBadge
                            seedHex={draw.vrfSeedHex}
                            drawCycleId={draw.cycleId}
                            tooltipPlacement="bottom"
                            tooltipAlign="right"
                          />
                        )}

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectDraw(draw.cycleId);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer group-hover:translate-x-0.5 transition-transform shrink-0"
                        >
                          <span>{t("inspectPayouts")}</span>
                          <span>→</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* ── Pagination ───────────────────────────────────────────── */}
          <div className="border-t border-surface-bright/5 pt-3">
            <PaginationControls
              currentPage={safePage}
              totalPages={totalPages}
              totalItems={filteredDraws.length}
              pageSize={pageSize}
              onPageChange={(page) => setCurrentPage(page)}
              onPageSizeChange={(newSize) => {
                setPageSize(newSize);
                setCurrentPage(1);
              }}
              variant="full"
            />
          </div>
        </>
      )}
    </div>
  );
}
