"use client";

import React, {
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDrawCycleDetails } from "@/app/hooks/useDrawCycleDetails";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { DrawTelemetryGrid } from "./DrawTelemetryGrid";
import { PayoutWinnersTable } from "./PayoutWinnersTable";
import { ProvableFairnessVerifier } from "./ProvableFairnessVerifier";
import { DrawSkippedAuditView } from "./DrawSkippedAuditView";
import { DrawStatusAuditView } from "./DrawStatusAuditView";
import { DrawWinnerDetailView } from "./DrawWinnerDetailView";
import {
  formatDrawDisplayDate,
  hasDrawVrfRandomness,
  getDrawArchetype,
  invalidateDrawQueries,
  resolvePrizeBreakdown,
} from "@/app/lib/draw-helpers";
import type { DrawStatusName, DrawDisplayConfig } from "@/app/types";
import { useTranslations } from "next-intl";

export interface DrawCycleInspectorModalProps {
  poolId: number;
  cycleId: number | null;
  isOpen: boolean;
  onClose: () => void;
  config?: DrawDisplayConfig;
  tokenDecimals?: number;
  tokenSymbol?: string;
  bondPrice?: number;
  payoutTimelockSeconds?: number;
  userAddress?: string;
  unclaimedDust?: number;
  pool?: { isFrozenForDraw?: boolean } | null;
  isFrozenForDraw?: boolean;
  initialStatus?: DrawStatusName;
  initialWinnerIndex?: number | null;
  minYieldThreshold?: number | bigint;
  onCrankWinner?: (
    cycleId: number,
    winnerIndex: number,
    winnerAddress?: string,
    onOptimisticSuccess?: (sig: string) => void
  ) => Promise<unknown> | void;
  crankingCycles?: Record<string, boolean>;
}

