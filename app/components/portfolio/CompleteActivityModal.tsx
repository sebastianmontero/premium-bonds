"use client";

import React, { useState, useMemo, useEffect, useRef } from "react";
import type { ActivityEntry, ActivityType } from "@/app/types";
import { PaginationControls } from "./PaginationControls";
import { TxExplorerLink } from "@/app/components/common/TxExplorerLink";
import { useTranslations, useLocale, useFormatter } from "next-intl";
import { formatLocalizedActivityDescription } from "@/app/lib/i18n-helpers";
import { CustomSelect } from "@/app/components/common/CustomSelect";
import { formatLocalDate } from "@/app/lib/formatters";
import {
  useActivityFeed,
  type ScanProgress,
} from "@/app/hooks/useActivityFeed";

interface CompleteActivityModalProps {
  userAddress?: string;
  poolId?: number;
  isOpen: boolean;
  onClose: () => void;
  entries?: ActivityEntry[];
  hasMore?: boolean;
  isFetchingMore?: boolean;
  isLoading?: boolean;
  scanProgress?: ScanProgress | null;
  onLoadMore?: () => Promise<boolean>;
  onFetchUntilMatches?: (
    filterFn: (entry: ActivityEntry) => boolean,
    targetCount: number
  ) => Promise<void>;
}

function dotColor(type: ActivityType): string {
  switch (type) {
    case "deposit":
      return "border-primary";
    case "win":
      return "border-secondary";
    case "auto-reinvest":
      return "border-tertiary";
    case "withdraw":
      return "border-error";
    case "claim-redemption":
      return "border-primary-dim";
  }
}

function typeIcon(type: ActivityType) {
  switch (type) {
    case "deposit":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      );
    case "win":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-secondary"
        >
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      );
    case "auto-reinvest":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-tertiary"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15A9 9 0 115.64 5.64L1 10" />
        </svg>
      );
    case "withdraw":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-error"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case "claim-redemption":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary-dim"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
  }
}

