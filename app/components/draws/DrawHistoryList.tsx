"use client";

import React, { useState, useMemo } from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { formatDrawDisplayDate } from "@/app/lib/draw-helpers";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { VrfSeedBadge } from "@/app/components/common/VrfSeedBadge";
import { CustomSelect } from "@/app/components/common/CustomSelect";
import { PaginationControls } from "@/app/components/common/PaginationControls";
import type { DrawCycleSummary } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawHistoryListProps {
  draws: DrawCycleSummary[];
  onSelectDraw: (cycleId: number) => void;
  tokenDecimals?: number;
  tokenSymbol?: string;
  isLoading?: boolean;
}

export function DrawHistoryList({
  draws,
  onSelectDraw,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  isLoading = false,
}: DrawHistoryListProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const t = useTranslations("DrawHistory");

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
        statusFilter === "all" ||
        draw.status === statusFilter ||
        (statusFilter === "Halted" && draw.status.startsWith("Halted"));

      return matchesSearch && matchesStatus;
    });
  }, [draws, searchTerm, statusFilter]);

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
    <div className="glass rounded-2xl p-6 space-y-5">
      {/* ── Header & Toolbar ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-display text-lg font-bold text-on-surface">
              {t("listTitle")}
            </h2>
            {isLoading && (
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
        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:w-48">
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
          <div className="w-full sm:w-56 md:w-60">
            <CustomSelect
              value={statusFilter}
              disabled={isLoading}
              onChange={(val) => {
                setStatusFilter(val);
                setCurrentPage(1);
              }}
              options={[
                { value: "all", label: t("allStatuses") },
                { value: "Complete", label: t("statusComplete") },
                { value: "AwaitingRandomness", label: t("statusAwaitingVRF") },
                { value: "AwaitingYield", label: t("statusAwaitingYield") },
                { value: "Skipped", label: t("statusSkipped") },
                { value: "ForceUnlocked", label: t("statusForceUnlocked") },
                { value: "Voided", label: t("statusVoided") },
                { value: "Halted", label: t("statusHaltedAll") },
                { value: "HaltedInsolvent", label: t("statusHaltedInsolvent") },
                {
                  value: "HaltedYieldSpike",
                  label: t("statusHaltedYieldSpike"),
                },
              ]}
              align="right"
              ariaLabel="Filter draws by status"
            />
          </div>

          {(searchTerm || statusFilter !== "all") && (
            <button
              onClick={resetFilters}
              className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 cursor-pointer"
            >
              {t("clear")}
            </button>
          )}
        </div>
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      {isLoading ? (
        <div className="space-y-3 pointer-events-none select-none">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="p-4 rounded-xl skeleton-card flex items-center justify-between gap-4"
            >
              <div className="h-6 w-12 rounded skeleton-box" />
              <div className="h-4 w-28 rounded skeleton-box" />
              <div className="h-5 w-20 rounded-full skeleton-box" />
              <div className="h-5 w-24 rounded skeleton-box" />
              <div className="h-8 w-24 rounded-xl skeleton-box" />
            </div>
          ))}
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
          {/* Desktop Table Headers */}
          <div className="hidden md:grid md:grid-cols-[60px_120px_160px_130px_120px_120px_1fr] items-center gap-4 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant/60 border-b border-surface-bright/5">
            <div>{t("colDraw")}</div>
            <div>{t("colDate")}</div>
            <div>{t("colStatus")}</div>
            <div className="text-right">{t("colPrizePot")}</div>
            <div className="text-center">{t("colBonds")}</div>
            <div className="text-center">{t("colPayouts")}</div>
            <div className="text-right">{t("colActions")}</div>
          </div>

          {/* Draw Rows / Mobile Cards */}
          <div className="space-y-3">
            {paginatedDraws.map((draw) => (
              <div
                key={draw.cycleId}
                onClick={() => onSelectDraw(draw.cycleId)}
                className="flex flex-col md:grid md:grid-cols-[60px_120px_160px_130px_120px_120px_1fr] items-stretch md:items-center gap-4 p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-primary/20 hover:bg-surface-container/50 hover:shadow-ambient hover:-translate-y-0.5 transition-all duration-300 cursor-pointer group"
              >
                {/* Draw ID & Date (Grouped for Mobile) */}
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-12 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary font-mono text-xs font-bold">
                    #{draw.cycleId}
                  </div>
                  <div className="md:hidden">
                    <p className="text-[10px] uppercase font-semibold text-on-surface-variant">
                      {t("colDate")}
                    </p>
                    <p className="text-xs text-on-surface font-semibold">
                      {formatDate(draw)}
                    </p>
                  </div>
                </div>

                {/* Date (Desktop Only) */}
                <div className="hidden md:block">
                  <p className="text-xs text-on-surface font-medium whitespace-nowrap">
                    {formatDate(draw)}
                  </p>
                </div>

                {/* Status Badge */}
                <div>
                  <p className="text-[10px] uppercase font-semibold text-on-surface-variant md:hidden">
                    {t("colStatus")}
                  </p>
                  <div className="mt-0.5 md:mt-0">
                    <StatusBadge status={draw.status} size="sm" />
                  </div>
                </div>

                {/* Prize Pot */}
                <div>
                  <p className="text-[10px] uppercase font-semibold text-on-surface-variant md:hidden">
                    {t("colPrizePot")}
                  </p>
                  <p className="font-mono text-xs md:text-sm font-bold text-on-surface md:text-right">
                    ${formatTokenAmount(draw.prizePot, tokenDecimals)}{" "}
                    <span className="text-[10px] text-on-surface-variant/60 font-normal">
                      {tokenSymbol}
                    </span>
                  </p>
                </div>

                {/* Locked Bonds Snapshot */}
                <div>
                  <p className="text-[10px] uppercase font-semibold text-on-surface-variant md:hidden">
                    {t("colBonds")}
                  </p>
                  <p className="font-mono text-xs text-on-surface-variant md:text-center">
                    {draw.lockedTicketCount.toLocaleString("en-US")}
                  </p>
                </div>

                {/* Payout Progress */}
                <div>
                  <p className="text-[10px] uppercase font-semibold text-on-surface-variant md:hidden">
                    {t("colPayouts")}
                  </p>
                  <div className="md:text-center">
                    {draw.hasPayoutRegistry ? (
                      <span className="font-mono text-xs font-semibold text-tertiary">
                        {draw.payoutsCompleted} / {draw.winnersCount}
                      </span>
                    ) : (
                      <span className="text-[10px] text-on-surface-variant/40">
                        —
                      </span>
                    )}
                  </div>
                </div>

                {/* Actions & Fairness Seed */}
                <div className="flex items-center justify-between md:justify-end gap-2 w-full">
                  {draw.vrfSeedHex && (
                    <VrfSeedBadge
                      seedHex={draw.vrfSeedHex}
                      drawCycleId={draw.cycleId}
                      className="hidden lg:inline-flex"
                    />
                  )}

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectDraw(draw.cycleId);
                    }}
                    className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline cursor-pointer group-hover:translate-x-0.5 transition-transform"
                  >
                    <span>{t("inspectPayouts")}</span>
                    <span>→</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
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