export function DrawCycleInspectorModal({
  poolId,
  cycleId,
  isOpen,
  onClose,
  config,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  bondPrice = 5_000_000,
  payoutTimelockSeconds = 300,
  userAddress,
  unclaimedDust,
  pool,
  isFrozenForDraw,
  initialStatus,
  initialWinnerIndex,
  minYieldThreshold,
  onCrankWinner,
  crankingCycles = {},
}: DrawCycleInspectorModalProps) {
  const queryClient = useQueryClient();
  const [selectedTab, setSelectedTab] = useState<"winners" | "proofs">(
    "winners"
  );
  const [selectedWinnerOverride, setSelectedWinnerOverride] = useState<{
    cycleId: number | null;
    index: number | null;
  } | null>(null);

  const selectedWinnerIndex =
    selectedWinnerOverride?.cycleId === cycleId
      ? selectedWinnerOverride.index
      : (initialWinnerIndex ?? null);

  const handleSelectWinner = useCallback(
    (idx: number | null) => {
      setSelectedWinnerOverride({ cycleId, index: idx });
    },
    [cycleId]
  );

  const t = useTranslations("DrawInspector");
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  const effectiveConfig: DrawDisplayConfig = useMemo(
    () =>
      config ?? {
        tokenDecimals,
        tokenSymbol,
        bondPrice,
        payoutTimelockSeconds,
      },
    [config, tokenDecimals, tokenSymbol, bondPrice, payoutTimelockSeconds]
  );

  const {
    details,
    isLoading,
    isRefetching,
    error,
    refetch,
    markWinnerOptimisticallyProcessed,
  } = useDrawCycleDetails(poolId, isOpen ? cycleId : null, userAddress);

  const effectiveStatus = details?.status ?? initialStatus;
  const archetype = effectiveStatus ? getDrawArchetype(effectiveStatus) : null;
  const isPayoutBearing = archetype === "payout-bearing";
  const isSkipped = archetype === "skipped";

  const hasVrfRandomness = hasDrawVrfRandomness(details ?? undefined);
  const activeTab = hasVrfRandomness ? selectedTab : "winners";

  // Focus trapping and focus restoration on open/close
  useEffect(() => {
    if (!isOpen) return;

    lastActiveElementRef.current = document.activeElement as HTMLElement | null;

    const modalEl = modalRef.current;
    if (!modalEl) return;

    const getFocusable = () =>
      modalEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );

    const initial = getFocusable();
    initial[0]?.focus();

    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;

      const focusableElements = getFocusable();
      if (focusableElements.length === 0) return;
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

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

  // Coordinated Escape key handling (detail view -> table view -> close modal)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (selectedWinnerIndex !== null) {
          const returnIdx = selectedWinnerIndex;
          handleSelectWinner(null);
          setTimeout(() => {
            document.getElementById(`trigger-winner-${returnIdx}`)?.focus();
          }, 0);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, selectedWinnerIndex, handleSelectWinner]);

  if (!isOpen || cycleId === null) return null;

  const formattedDate = details
    ? formatDrawDisplayDate(details, undefined, {
        estimatedPrefix: "Est.",
      })
    : "—";

  const activeWinner = details?.winners.find(
    (w) => w.winnerIndex === selectedWinnerIndex
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Screen Reader Live Status Announcement */}
      <div className="sr-only" role="status" aria-live="polite">
        {details
          ? t("ariaStatusAnnounce", {
              cycleId: details.cycleId,
              status: details.status,
            })
          : ""}
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
        aria-labelledby="draw-inspector-modal-title"
        aria-describedby="draw-inspector-modal-desc"
        className="relative w-full max-w-4xl 2xl:max-w-5xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-4 sm:p-6 shadow-ambient z-10 overflow-hidden flex flex-col h-[85vh] glass-strong"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-surface-bright/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-12 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary font-mono text-sm font-bold">
              #{cycleId}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3
                  id="draw-inspector-modal-title"
                  className="text-lg font-bold font-display text-on-surface"
                >
                  {t("modalTitle", { cycleId })}
                </h3>
                {effectiveStatus && (
                  <StatusBadge status={effectiveStatus} size="sm" />
                )}
              </div>
              <p
                id="draw-inspector-modal-desc"
                className="text-xs text-on-surface-variant mt-0.5"
              >
                {t("drawConductedOn", { date: formattedDate })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                invalidateDrawQueries(queryClient, poolId);
                refetch();
              }}
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
              aria-label={t("close")}
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

        {/* Tab Navigation (only when not inspecting a winner detail) */}
        {selectedWinnerIndex === null && (
          <div className="flex items-center justify-between gap-4 py-3 border-b border-surface-bright/5 shrink-0">
            <div className="flex items-center gap-2">
              {isLoading && !initialStatus ? (
                /* Neutral loading placeholder without tabs (prevents CLS on deep link) */
                <div className="h-7 w-40 rounded-xl skeleton-box" />
              ) : isPayoutBearing ? (
                <>
                  <button
                    onClick={() => setSelectedTab("winners")}
                    className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold transition cursor-pointer ${
                      activeTab === "winners"
                        ? "bg-primary text-surface-container shadow-sm"
                        : "text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/5"
                    }`}
                  >
                    {t("tabWinners")}{" "}
                    {details ? `(${details.winnersCount})` : ""}
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
                        <rect
                          x="3"
                          y="11"
                          width="18"
                          height="11"
                          rx="2"
                          ry="2"
                        />
                        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                      </svg>
                      {t("tabFairnessProofs")}
                    </button>
                  )}
                </>
              ) : (
                /* Dedicated Audit Trail Mode Indicator */
                <div className="flex items-center gap-2">
                  <span className="rounded-xl px-3.5 py-1.5 text-xs font-semibold bg-surface-container/60 border border-surface-bright/15 text-on-surface flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    {t("tabAuditTrail")}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

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
            isSkipped ? (
              /* Archetype 2: Lossless Yield Rollover View */
              <DrawSkippedAuditView
                draw={details}
                config={effectiveConfig}
                minYieldThreshold={minYieldThreshold}
              />
            ) : isPayoutBearing ? (
              /* Archetype 1: Payout-Bearing (Complete or Voided) */
              selectedWinnerIndex !== null && activeWinner ? (
                /* Full Viewport Master-Detail Drilldown */
                <DrawWinnerDetailView
                  winner={activeWinner}
                  cycleId={details.cycleId}
                  revealedAt={details.revealedAt}
                  config={effectiveConfig}
                  connectedUserAddress={userAddress}
                  unclaimedDust={unclaimedDust}
                  isClaimingPaused={pool?.isFrozenForDraw ?? isFrozenForDraw}
                  isVoided={details.status === "Voided"}
                  onBack={() => {
                    const returnIdx = selectedWinnerIndex;
                    handleSelectWinner(null);
                    setTimeout(() => {
                      document
                        .getElementById(`trigger-winner-${returnIdx}`)
                        ?.focus();
                    }, 0);
                  }}
                  onCrank={
                    details.status === "Voided" || !onCrankWinner
                      ? undefined
                      : async (wIdx, wAddr) => {
                          try {
                            await onCrankWinner(
                              details.cycleId,
                              wIdx,
                              wAddr,
                              (sig) => {
                                const isConnectedWinner =
                                  !!userAddress &&
                                  activeWinner.winnerAddress.toLowerCase() ===
                                    userAddress.toLowerCase();
                                const calculatedBreakdown =
                                  resolvePrizeBreakdown({
                                    amountWon: activeWinner.amountOwed,
                                    status: "processing",
                                    bondPrice: effectiveConfig.bondPrice,
                                    unclaimedDust: isConnectedWinner
                                      ? (unclaimedDust ?? 0)
                                      : 0,
                                  });
                                markWinnerOptimisticallyProcessed(
                                  wIdx,
                                  calculatedBreakdown,
                                  effectiveConfig.bondPrice,
                                  sig
                                );
                              }
                            );
                          } catch {
                            // Handled by global transaction runner / error alert
                          }
                        }
                  }
                  isCranking={
                    !!crankingCycles[
                      `${details.cycleId}-${activeWinner.winnerIndex}`
                    ]
                  }
                />
              ) : (
                /* Master List View */
                <>
                  {/* Telemetry Summary Grid */}
                  <div className="shrink-0">
                    <DrawTelemetryGrid
                      draw={details}
                      tokenDecimals={effectiveConfig.tokenDecimals}
                      tokenSymbol={effectiveConfig.tokenSymbol}
                      payoutTimelockSeconds={
                        effectiveConfig.payoutTimelockSeconds
                      }
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
                        {details.isUserWinner &&
                          details.status !== "Voided" && (
                            <span className="text-xs font-semibold text-primary">
                              🎉 {t("youWonInThisDraw")}
                            </span>
                          )}
                      </div>

                      <PayoutWinnersTable
                        cycleId={details.cycleId}
                        winners={details.winners}
                        connectedUserAddress={userAddress}
                        tokenDecimals={effectiveConfig.tokenDecimals}
                        tokenSymbol={effectiveConfig.tokenSymbol}
                        bondPrice={effectiveConfig.bondPrice}
                        revealedAt={details.revealedAt}
                        payoutTimelockSeconds={
                          effectiveConfig.payoutTimelockSeconds
                        }
                        pool={pool}
                        isFrozenForDraw={isFrozenForDraw}
                        isVoided={details.status === "Voided"}
                        onCrankWinner={
                          details.status === "Voided" || !onCrankWinner
                            ? undefined
                            : async (wIdx, wAddr) => {
                                try {
                                  await onCrankWinner(
                                    details.cycleId,
                                    wIdx,
                                    wAddr,
                                    (sig) => {
                                      const isConnectedWinner =
                                        !!userAddress &&
                                        wAddr?.toLowerCase() ===
                                          userAddress.toLowerCase();
                                      const winnerRecord =
                                        details.winners[wIdx];
                                      const calculatedBreakdown = winnerRecord
                                        ? resolvePrizeBreakdown({
                                            amountWon: winnerRecord.amountOwed,
                                            status: "processing",
                                            bondPrice:
                                              effectiveConfig.bondPrice,
                                            unclaimedDust: isConnectedWinner
                                              ? (unclaimedDust ?? 0)
                                              : 0,
                                          })
                                        : undefined;
                                      markWinnerOptimisticallyProcessed(
                                        wIdx,
                                        calculatedBreakdown,
                                        effectiveConfig.bondPrice,
                                        sig
                                      );
                                    }
                                  );
                                } catch {
                                  // Handled by global transaction runner / error alert
                                }
                              }
                        }
                        crankingCycles={crankingCycles}
                        onSelectWinnerIndex={(idx) => handleSelectWinner(idx)}
                      />
                    </div>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                      <ProvableFairnessVerifier draw={details} />
                    </div>
                  )}
                </>
              )
            ) : (
              /* Archetypes 3 & 4: In-Flight Lifecycle & Interventions */
              <DrawStatusAuditView draw={details} config={effectiveConfig} />
            )
          ) : null}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-3 border-b-0 border-t border-surface-bright/5 shrink-0 mt-auto">
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
