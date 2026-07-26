"use client";

import React, { useState, useMemo, useEffect, useCallback, useRef } from "react";
import type { ActivityEntry, ActivityType } from "@/app/types";
import { PaginationControls } from "./PaginationControls";
import type { ScanProgress } from "@/app/hooks/useActivityFeed";

interface CompleteActivityModalProps {
  entries: ActivityEntry[];
  isOpen: boolean;
  onClose: () => void;
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

function formatFeedDate(isoDate: string): string {
  try {
    const date = new Date(isoDate + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return isoDate;
  }
}

export default function CompleteActivityModal({
  entries,
  isOpen,
  onClose,
  hasMore = false,
  isFetchingMore = false,
  isLoading = false,
  scanProgress = null,
  onLoadMore,
  onFetchUntilMatches,
}: CompleteActivityModalProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Debounce search term (300ms) to prevent RPC flooding
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 300);
    return () => clearTimeout(handler);
  }, [searchTerm]);

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

  const isMatch = useCallback(
    (entry: ActivityEntry, term: string, type: string) => {
      const matchesSearch =
        term === "" ||
        entry.description.toLowerCase().includes(term.toLowerCase()) ||
        entry.id.toLowerCase().includes(term.toLowerCase());

      const matchesType = type === "all" || entry.type === type;
      return matchesSearch && matchesType;
    },
    []
  );

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) =>
      isMatch(entry, debouncedSearchTerm, typeFilter)
    );
  }, [entries, debouncedSearchTerm, typeFilter, isMatch]);

  // Safe page clamping
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));

  // Auto-trigger background batch scanning if filtered items are fewer than needed for current page
  useEffect(() => {
    if (
      !isOpen ||
      !onFetchUntilMatches ||
      !hasMore ||
      isFetchingMore ||
      scanProgress !== null
    ) {
      return;
    }

    const needed = safePage * pageSize;
    if (filteredEntries.length < needed) {
      onFetchUntilMatches(
        (entry) => isMatch(entry, debouncedSearchTerm, typeFilter),
        needed
      );
    }
  }, [
    isOpen,
    filteredEntries.length,
    safePage,
    pageSize,
    hasMore,
    isFetchingMore,
    scanProgress,
    debouncedSearchTerm,
    typeFilter,
    isMatch,
    onFetchUntilMatches,
  ]);

  const paginatedEntries = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return filteredEntries.slice(start, start + pageSize);
  }, [filteredEntries, safePage, pageSize]);

  // Track attempted queries to prevent infinite background scanning loops
  const attemptedQueriesRef = useRef<Set<string>>(new Set());
  const queryKey = `${debouncedSearchTerm}:${typeFilter}:${safePage}`;

  useEffect(() => {
    attemptedQueriesRef.current.clear();
  }, [debouncedSearchTerm, typeFilter]);

  // Auto-trigger background batch scanning if filtered items are fewer than needed for current page
  useEffect(() => {
    if (
      !isOpen ||
      !onFetchUntilMatches ||
      !hasMore ||
      isFetchingMore ||
      scanProgress !== null ||
      attemptedQueriesRef.current.has(queryKey)
    ) {
      return;
    }

    const needed = safePage * pageSize;
    if (filteredEntries.length < needed) {
      attemptedQueriesRef.current.add(queryKey);
      onFetchUntilMatches(
        (entry) => isMatch(entry, debouncedSearchTerm, typeFilter),
        needed
      );
    }
  }, [
    isOpen,
    filteredEntries.length,
    safePage,
    pageSize,
    hasMore,
    isFetchingMore,
    scanProgress,
    debouncedSearchTerm,
    typeFilter,
    queryKey,
    isMatch,
    onFetchUntilMatches,
  ]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-4xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-6 shadow-ambient z-10 overflow-hidden flex flex-col h-[85vh] glass-strong">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-surface-bright/5 shrink-0">
          <div>
            <h3 className="text-xl font-bold font-display text-on-surface">
              Activity Feed History
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Complete audit log of all account transactions, prize claims, and
              reinvestment events.
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

        {/* Filter Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 py-4 border-b border-surface-bright/5 shrink-0">
          {/* Search */}
          <div className="relative col-span-1 sm:col-span-2">
            <input
              type="text"
              placeholder="Search description or transaction ID..."
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
          <div className="flex gap-2 items-center">
            <select
              value={typeFilter}
              disabled={isLoading}
              onChange={(e) => {
                setTypeFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 px-3 text-xs text-on-surface focus:border-primary focus:outline-none cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="all">All Event Types</option>
              <option value="deposit">Deposits</option>
              <option value="win">Prizes &amp; Claims</option>
              <option value="auto-reinvest">Auto-Reinvest</option>
              <option value="withdraw">Withdrawals</option>
              <option value="claim-redemption">Redemptions</option>
            </select>
            {(searchTerm || typeFilter !== "all") && (
              <button
                onClick={resetFilters}
                disabled={isLoading}
                className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Scan Progress Banner */}
        {scanProgress && (
          <div className="flex items-center gap-2.5 py-2.5 px-4 bg-primary/10 border border-primary/20 rounded-xl text-xs text-primary animate-pulse my-2 shrink-0">
            <svg
              className="w-4 h-4 animate-spin text-primary shrink-0"
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
            <span className="font-medium">
              Scanning historical on-chain transactions... batch{" "}
              <strong>{scanProgress.currentBatch}</strong> of{" "}
              <strong>{scanProgress.maxBatches}</strong>
            </span>
          </div>
        )}

        {/* Scrollable Feed List */}
        <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
          {isLoading ? (
            <div className="space-y-3 p-1 pointer-events-none select-none" aria-hidden="true">
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
          ) : filteredEntries.length === 0 ? (
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
                No Activity Records Found
              </h4>
              <p className="text-xs text-on-surface-variant max-w-xs mt-1 leading-relaxed">
                {isFetchingMore
                  ? "Fetching historical records from Solana..."
                  : "No activities matched your current search term or filter selection."}
              </p>
              <div className="flex items-center gap-3 mt-4">
                <button
                  onClick={resetFilters}
                  className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-4 py-2 transition cursor-pointer"
                >
                  Reset Filters
                </button>
                {hasMore && onLoadMore && (
                  <button
                    onClick={() => onLoadMore()}
                    disabled={isFetchingMore}
                    className="inline-flex items-center gap-2 rounded-xl bg-primary hover:bg-primary-hover text-surface-container font-semibold text-xs px-4 py-2 transition cursor-pointer disabled:opacity-50"
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
                        <span>Scanning Older Transactions...</span>
                      </>
                    ) : (
                      <span>Scan Deeper for Matches ↓</span>
                    )}
                  </button>
                )}
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
                          {entry.description}
                        </p>
                        <p
                          className="text-[11px] text-on-surface-variant/70 mt-1 font-mono"
                          suppressHydrationWarning
                        >
                          ID: {entry.id}
                        </p>
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

              {/* Load More Button */}
              {hasMore && onLoadMore && (
                <div className="text-center pt-3 pb-1">
                  <button
                    onClick={() => onLoadMore()}
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
                        <span>Fetching Older Transactions...</span>
                      </>
                    ) : (
                      <span>Load More Historical Activity ↓</span>
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
            totalItems={filteredEntries.length}
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
            Premium Bonds Protocol Audit Log v1.0
          </p>
          <button
            onClick={onClose}
            className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-5 py-2.5 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
