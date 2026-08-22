"use client";

import React, { useState, useEffect, useRef } from "react";
import { useDrawCycleDetails } from "@/app/hooks/useDrawCycleDetails";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { DrawTelemetryGrid } from "./DrawTelemetryGrid";
import { PayoutWinnersTable } from "./PayoutWinnersTable";
import { ProvableFairnessVerifier } from "./ProvableFairnessVerifier";
import { DrawExportActions } from "./DrawExportActions";
import {
  formatDrawDisplayDate,
  hasDrawVrfRandomness,
  RPC_PROPAGATION_GRACE_PERIOD_MS,
} from "@/app/lib/draw-helpers";
import { useTranslations } from "next-intl";

interface DrawCycleInspectorModalProps {
  poolId: number;
  cycleId: number | null;
  isOpen: boolean;
  onClose: () => void;
  tokenDecimals: number;
  tokenSymbol: string;
  bondPrice?: number;
  payoutTimelockSeconds?: number;
  userAddress?: string;
  pool?: { isFrozenForDraw?: boolean } | null;
  isFrozenForDraw?: boolean;
  onCrankWinner?: (
    cycleId: number,
    winnerIndex: number,
    winnerAddress?: string
  ) => Promise<unknown> | void;
  crankingCycles?: Record<string, boolean>;
}

