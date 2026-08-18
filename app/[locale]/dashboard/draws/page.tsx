"use client";

import React, { useState, useEffect, Suspense, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/i18n/routing";
import { useWalletConnection } from "@solana/react-hooks";
import { useBondsContract } from "@/app/hooks/useBondsContract";
import { useDrawExplorer } from "@/app/hooks/useDrawExplorer";
import { useTransactionRunner } from "@/app/hooks/useTransactionRunner";
import {
  parseTransactionError,
  ParsedTransactionError,
} from "@/app/lib/errors";
import { SolanaErrorAlert } from "@/app/components/SolanaErrorAlert";
import { TransactionProgressModal } from "@/app/components/dashboard/TransactionProgressModal";
import { DrawStatsSummary } from "@/app/components/draws/DrawStatsSummary";
import { DrawHistoryList } from "@/app/components/draws/DrawHistoryList";
import { DrawCycleInspectorModal } from "@/app/components/draws/DrawCycleInspectorModal";
import { createDefaultPoolFallback } from "@/app/types";
import { useTranslations } from "next-intl";

function DrawHistoryContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const userAddress = wallet?.account.address.toString();
  const t = useTranslations("DrawHistory");

  const {
    pool: onChainPool,
    isLoading: isPoolLoading,
    refetch: refetchPool,
    actions,
  } = useBondsContract(1);

  const activePool = onChainPool ?? createDefaultPoolFallback(1);

  const {
    drawSummaries,
    stats,
    isLoading: isDrawsLoading,
    refetch: refetchDraws,
  } = useDrawExplorer(1, onChainPool?.currentDrawCycleId, 100);

  // Deep-linked cycle query param handling
  const cycleParam = searchParams.get("cycle");
  const [selectedCycleId, setSelectedCycleId] = useState<number | null>(() => {
    if (cycleParam) {
      const parsed = parseInt(cycleParam, 10);
      return !isNaN(parsed) && parsed >= 0 ? parsed : null;
    }
    return null;
  });

  // Keep state synchronized with URL query params
  useEffect(() => {
    if (cycleParam) {
      const parsed = parseInt(cycleParam, 10);
      if (!isNaN(parsed) && parsed >= 0 && parsed !== selectedCycleId) {
        setSelectedCycleId(parsed);
      }
    } else if (selectedCycleId !== null && !cycleParam) {
      // Intentionally keep modal state or close if user clicked back
    }
  }, [cycleParam, selectedCycleId]);

  const handleOpenInspector = useCallback(
    (cycleId: number) => {
      setSelectedCycleId(cycleId);
      router.replace(`${pathname}?cycle=${cycleId}`, { scroll: false });
    },
    [router, pathname]
  );

  const handleCloseInspector = useCallback(() => {
    setSelectedCycleId(null);
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // Transaction Runner State for Winner Crank Reinvestment
  const [crankingCycles, setCrankingCycles] = useState<Record<string, boolean>>(
    {}
  );
  const [txError, setTxError] = useState<
    ParsedTransactionError | string | null
  >(null);
  const [lastTxAction, setLastTxAction] = useState<(() => void) | null>(null);

  const {
    stage: actionStage,
    txSignature: actionTxSignature,
    runTransaction: runActionTx,
    reset: resetActionRunner,
  } = useTransactionRunner();

  const handleCrankWinner = async (
    drawCycleId: number,
    winnerIndex: number
  ) => {
    const key = `${drawCycleId}-${winnerIndex}`;
    if (crankingCycles[key]) return;

    setCrankingCycles((prev) => ({ ...prev, [key]: true }));
    setTxError(null);

    try {
      if (isConnected) {
        await runActionTx(
          () => actions.reinvestWinnings(drawCycleId, winnerIndex),
          () => {
            refetchPool();
            refetchDraws();
          }
        );
      }
    } catch (err) {
      const parsed = parseTransactionError(err);
      setTxError(parsed);
      setLastTxAction(() => () => handleCrankWinner(drawCycleId, winnerIndex));
    } finally {
      setCrankingCycles((prev) => ({ ...prev, [key]: false }));
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Page Header & Subtitle ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-white text-base">
              🏆
            </span>
            {t("pageTitle")}
          </h1>
          <p className="text-xs text-on-surface-variant mt-1 max-w-2xl leading-relaxed">
            {t("pageSubtitle")}
          </p>
        </div>

        <button
          onClick={() => {
            refetchPool();
            refetchDraws();
          }}
          disabled={isDrawsLoading}
          className="flex items-center gap-1.5 rounded-xl border border-surface-bright/15 hover:bg-surface-bright/5 px-3 py-2 text-xs font-semibold text-on-surface transition cursor-pointer self-start sm:self-auto disabled:opacity-50"
        >
          <svg
            className={`w-3.5 h-3.5 ${isDrawsLoading ? "animate-spin text-primary" : "text-on-surface-variant"}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 1121.21 8H17"
            />
          </svg>
          <span>{t("refresh")}</span>
        </button>
      </div>

      {/* ── Aggregate Metrics Row ─────────────────────────────────── */}
      <DrawStatsSummary
        stats={stats}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        isLoading={isPoolLoading || isDrawsLoading}
      />

      {/* ── Historical Draws List ─────────────────────────────────── */}
      <DrawHistoryList
        draws={drawSummaries}
        onSelectDraw={handleOpenInspector}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        isLoading={isDrawsLoading}
      />

      {/* ── Detail Inspector Modal ─────────────────────────────────── */}
      <DrawCycleInspectorModal
        poolId={1}
        cycleId={selectedCycleId}
        isOpen={selectedCycleId !== null}
        onClose={handleCloseInspector}
        userAddress={isConnected ? userAddress : undefined}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        onCrankWinner={isConnected ? handleCrankWinner : undefined}
        crankingCycles={crankingCycles}
      />

      {/* Background Transaction Progress Modal */}
      <TransactionProgressModal
        isOpen={actionStage !== null}
        stage={actionStage}
        title={t("crankModalTitle")}
        customSuccessMessage={t("crankSuccessMsg")}
        txSignature={actionTxSignature}
        onClose={resetActionRunner}
      />

      {/* Floating Transaction Error Toast */}
      {txError && (
        <SolanaErrorAlert
          error={txError}
          variant="toast"
          onDismiss={() => {
            setTxError(null);
            setLastTxAction(null);
          }}
          onRetry={
            lastTxAction
              ? () => {
                  setTxError(null);
                  lastTxAction();
                }
              : undefined
          }
        />
      )}
    </div>
  );
}

export default function DrawHistoryPage() {
  return (
    <Suspense
      fallback={
        <div className="space-y-6">
          <div className="h-10 w-48 rounded-xl skeleton-box" />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-36 rounded-2xl skeleton-card" />
            ))}
          </div>
          <div className="h-80 rounded-2xl skeleton-card" />
        </div>
      }
    >
      <DrawHistoryContent />
    </Suspense>
  );
}
