"use client";

import React, { useMemo } from "react";

export interface PaginationControlsProps {
  /** The current 1-indexed page number. */
  currentPage: number;
  /** Total number of available pages. */
  totalPages: number;
  /** Total count of items across all pages. */
  totalItems: number;
  /** Number of items displayed per page. */
  pageSize: number;
  /** Callback fired when the user changes the page. */
  onPageChange: (page: number) => void;
  /** Optional callback fired when the user changes page size. */
  onPageSizeChange?: (pageSize: number) => void;
  /** Available page size options for the dropdown (default: [10, 25, 50]). */
  pageSizeOptions?: number[];
  /** Display variant: 'compact' (simple prev/next/count) or 'full' (with page numbers & size selector). */
  variant?: "compact" | "full";
  /** Optional custom container CSS classes. */
  className?: string;
}

export function PaginationControls({
  currentPage,
  totalPages,
  totalItems,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50],
  variant = "full",
  className = "",
}: PaginationControlsProps) {
  // Clamped page number ensuring no out-of-bounds rendering
  const safeTotalPages = Math.max(1, totalPages);
  const safeCurrentPage = Math.max(1, Math.min(currentPage, safeTotalPages));

  // Compute item index range string (e.g. "1–5" or "11–20")
  const startItem = totalItems === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1;
  const endItem = Math.min(safeCurrentPage * pageSize, totalItems);

  // Compute page numbers array with ellipsis for desktop view
  const pageNumbers = useMemo(() => {
    if (safeTotalPages <= 7) {
      return Array.from({ length: safeTotalPages }, (_, i) => i + 1);
    }

    const pages: (number | "...")[] = [1];

    if (safeCurrentPage > 3) {
      pages.push("...");
    }

    const start = Math.max(2, safeCurrentPage - 1);
    const end = Math.min(safeTotalPages - 1, safeCurrentPage + 1);

    for (let i = start; i <= end; i++) {
      pages.push(i);
    }

    if (safeCurrentPage < safeTotalPages - 2) {
      pages.push("...");
    }

    pages.push(safeTotalPages);
    return pages;
  }, [safeCurrentPage, safeTotalPages]);

  if (totalItems === 0) return null;

  return (
    <nav
      aria-label="Pagination Navigation"
      className={`flex flex-col sm:flex-row items-center justify-between gap-3 px-1 py-2 ${className}`}
    >
      {/* Item range summary & Live Region */}
      <div className="text-xs text-on-surface-variant flex items-center gap-2">
        <span>
          Showing{" "}
          <strong className="font-mono font-semibold text-on-surface">
            {startItem}–{endItem}
          </strong>{" "}
          of{" "}
          <strong className="font-mono font-semibold text-on-surface">
            {totalItems}
          </strong>{" "}
          entries
        </span>
        <span aria-live="polite" className="sr-only">
          Page {safeCurrentPage} of {safeTotalPages}
        </span>
      </div>

      {/* Control Buttons & Optional Page Size Selector */}
      <div className="flex items-center gap-3">
        {/* Optional Page Size Selector (Full variant on desktop) */}
        {variant === "full" && onPageSizeChange && (
          <div className="hidden sm:flex items-center gap-1.5 text-xs text-on-surface-variant">
            <label htmlFor="page-size-select" className="sr-only">
              Items per page
            </label>
            <select
              id="page-size-select"
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-surface-bright/10 bg-[#08090E] py-1 px-2 text-xs text-on-surface focus:border-primary focus:outline-none cursor-pointer"
            >
              {pageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} / page
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Navigation Buttons */}
        <div className="flex items-center gap-1">
          {/* Previous Page Button */}
          <button
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage <= 1}
            aria-label="Go to previous page"
            className="rounded-lg border border-surface-bright/10 bg-surface-container/30 px-2.5 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-bright/10 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
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
                strokeWidth={2.5}
                d="M15 19l-7-7 7-7"
              />
            </svg>
            <span className="hidden sm:inline">Prev</span>
          </button>

          {/* Mobile Page Badge / Compact View */}
          <div className="sm:hidden text-xs font-semibold font-mono text-on-surface px-2">
            {safeCurrentPage} / {safeTotalPages}
          </div>

          {/* Desktop Page Number Pills (Full variant only) */}
          {variant === "full" && (
            <div className="hidden sm:flex items-center gap-1">
              {pageNumbers.map((page, idx) =>
                page === "..." ? (
                  <span
                    key={`ellipsis-${idx}`}
                    className="px-2 py-1 text-xs text-on-surface-variant/40"
                  >
                    …
                  </span>
                ) : (
                  <button
                    key={`page-${page}`}
                    onClick={() => onPageChange(page)}
                    aria-label={`Go to page ${page}`}
                    aria-current={safeCurrentPage === page ? "page" : undefined}
                    className={`rounded-lg px-2.5 py-1 text-xs font-mono font-semibold transition cursor-pointer ${
                      safeCurrentPage === page
                        ? "bg-primary text-black font-bold shadow-sm shadow-primary/20"
                        : "border border-surface-bright/10 bg-surface-container/30 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/10"
                    }`}
                  >
                    {page}
                  </button>
                )
              )}
            </div>
          )}

          {/* Next Page Button */}
          <button
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage >= safeTotalPages}
            aria-label="Go to next page"
            className="rounded-lg border border-surface-bright/10 bg-surface-container/30 px-2.5 py-1.5 text-xs font-semibold text-on-surface hover:bg-surface-bright/10 disabled:opacity-40 disabled:cursor-not-allowed transition cursor-pointer flex items-center gap-1"
          >
            <span className="hidden sm:inline">Next</span>
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2.5}
                d="M9 5l7 7-7 7"
              />
            </svg>
          </button>
        </div>
      </div>
    </nav>
  );
}