export function DrawCycleInspectorModal({
  poolId,
  cycleId,
  isOpen,
  onClose,
  tokenDecimals,
  tokenSymbol,
  bondPrice = 5_000_000,
  payoutTimelockSeconds = 300,
  userAddress,
  pool,
  isFrozenForDraw,
  onCrankWinner,
  crankingCycles = {},
}: DrawCycleInspectorModalProps) {
  const [selectedTab, setSelectedTab] = useState<"winners" | "proofs">(
    "winners"
  );
  const t = useTranslations("DrawInspector");
  const trailingTimerRef = useRef<NodeJS.Timeout | number | null>(null);

  const {
    details,
    isLoading,
    isRefetching,
    error,
    refetch,
    markWinnerOptimisticallyProcessed,
  } = useDrawCycleDetails(poolId, isOpen ? cycleId : null, userAddress);

  const hasVrfRandomness = hasDrawVrfRandomness(details ?? undefined);
  const activeTab = hasVrfRandomness ? selectedTab : "winners";

  // Cleanup trailing timers on unmount or cycle change
  useEffect(() => {
    return () => {
      if (trailingTimerRef.current) {
        clearTimeout(trailingTimerRef.current as number);
        trailingTimerRef.current = null;
      }
    };
  }, [cycleId]);

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

  if (!isOpen || cycleId === null) return null;

  const formattedDate = details
    ? formatDrawDisplayDate(details, undefined, {
        estimatedPrefix: "Est.",
      })
    : "—";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-4xl 2xl:max-w-5xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-4 sm:p-6 shadow-ambient z-10 overflow-hidden flex flex-col h-[85vh] glass-strong">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-surface-bright/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary font-mono text-sm font-bold">
              #{cycleId}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg font-bold font-display text-on-surface">
                  {t("modalTitle", { cycleId })}
                </h3>
                {details && <StatusBadge status={details.status} size="sm" />}
              </div>
              <p className="text-xs text-on-surface-variant mt-0.5">
                {t("drawConductedOn", { date: formattedDate })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isLoading || isRefetching}
              title={t("refreshDetails")}
              aria-label={t("refreshDetails")}
              className="h-9 w-9 rounded-xl border border-surface-bright/15 bg-surface-container/60 hover:bg-surface-container hover:border-surface-bright/30 text-on-surface-variant hover:text-on-surface flex items-center justify-center transition cursor-pointer shadow-xs disabled:opacity-40"
            >
              <svg
                className={`w-4 h-4 ${isLoading || isRefetching ? "animate-spin text-primary" : ""}`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                />
              </svg>
            </button>
            <button
              onClick={onClose}
              aria-label="Close modal"
              className="h-9 w-9 rounded-xl border border-surface-bright/15 bg-surface-container/60 hover:bg-surface-container hover:border-surface-bright/30 text-on-surface-variant hover:text-on-surface flex items-center justify-center transition cursor-pointer shadow-xs"
            >
              <svg
                className="w-4.5 h-4.5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center justify-between gap-4 py-3 border-b border-surface-bright/5 shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedTab("winners")}
              className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                activeTab === "winners"
                  ? "bg-primary text-surface-container shadow-sm"
                  : "text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/5"
              }`}
            >
              {t("tabWinners")} {details ? `(${details.winnersCount})` : ""}
            </button>
            {hasVrfRandomness && (
              <button
                onClick={() => setSelectedTab("proofs")}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                  activeTab === "proofs"
                    ? "bg-primary text-surface-container shadow-sm"
                    : "text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/5"
                }`}
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
                {t("tabFairnessProofs")}
              </button>
            )}
          </div>

          {details && (
            <DrawExportActions
              draw={details}
              hasVrfRandomness={hasVrfRandomness}
            />
          )}
        </div>

        {/* Content Area */}
        <div className="flex-1 min-h-0 flex flex-col py-3 gap-3">
          {isLoading ? (
            <div
              className="flex-1 min-h-0 flex flex-col space-y-3 pointer-events-none select-none"
              aria-hidden="true"
            >
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
                {[1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="p-4 rounded-xl skeleton-card space-y-2"
                  >
                    <div className="h-3 w-16 rounded skeleton-box" />
                    <div className="h-6 w-24 rounded skeleton-box" />
                  </div>
                ))}
              </div>
              <div className="flex-1 min-h-0 rounded-xl skeleton-card" />
            </div>
          ) : error ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border border-dashed border-red-500/20 rounded-2xl bg-red-500/5">
              <p className="text-sm font-semibold text-red-400">{error}</p>
            </div>
          ) : details ? (
            <>
              {/* Telemetry Summary Grid - Fixed */}
              <div className="shrink-0">
                <DrawTelemetryGrid
                  draw={details}
                  tokenDecimals={tokenDecimals}
                  tokenSymbol={tokenSymbol}
                  payoutTimelockSeconds={payoutTimelockSeconds}
                />
              </div>

              {/* Active Tab View */}
              {activeTab === "winners" ? (
                <div className="flex-1 min-h-0 flex flex-col gap-2.5">
                  <div className="flex items-center justify-between shrink-0">
                    <h4 className="font-display text-sm font-bold text-on-surface">
                      {t("payoutRegistryRosterTitle", {
                        count: details.winners.length,
                      })}
                    </h4>
                    {details.isUserWinner && (
                      <span className="text-xs font-semibold text-primary">
                        🎉 {t("youWonInThisDraw")}
                      </span>
                    )}
                  </div>

                  <PayoutWinnersTable
                    cycleId={details.cycleId}
                    winners={details.winners}
                    connectedUserAddress={userAddress}
                    tokenDecimals={tokenDecimals}
                    tokenSymbol={tokenSymbol}
                    bondPrice={bondPrice}
                    revealedAt={details.revealedAt}
                    payoutTimelockSeconds={payoutTimelockSeconds}
                    pool={pool}
                    isFrozenForDraw={isFrozenForDraw}
                    onCrankWinner={
                      onCrankWinner
                        ? async (wIdx, wAddr) => {
                            try {
                              await onCrankWinner(details.cycleId, wIdx, wAddr);
                              markWinnerOptimisticallyProcessed(
                                wIdx,
                                undefined,
                                bondPrice
                              );
                              await refetch();
                              if (trailingTimerRef.current) {
                                clearTimeout(trailingTimerRef.current);
                              }
                              trailingTimerRef.current = setTimeout(() => {
                                refetch();
                              }, RPC_PROPAGATION_GRACE_PERIOD_MS);
                            } catch {
                              // Handled by global transaction runner / error alert
                            }
                          }
                        : undefined
                    }
                    crankingCycles={crankingCycles}
                  />
                </div>
              ) : (
                <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                  <ProvableFairnessVerifier draw={details} />
                </div>
              )}
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-t border-surface-bright/5 shrink-0 mt-auto">
          <p className="text-[10px] text-on-surface-variant/40 uppercase tracking-wider font-semibold">
            {t("cryptographicProofFooter")}
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
