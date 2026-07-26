"use client";

import type { PendingRedemption } from "@/app/types";
import { formatTokenAmount } from "@/app/mock-data";
import { useCallback, useState, useMemo } from "react";
import { PaginationControls } from "./PaginationControls";

interface PendingRedemptionsListProps {
  redemptions: PendingRedemption[];
  onClaimRedemption: (id: string) => void;
  onSimulateSettlement: (id: string) => void;
  tokenSymbol: string;
  tokenDecimals: number;
  showSimulation?: boolean;
  isLoading?: boolean;
}

export function PendingRedemptionsList({
  redemptions,
  onClaimRedemption,
  onSimulateSettlement,
  tokenSymbol,
  tokenDecimals,
  showSimulation = true,
  isLoading = false,
}: PendingRedemptionsListProps) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 4;

  const totalPages = Math.max(1, Math.ceil(redemptions.length / pageSize));
  const safePage = Math.max(1, Math.min(currentPage, totalPages));

  const paginatedRedemptions = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return redemptions.slice(start, start + pageSize);
  }, [redemptions, safePage, pageSize]);

  const getIcon = useCallback((type: "bond_sale" | "prize_claim") => {
    if (type === "bond_sale") {
      return (
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-error/15 text-error shrink-0">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 19V5M5 12l7-7 7 7" />
          </svg>
        </div>
      );
    }
    return (
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-400/15 text-amber-400 shrink-0">
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      </div>
    );
  }, []);

  const formatRequestedDate = useCallback((isoDateString: string) => {
    try {
      const date = new Date(isoDateString);
      return date.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return isoDateString;
    }
  }, []);

  return (
    <div className="glass-strong rounded-2xl p-6 flex flex-col gap-4">
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-2.5">
              <h3 className="font-display text-base font-bold text-on-surface">
                Pending Redemptions
              </h3>
              {isLoading && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold text-primary animate-pulse">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-spin" />
                  Syncing on-chain...
                </span>
              )}
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Retrieve settled funds from Huma Finance yield pools
            </p>
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            <div
              className="space-y-3 pointer-events-none select-none"
              aria-hidden="true"
            >
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl skeleton-card"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl skeleton-box shrink-0" />
                    <div className="space-y-2">
                      <div className="h-4.5 w-40 rounded-md skeleton-box" />
                      <div className="h-3.5 w-52 rounded-md skeleton-box" />
                    </div>
                  </div>
                  <div className="flex items-center gap-3 self-end sm:self-center">
                    <div className="h-4.5 w-24 rounded-md skeleton-box" />
                    <div className="h-8 w-28 rounded-lg skeleton-box" />
                  </div>
                </div>
              ))}
            </div>
          ) : redemptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 text-center border border-dashed border-on-surface-variant/10 rounded-xl bg-surface-container/20">
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
                <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
              <p className="text-xs font-semibold text-on-surface-variant">
                No Pending Redemptions
              </p>
              <p className="text-[10px] text-on-surface-variant/60 max-w-[200px] mt-0.5">
                Redemptions from bond sales and claimed prizes will appear here.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {paginatedRedemptions.map((item) => (
                <div
                  key={item.redemptionId}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl bg-surface-container/30 border border-surface-bright/5 hover:border-surface-bright/10 hover:bg-surface-container/50 hover:shadow-ambient transition-all duration-300"
                >
                  <div className="flex items-center gap-3">
                    {getIcon(item.type)}
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-on-surface">
                          {item.type === "bond_sale"
                            ? "Bond Redemption"
                            : "Prize Settlement"}
                        </p>
                        {item.status === "settling" ? (
                          <span className="inline-flex items-center rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-300">
                            <span className="mr-1 h-1 w-1 rounded-full bg-amber-400 animate-pulse" />
                            Settling
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            <span className="mr-1 h-1 w-1 rounded-full bg-emerald-400" />
                            Ready
                          </span>
                        )}
                      </div>
                      <p
                        className="text-[11px] text-on-surface-variant mt-0.5"
                        suppressHydrationWarning
                      >
                        Requested {formatRequestedDate(item.requestedAt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 pl-12 sm:pl-0">
                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-on-surface">
                        ${formatTokenAmount(item.amount, tokenDecimals)}
                      </p>
                      <p className="text-[10px] text-on-surface-variant">
                        {tokenSymbol}
                      </p>
                    </div>

                    <div className="flex gap-2 shrink-0">
                      {item.status === "settling" ? (
                        showSimulation && (
                          <button
                            onClick={() =>
                              onSimulateSettlement(item.redemptionId)
                            }
                            className="rounded-lg border border-amber-500/30 hover:border-amber-500/60 bg-amber-500/5 px-2.5 py-1.5 text-[11px] font-medium text-amber-300 transition cursor-pointer hover:bg-amber-500/10"
                            title="Simulate yield-bearing settlement in Huma Finance"
                          >
                            Simulate Settled
                          </button>
                        )
                      ) : (
                        <button
                          onClick={() => onClaimRedemption(item.redemptionId)}
                          className="rounded-lg bg-emerald-500 hover:bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition cursor-pointer shadow-sm shadow-emerald-500/20"
                        >
                          Claim USDC
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Pagination Controls */}
      {redemptions.length > pageSize && (
        <div className="pt-3 border-t border-surface-bright/5 mt-3 shrink-0">
          <PaginationControls
            currentPage={safePage}
            totalPages={totalPages}
            totalItems={redemptions.length}
            pageSize={pageSize}
            onPageChange={(page) => setCurrentPage(page)}
            variant="compact"
          />
        </div>
      )}
    </div>
  );
}
