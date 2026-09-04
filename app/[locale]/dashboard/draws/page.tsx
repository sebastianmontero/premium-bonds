"use client";

import React, { useState, Suspense, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter, usePathname } from "@/i18n/routing";
import { useWalletConnection } from "@solana/react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useBondsContext } from "@/app/components/providers/BondsProvider";
import { useDrawExplorer } from "@/app/hooks/useDrawExplorer";
import { useTransactionRunner } from "@/app/hooks/useTransactionRunner";
import { TransactionProgressModal } from "@/app/components/dashboard/TransactionProgressModal";
import { DrawStatsSummary } from "@/app/components/draws/DrawStatsSummary";
import { DrawHistoryList } from "@/app/components/draws/DrawHistoryList";
import { DrawCycleInspectorModal } from "@/app/components/draws/DrawCycleInspectorModal";
import { PoolStateErrorCard } from "@/app/components/dashboard/PoolStateErrorCard";
import { PoolStateUninitializedCard } from "@/app/components/dashboard/PoolStateUninitializedCard";
import { invalidateDrawQueries } from "@/app/lib/draw-helpers";
import { useTranslations } from "next-intl";

function DrawHistoryContent() {
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const userAddress = wallet?.account.address.toString();
  const t = useTranslations("DrawHistory");

  const {
    pool: onChainPool,
    isPoolLoading,
    isPoolError,
    poolError,
    refetch: refetchPool,
    actions,
  } = useBondsContext();

  const {
    drawSummaries,
    stats,
    isLoading: isDrawsLoading,
    isRefetching: isDrawsRefetching,
    refetch: refetchDraws,
  } = useDrawExplorer(1, 100, onChainPool?.totalPrizesDistributed ?? 0);

  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshing || isDrawsLoading || isDrawsRefetching) return;
    setIsRefreshing(true);
    try {
      invalidateDrawQueries(queryClient, 1);
      await Promise.all([refetchPool(), refetchDraws()]);
    } catch (err) {
      console.error("Failed to refresh draw history:", err);
    } finally {
      setIsRefreshing(false);
    }
  }, [
    isRefreshing,
    isDrawsLoading,
    isDrawsRefetching,
    refetchPool,
    refetchDraws,
    queryClient,
  ]);

  // Single source of truth for deep-linked cycle inspection
  const cycleParam = searchParams.get("cycle");
  const selectedCycleId = useMemo(() => {
    if (!cycleParam) return null;
    const parsed = parseInt(cycleParam, 10);
    return !isNaN(parsed) && parsed >= 0 ? parsed : null;
  }, [cycleParam]);

  const selectedDrawSummary = useMemo(() => {
    if (selectedCycleId === null) return null;
    return drawSummaries.find((d) => d.cycleId === selectedCycleId) ?? null;
  }, [drawSummaries, selectedCycleId]);

  const handleOpenInspector = useCallback(
    (cycleId: number) => {
      router.replace(`${pathname}?cycle=${cycleId}`, { scroll: false });
    },
    [router, pathname]
  );

  const handleCloseInspector = useCallback(() => {
    router.replace(pathname, { scroll: false });
  }, [router, pathname]);

  // Transaction Runner State for Winner Crank Reinvestment
  const [crankingCycles, setCrankingCycles] = useState<Record<string, boolean>>(
    {}
  );

  const {
    stage: actionStage,
    txSignature: actionTxSignature,
    error: actionRunnerError,
    runTransaction: runActionTx,
    retry: retryActionRunner,
    reset: resetActionRunner,
  } = useTransactionRunner();

  const handleCrankWinner = async (
    drawCycleId: number,
    winnerIndex: number,
    winnerAddress?: string
  ) => {
    const key = `${drawCycleId}-${winnerIndex}`;
    if (crankingCycles[key]) return;

    setCrankingCycles((prev) => ({ ...prev, [key]: true }));

    try {
      if (isConnected) {
        return await runActionTx(
          () =>
            actions.reinvestWinnings(drawCycleId, winnerIndex, winnerAddress),
          () => {
            refetchPool();
            invalidateDrawQueries(queryClient, 1);
          }
        );
      }
    } catch (err) {
      console.error("Draw crank failed:", err);
      throw err;
    } finally {
      setCrankingCycles((prev) => ({ ...prev, [key]: false }));
    }
  };

  const isBusyRefreshing = isRefreshing || isDrawsRefetching || isDrawsLoading;

  if (!onChainPool) {
    if (isPoolError) {
      return (
        <div className="space-y-6">
          <PoolStateErrorCard error={poolError} onRetry={refetchPool} />
        </div>
      );
    }
    if (!isPoolLoading && !isPoolError) {
      return (
        <div className="space-y-6">
          <PoolStateUninitializedCard poolId={1} onRetry={refetchPool} />
        </div>
      );
    }
    return (
      <div className="space-y-6 animate-pulse" aria-busy="true">
        <div className="h-10 w-48 bg-surface-container-high/60 rounded-xl" />
        <div className="card p-6 rounded-2xl bg-surface-container/40 border border-outline-variant/10 min-h-[160px]" />
        <div className="card p-6 rounded-2xl bg-surface-container/40 border border-outline-variant/10 min-h-[400px]" />
      </div>
    );
  }

  const activePool = onChainPool;

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
          type="button"
          onClick={handleRefresh}
          disabled={isBusyRefreshing}
          aria-busy={isRefreshing || isDrawsRefetching}
          aria-label={t("refresh")}
          title={t("refresh")}
          className="flex items-center gap-1.5 rounded-xl border border-surface-bright/15 hover:bg-surface-bright/5 px-3 py-2 text-xs font-semibold text-on-surface transition cursor-pointer self-start sm:self-auto disabled:opacity-50 select-none"
        >
          <svg
            className={`w-3.5 h-3.5 ${isBusyRefreshing ? "animate-spin text-primary" : "text-on-surface-variant"}`}
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
          <span>{t("refresh")}</span>
        </button>
      </div>

      {/* ── Aggregate Metrics Row ─────────────────────────────────── */}
      <DrawStatsSummary
        stats={stats}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        isLoading={isDrawsLoading}
        isLifetimeYieldLoading={isPoolLoading}
      />

      {/* ── Historical Draws List ─────────────────────────────────── */}
      <DrawHistoryList
        draws={drawSummaries}
        onSelectDraw={handleOpenInspector}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        isLoading={isDrawsLoading}
        isSyncing={isDrawsRefetching || isRefreshing}
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
        bondPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        pool={activePool}
        initialStatus={selectedDrawSummary?.status}
        minYieldThreshold={activePool.minYieldThreshold}
        onCrankWinner={isConnected ? handleCrankWinner : undefined}
        crankingCycles={crankingCycles}
      />

      {/* Background Transaction Progress Modal */}
      <TransactionProgressModal
        isOpen={actionStage !== null}
        stage={actionStage}
        title={t("crankModalTitle")}
        customSuccessMessage={t("crankSuccessMsg")}
        error={actionRunnerError}
        txSignature={actionTxSignature}
        onRetry={retryActionRunner}
        onClose={resetActionRunner}
      />
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