export default function CompleteActivityModal({
  userAddress,
  poolId = 1,
  isOpen,
  onClose,
  entries: fallbackEntries,
  isLoading: initialLoading = false,
}: CompleteActivityModalProps) {
  const t = useTranslations("Activity");
  const locale = useLocale();
  const format = useFormatter();
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  const formatFeedDate = (isoDate: string): string => {
    return formatLocalDate(
      isoDate,
      { month: "short", day: "numeric", year: "numeric" },
      format.dateTime
    );
  };

  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Debounce search term (300ms) to prevent query storms
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  const {
    entries: feedEntries,
    isLoading: isFeedLoading,
    isFetchingMore,
    hasMore,
    loadMore,
  } = useActivityFeed(userAddress, poolId, {
    type: typeFilter,
    search: debouncedSearchTerm,
    enabled: isOpen && Boolean(userAddress),
  });

  const effectiveEntries = useMemo(
    () => (userAddress ? feedEntries : (fallbackEntries ?? [])),
    [userAddress, feedEntries, fallbackEntries]
  );
  const isLoading = initialLoading || (Boolean(userAddress) && isFeedLoading);

  // Safe page clamping
  const totalPages = Math.max(1, Math.ceil(effectiveEntries.length / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));

  // Auto-fetch next server batch if user navigates near end of loaded records
  useEffect(() => {
    if (!isOpen || !hasMore || isFetchingMore || !userAddress) return;
    const needed = safePage * pageSize;
    if (effectiveEntries.length < needed) {
      void loadMore();
    }
  }, [
    isOpen,
    safePage,
    pageSize,
    effectiveEntries.length,
    hasMore,
    isFetchingMore,
    userAddress,
    loadMore,
  ]);

  // Focus trapping and focus restoration on open/close
  useEffect(() => {
    if (!isOpen) return;

    lastActiveElementRef.current = document.activeElement as HTMLElement | null;

    const modalEl = modalRef.current;
    if (!modalEl) return;

    const focusableElements = modalEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    firstElement?.focus();

    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement?.focus();
        }
      } else {
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement?.focus();
        }
      }
    };

    modalEl.addEventListener("keydown", handleTabTrap);
    return () => {
      modalEl.removeEventListener("keydown", handleTabTrap);
      lastActiveElementRef.current?.focus();
    };
  }, [isOpen]);

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
    setDebouncedSearchTerm("");
    setTypeFilter("all");
    setCurrentPage(1);
  };

  const paginatedEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return effectiveEntries.slice(start, start + pageSize);
  }, [effectiveEntries, safePage, pageSize]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Accessible off-screen live status announcer */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {!isLoading &&
          (effectiveEntries.length === 0
            ? t("noRecordsFound")
            : `${effectiveEntries.length} activities loaded`)}
      </div>

      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t("modalTitle")}
        className="relative w-full max-w-4xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-6 shadow-ambient z-10 overflow-hidden flex flex-col h-[85vh] glass-strong"
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
            aria-label={t("close")}
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

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-b border-surface-bright/5 shrink-0">
          {/* Search */}
          <div className="relative col-span-1 sm:col-span-2">
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

          {/* Type Filter & Reset */}
          <div className="flex gap-2 items-center min-w-0">
            <CustomSelect
              value={typeFilter}
              disabled={isLoading}
              onChange={(val) => {
                setTypeFilter(val);
                setCurrentPage(1);
              }}
              options={[
                { value: "all", label: t("allTypes") },
                { value: "deposit", label: t("deposits") },
                { value: "win", label: t("prizesAndClaims") },
                { value: "auto-reinvest", label: t("autoReinvest") },
                { value: "withdraw", label: t("withdrawals") },
                { value: "claim-redemption", label: t("redemptions") },
              ]}
              ariaLabel="Filter activity by type"
              className="w-full sm:w-56"
            />
            {(searchTerm || typeFilter !== "all") && (
              <button
                onClick={resetFilters}
                disabled={isLoading}
                className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {t("clear")}
              </button>
            )}
          </div>
        </div>

        {/* Scrollable Feed List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
          {isLoading ? (
            <div className="space-y-3 p-1 select-none" aria-hidden="true">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-4 rounded-xl border border-surface-bright/10 bg-[#08090E]/50"
                >
                  <div className="flex items-center gap-3 w-full">
                    <div className="w-9 h-9 rounded-lg skeleton-box shrink-0" />
                    <div className="flex-1 space-y-2">
                      <div className="h-4 w-52 rounded-md skeleton-box" />
                      <div className="h-3 w-32 rounded-md skeleton-box" />
                    </div>
                    <div className="h-4 w-20 rounded-md skeleton-box shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          ) : effectiveEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-surface-bright/10 rounded-2xl bg-[#08090E]/40 mt-4">
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
                {t("noRecordsFound")}
              </h4>
              <p className="text-xs text-on-surface-variant max-w-xs mt-1 leading-relaxed">
                {isFetchingMore
                  ? t("fetchingFromSolana")
                  : t("noMatchesFilter")}
              </p>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={resetFilters}
                  className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-4 py-2 transition cursor-pointer"
                >
                  {t("resetFilters")}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-1">
              {paginatedEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="timeline-item p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 hover:border-surface-bright/15 hover:bg-surface-container/40 transition-all duration-200"
                >
                  {/* Timeline dot */}
                  <div className={`timeline-dot ${dotColor(entry.type)}`} />

                  {/* Content */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5 flex-1 min-w-0">
                      <div className="mt-0.5">{typeIcon(entry.type)}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-on-surface font-medium leading-snug">
                          {formatLocalizedActivityDescription(
                            entry.description,
                            locale
                          )}
                        </p>
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          <span
                            className="text-[11px] text-on-surface-variant/70 font-mono"
                            suppressHydrationWarning
                          >
                            ID: {entry.id}
                          </span>
                          {entry.txSignature && (
                            <TxExplorerLink
                              signature={entry.txSignature}
                              variant="subtle"
                              showCopy={true}
                            />
                          )}
                        </div>
                      </div>
                    </div>
                    <span
                      className="text-xs font-mono font-semibold text-on-surface-variant shrink-0"
                      suppressHydrationWarning
                    >
                      {formatFeedDate(entry.date)}
                    </span>
                  </div>
                </div>
              ))}

              {/* Load More Button if next cursor exists */}
              {hasMore && (
                <div className="text-center pt-3 pb-1">
                  <button
                    onClick={() => void loadMore()}
                    disabled={isFetchingMore}
                    className="inline-flex items-center gap-2 rounded-xl border border-primary/30 hover:border-primary/60 bg-primary/10 hover:bg-primary/20 text-primary font-semibold text-xs px-4 py-2 transition cursor-pointer disabled:opacity-50"
                  >
                    {isFetchingMore ? (
                      <>
                        <svg
                          className="w-3.5 h-3.5 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                          />
                        </svg>
                        <span>{t("scanningOlder")}</span>
                      </>
                    ) : (
                      <span>{t("loadMore")}</span>
                    )}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Pagination Bar */}
        <div className="border-t border-surface-bright/5 pt-3 shrink-0">
          <PaginationControls
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={effectiveEntries.length}
            pageSize={pageSize}
            onPageChange={(page) => setCurrentPage(page)}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setCurrentPage(1);
            }}
            variant="full"
            showTotalCount={false}
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-surface-bright/5 shrink-0 mt-auto">
          <p className="text-[10px] text-on-surface-variant/40 uppercase tracking-wider font-semibold">
            {t("auditLogFooter")}
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
