"use client";

import { useState, useMemo, useCallback } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useBondsContext } from "@/app/components/providers/BondsProvider";
import { usePrizePool } from "@/app/hooks/queries/usePrizePool";
import { useDrawHistory } from "@/app/hooks/useDrawHistory";
import { useActivityFeed } from "@/app/hooks/useActivityFeed";
import { bondsKeys } from "@/app/lib/query-keys";
import {
  calculateReinvestmentBreakdown,
  invalidateDrawQueries,
  type UserPrizeLedgerCacheData,
} from "@/app/lib/draw-helpers";
import { mapDtoToPrizeHistoryEntry } from "@/app/lib/indexer-mappers";
import { createOptimisticActivity } from "@/app/lib/activity-helpers";
import { UnclaimedBanner } from "@/app/components/dashboard/UnclaimedBanner";
import { PortfolioHeroRow } from "@/app/components/portfolio/PortfolioHeroRow";
import { PoolCard } from "@/app/components/dashboard/PoolCard";
import { ActivityFeed } from "@/app/components/portfolio/ActivityFeed";
import { PrizeHistoryLedger } from "@/app/components/portfolio/PrizeHistoryLedger";
import { PendingRedemptionsList } from "@/app/components/portfolio/PendingRedemptionsList";
import { RecentWinnersTicker } from "@/app/components/dashboard/RecentWinnersTicker";
import { DepositModal } from "@/app/components/dashboard/DepositModal";
import { WithdrawModal } from "@/app/components/dashboard/WithdrawModal";
import { TransactionProgressModal } from "@/app/components/dashboard/TransactionProgressModal";
import { useTransactionRunner } from "@/app/hooks/useTransactionRunner";
import PrizeDetailsModal from "@/app/components/portfolio/PrizeDetailsModal";
import CompleteLedgerModal from "@/app/components/portfolio/CompleteLedgerModal";
import CompleteActivityModal from "@/app/components/portfolio/CompleteActivityModal";
import { formatTokenAmount } from "@/app/lib/formatters";
import { PoolStateErrorCard } from "@/app/components/dashboard/PoolStateErrorCard";
import { PoolStateUninitializedCard } from "@/app/components/dashboard/PoolStateUninitializedCard";
import { DashboardLoadingSkeleton } from "@/app/components/dashboard/DashboardLoadingSkeleton";
import type {
  ActivityEntry,
  PendingRedemption,
  PrizeHistoryEntry,
  UserTicketInfo,
  RecentWinner,
} from "@/app/types";

export default function DashboardPage() {
  const tPools = useTranslations("Pools");
  const tActivity = useTranslations("Activity");
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const userAddress = wallet?.account.address.toString();

  const {
    pool: onChainPool,
    userTickets: onChainTickets,
    userWinnings: onChainWinnings,
    pendingRedemptions: onChainPendingRedemptions,
    walletBalance,
    isFirstDeposit,
    isLoading: isBondsLoading,
    isPoolLoading,
    isPoolError,
    poolError,
    refetch,
    refetchOnChain,
    actions,
  } = useBondsContext();

  // Register active query observer on Dashboard page to enable native refetchOnMount
  const { data: poolData } = usePrizePool(1);
  const activePool = poolData ?? onChainPool;

  const poolTokenSymbol = activePool?.tokenSymbol ?? "USDC";
  const poolTokenDecimals = activePool?.tokenDecimals ?? 6;
  const poolBondPrice = activePool?.bondPrice ?? 5_000_000;
  const poolId = activePool?.poolId ?? 1;

  const queryClient = useQueryClient();

  // ── On-chain Draw History & Activity Feed hooks ──
  const {
    prizeHistory: onChainPrizeHistory,
    recentWinners: onChainRecentWinners,
    isLoading: isDrawHistoryLoading,
    refetch: refetchDrawHistory,
    markPrizeOptimisticallyProcessed,
    rollbackOptimisticPrize,
  } = useDrawHistory({
    poolId: 1,
    userAddress: isConnected ? userAddress : undefined,
    tokenSymbol: poolTokenSymbol,
    maxCyclesToFetch: 50,
  });

  const {
    entries: activityEntries,
    isLoading: isActivityLoading,
    prependLocal,
  } = useActivityFeed(isConnected ? userAddress : undefined, poolId);

  // Display skeleton loaders during connecting status to eliminate FOEC
  const isInitialLoading = status === "connecting";

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [selectedPrizeEntry, setSelectedPrizeEntry] =
    useState<PrizeHistoryEntry | null>(null);
  const [showCompleteLedger, setShowCompleteLedger] = useState(false);
  const [showCompleteActivity, setShowCompleteActivity] = useState(false);
  const [crankingCycles, setCrankingCycles] = useState<Record<string, boolean>>(
    {}
  );
  const {
    stage: actionStage,
    txSignature: actionTxSignature,
    error: actionError,
    runTransaction: runActionTx,
    retry: retryActionTx,
    reset: resetActionRunner,
  } = useTransactionRunner();
  const [actionModalTitle, setActionModalTitle] = useState<string>("");
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string>("");
  const [claimingRedemptionId, setClaimingRedemptionId] = useState<
    string | null
  >(null);

  /** Composite key for crankingCycles to disambiguate entries in the same draw cycle */
  const crankKey = (drawCycleId: number, winnerIndex: number) =>
    `${drawCycleId}-${winnerIndex}`;

  // Prefetch first page of prize ledger on hover/trigger
  const prefetchPrizeLedger = useCallback(() => {
    if (!isConnected || !userAddress) return;
    void queryClient.prefetchQuery({
      queryKey: bondsKeys.userPrizeLedger(poolId, userAddress, {
        page: 1,
        pageSize: 10,
        status: "all",
        tier: "all",
        search: "",
      }),
      queryFn: async () => {
        const url = new URL("/api/indexer/winners", window.location.origin);
        url.searchParams.set("user", userAddress);
        url.searchParams.set("poolId", String(poolId));
        url.searchParams.set("page", "1");
        url.searchParams.set("pageSize", "10");
        const res = await fetch(url.toString());
        const json = await res.json();
        const entries = (json.data || []).map(mapDtoToPrizeHistoryEntry);
        return {
          entries,
          pagination: json.meta ?? {
            page: 1,
            pageSize: 10,
            totalCount: entries.length,
            totalPages: Math.max(1, Math.ceil(entries.length / 10)),
            hasNextPage: false,
            hasPreviousPage: false,
          },
          aggregates: json.aggregates ?? { totalFilteredValue: "0" },
        };
      },
      staleTime: 10_000,
    });
  }, [isConnected, userAddress, poolId, queryClient]);

  // Prefetch initial activity stream on hover/trigger
  const prefetchActivityFeed = useCallback(() => {
    if (!isConnected || !userAddress) return;
    void queryClient.prefetchInfiniteQuery({
      queryKey: bondsKeys.activityFeed(poolId, userAddress, {
        type: "all",
        search: "",
      }),
      queryFn: async () => {
        const url = new URL("/api/indexer/activity", window.location.origin);
        url.searchParams.set("user", userAddress);
        url.searchParams.set("poolId", String(poolId));
        url.searchParams.set("limit", "20");
        const res = await fetch(url.toString());
        return res.json();
      },
      initialPageParam: undefined,
      staleTime: 10_000,
    });
  }, [isConnected, userAddress, poolId, queryClient]);

  // Active state selections — strictly real on-chain data when connected, zero/empty when disconnected
  const activeTickets: UserTicketInfo =
    isConnected && onChainTickets
      ? onChainTickets
      : { poolId: 1, activeTicketsCount: 0, pendingTicketsCount: 0 };

  const activePendingRedemptions: PendingRedemption[] =
    isConnected && onChainPendingRedemptions ? onChainPendingRedemptions : [];

  const activeUnclaimedWinnings =
    isConnected && onChainWinnings
      ? Number(onChainWinnings.unclaimedNonReinvestedWinnings)
      : 0;

  const activeAutoReinvestedTotal =
    isConnected && onChainWinnings
      ? Number(onChainWinnings.totalReinvested)
      : 0;

  const activeLifetimeWinnings =
    isConnected && onChainWinnings
      ? Number(
          onChainWinnings.totalClaimed +
            onChainWinnings.totalReinvested +
            onChainWinnings.unclaimedNonReinvestedWinnings
        )
      : 0;

  const activeNonReinvestedWinnings =
    activeLifetimeWinnings - activeAutoReinvestedTotal;

  // Hydrated data: real when connected / public from RPC
  const activePrizeHistory: PrizeHistoryEntry[] = useMemo(
    () => (isConnected ? onChainPrizeHistory : []),
    [isConnected, onChainPrizeHistory]
  );

  // Multi-scope reactive derivation of the currently selected prize entry
  const activeSelectedPrizeEntry = useMemo(() => {
    if (!selectedPrizeEntry) return null;

    // 1. Check unpaginated top-50 activePrizeHistory
    const historyMatch = activePrizeHistory.find(
      (p) =>
        p.drawCycleId === selectedPrizeEntry.drawCycleId &&
        p.winnerIndex === selectedPrizeEntry.winnerIndex
    );
    if (historyMatch) return historyMatch;

    // 2. Check cached paginated userPrizeLedger queries
    if (userAddress) {
      const ledgerQueries =
        queryClient.getQueriesData<UserPrizeLedgerCacheData>({
          queryKey: bondsKeys.userPrizeLedgerRoot(poolId, userAddress),
        });
      for (const [, queryData] of ledgerQueries) {
        const ledgerMatch = queryData?.entries?.find(
          (p) =>
            p.drawCycleId === selectedPrizeEntry.drawCycleId &&
            p.winnerIndex === selectedPrizeEntry.winnerIndex
        );
        if (ledgerMatch) return ledgerMatch;
      }
    }

    return selectedPrizeEntry;
  }, [
    selectedPrizeEntry,
    activePrizeHistory,
    userAddress,
    poolId,
    queryClient,
  ]);

  const activeActivityFeed: ActivityEntry[] = isConnected
    ? activityEntries
    : [];
  const activeRecentWinners: RecentWinner[] = onChainRecentWinners;

  // Net Worth includes active ticket value plus all pending redemptions (Huma async claims)
  const pendingRedemptionsTotal = activePendingRedemptions.reduce(
    (sum, r) => sum + r.amount,
    0
  );
  const investedAmount = activePool
    ? (activeTickets.activeTicketsCount + activeTickets.pendingTicketsCount) *
      activePool.bondPrice
    : 0;
  const redeemingAmount = pendingRedemptionsTotal;
  const netWorth = investedAmount + redeemingAmount + activeUnclaimedWinnings;

  // Handlers for Deposit/Withdraw Success
  const handleDepositSuccess = (
    tickets: number,
    value: number,
    signature?: string
  ) => {
    if (isConnected && userAddress) {
      refetch();
      refetchDrawHistory();
      if (signature) {
        prependLocal(
          createOptimisticActivity({
            activityType: "deposit",
            bonds: tickets,
            amountUsdc: value,
            decimals: poolTokenDecimals,
            txSignature: signature,
          }),
          userAddress
        );
      }
    }
  };

  const handleWithdrawSuccess = (
    tickets: number,
    value: number,
    signature?: string
  ) => {
    if (isConnected && userAddress) {
      refetch();
      if (signature) {
        prependLocal(
          createOptimisticActivity({
            activityType: "withdraw",
            bonds: tickets,
            amountUsdc: value,
            decimals: poolTokenDecimals,
            txSignature: signature,
          }),
          userAddress
        );
      }
    }
  };

  // Handlers for Prize Crank Reinvestment & Dust Claiming
  const handleSimulateCrank = useCallback(
    async (drawCycleId: number, winnerIndex: number) => {
      // Multi-cache resolution
      let entry =
        selectedPrizeEntry?.drawCycleId === drawCycleId &&
        selectedPrizeEntry?.winnerIndex === winnerIndex
          ? selectedPrizeEntry
          : activePrizeHistory.find(
              (p) =>
                p.drawCycleId === drawCycleId && p.winnerIndex === winnerIndex
            );

      if (!entry && userAddress) {
        const ledgerQueries =
          queryClient.getQueriesData<UserPrizeLedgerCacheData>({
            queryKey: bondsKeys.userPrizeLedgerRoot(poolId, userAddress),
          });
        for (const [, queryData] of ledgerQueries) {
          const match = queryData?.entries?.find(
            (p) =>
              p.drawCycleId === drawCycleId && p.winnerIndex === winnerIndex
          );
          if (match) {
            entry = match;
            break;
          }
        }
      }

      if (!entry || entry.status === "reinvested") return;
      const key = crankKey(drawCycleId, winnerIndex);
      if (crankingCycles[key]) return;

      setCrankingCycles((prev) => ({ ...prev, [key]: true }));
      setActionModalTitle("Run Reinvestment Crank");
      setActionSuccessMsg("Prize draw winnings successfully reinvested!");

      const breakdown = calculateReinvestmentBreakdown(
        entry.amount,
        activeUnclaimedWinnings,
        poolBondPrice
      );

      try {
        if (isConnected && userAddress) {
          const initiatingAddress = userAddress;
          await runActionTx(
            async () => {
              const sig = await actions.reinvestWinnings(
                drawCycleId,
                entry.winnerIndex,
                initiatingAddress
              );
              markPrizeOptimisticallyProcessed({
                drawCycleId,
                winnerIndex: entry.winnerIndex,
                breakdown,
                txSignature: sig,
              });
              return sig;
            },
            (capturedSig) => {
              refetch();
              refetchDrawHistory();
              invalidateDrawQueries(queryClient, poolId);
              if (breakdown.bondsBought > 0 && capturedSig) {
                prependLocal(
                  createOptimisticActivity({
                    activityType: "auto-reinvest",
                    bonds: breakdown.bondsBought,
                    amountUsdc: breakdown.bondsBought * poolBondPrice,
                    cycleId: drawCycleId,
                    decimals: poolTokenDecimals,
                    txSignature: capturedSig,
                  }),
                  initiatingAddress
                );
              }
              setTimeout(() => {
                queryClient.invalidateQueries({
                  queryKey: bondsKeys.userPrizeHistory(
                    poolId,
                    initiatingAddress ?? "anonymous"
                  ),
                });
                queryClient.invalidateQueries({
                  queryKey: bondsKeys.userPrizeLedgerRoot(
                    poolId,
                    initiatingAddress
                  ),
                });
                queryClient.invalidateQueries({
                  queryKey: bondsKeys.userPosition(poolId, initiatingAddress),
                });
                queryClient.invalidateQueries({
                  queryKey: bondsKeys.activityFeed(poolId, initiatingAddress),
                });
              }, 4000);
            }
          );
        }
      } catch (err) {
        console.error("Reinvest crank failed:", err);
        rollbackOptimisticPrize(drawCycleId, entry.winnerIndex);
      } finally {
        setCrankingCycles((prev) => ({ ...prev, [key]: false }));
      }
    },
    [
      activePrizeHistory,
      selectedPrizeEntry,
      crankingCycles,
      activeUnclaimedWinnings,
      poolBondPrice,
      poolId,
      isConnected,
      runActionTx,
      actions,
      userAddress,
      markPrizeOptimisticallyProcessed,
      refetch,
      refetchDrawHistory,
      prependLocal,
      poolTokenDecimals,
      queryClient,
      rollbackOptimisticPrize,
      setActionModalTitle,
      setActionSuccessMsg,
    ]
  );

  const handleClaimNonReinvestedWinnings = async () => {
    if (activeUnclaimedWinnings === 0) return;

    const claimAmount = activeUnclaimedWinnings;
    setActionModalTitle("Claim Remaining Winnings");
    setActionSuccessMsg(
      `Claimed accumulated remaining winnings of $${formatTokenAmount(claimAmount, poolTokenDecimals)} USDC.`
    );

    try {
      if (isConnected && userAddress) {
        const initiatingAddress = userAddress;
        await runActionTx(
          () => actions.claimNonReinvestedWinnings(claimAmount),
          (capturedSig) => {
            refetch();
            refetchDrawHistory();
            if (capturedSig) {
              prependLocal(
                createOptimisticActivity({
                  activityType: "win",
                  amountUsdc: claimAmount,
                  decimals: poolTokenDecimals,
                  txSignature: capturedSig,
                }),
                initiatingAddress
              );
            }
          }
        );
      }
    } catch (err) {
      console.error("Claim remaining winnings failed:", err);
    }
  };

  // Handlers for Pending Redemptions
  const handleSimulateSettlement = () => {
    // No-op in production mode without mock data
  };

  const handleClaimRedemption = async (id: string) => {
    const redemption = activePendingRedemptions.find(
      (r) => r.redemptionId === id
    );
    if (!redemption) return;
    setClaimingRedemptionId(id);

    setActionModalTitle("Claim Settled Redemption");
    setActionSuccessMsg(
      `Successfully claimed settled ${
        redemption.type === "bond_sale"
          ? "bond principal"
          : redemption.type === "fee_withdrawal"
            ? "fees"
            : "prize winnings"
      } of $${formatTokenAmount(redemption.amount, 6)} USDC to wallet.`
    );

    try {
      if (isConnected && userAddress) {
        const initiatingAddress = userAddress;
        await runActionTx(
          () => actions.claimRedemption(Number(id)),
          (capturedSig) => {
            // Optimistically remove from cache once confirmed on-chain
            queryClient.setQueryData<PendingRedemption[]>(
              bondsKeys.userRedemptions(poolId, initiatingAddress),
              (old) => (old || []).filter((r) => r.redemptionId !== id)
            );
            refetchOnChain();
            if (capturedSig) {
              prependLocal(
                createOptimisticActivity({
                  activityType: "claim-redemption",
                  amountUsdc: redemption.amount,
                  redemptionType: redemption.type,
                  decimals: 6,
                  txSignature: capturedSig,
                }),
                initiatingAddress
              );
            }
            setTimeout(() => {
              queryClient.invalidateQueries({
                queryKey: bondsKeys.userRedemptions(
                  poolId,
                  initiatingAddress ?? "anonymous"
                ),
              });
            }, 3500);
          }
        );
      }
    } catch (err) {
      console.error("Claim redemption failed:", err);
      if (userAddress) {
        void queryClient.invalidateQueries({
          queryKey: bondsKeys.userRedemptions(
            poolId,
            userAddress ?? "anonymous"
          ),
        });
      }
    } finally {
      setClaimingRedemptionId(null);
    }
  };

  if (!activePool) {
    if (isPoolError) {
      return (
        <div className="space-y-6">
          <PoolStateErrorCard error={poolError} onRetry={refetch} />
        </div>
      );
    }
    if (!isPoolLoading && !isPoolError) {
      return (
        <div className="space-y-6">
          <PoolStateUninitializedCard poolId={1} onRetry={refetch} />
        </div>
      );
    }
    return <DashboardLoadingSkeleton />;
  }

  return (
    <div className="space-y-6">
      {/* ── Unclaimed Winnings Banner ──────────────────────────────── */}
      {activeUnclaimedWinnings > 0 && (
        <UnclaimedBanner
          totalUnclaimed={activeUnclaimedWinnings}
          tokenSymbol={activePool.tokenSymbol}
          tokenDecimals={activePool.tokenDecimals}
          bondPrice={activePool.bondPrice}
          pool={activePool}
          onClaim={handleClaimNonReinvestedWinnings}
        />
      )}

      {/* ── Holdings Summary (Hero Row) ────────────────────────────── */}
      <PortfolioHeroRow
        netWorth={netWorth}
        investedAmount={investedAmount}
        redeemingAmount={redeemingAmount}
        unclaimedAmount={activeUnclaimedWinnings}
        activeTickets={activeTickets.activeTicketsCount}
        pendingTickets={activeTickets.pendingTicketsCount}
        lifetimeWinnings={activeLifetimeWinnings}
        autoReinvestedTotal={activeAutoReinvestedTotal}
        nonReinvestedWinnings={activeNonReinvestedWinnings}
        tokenSymbol={activePool.tokenSymbol}
        tokenDecimals={activePool.tokenDecimals}
        currentDrawCycleId={activePool.currentDrawCycleId}
        stakeCycleDurationHrs={activePool.stakeCycleDurationHrs}
      />

      {/* ── Active Pool + Activity Feed (Top two-column row) ───────────── */}
      <div className="grid gap-6 lg:grid-cols-5 transition-all duration-300 items-stretch">
        {/* Pool Card — takes 3 of 5 columns */}
        <div className="lg:col-span-3 flex flex-col transition-all duration-300">
          <div className="flex items-center gap-2 mb-4 px-1 shrink-0">
            <svg
              width="18"
              height="18"
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
            <h2 className="font-display text-lg font-bold text-on-surface">
              {tPools("activePool")}
            </h2>
          </div>
          <div className="flex-1 flex flex-col">
            <PoolCard
              pool={activePool}
              userTickets={activeTickets}
              onDeposit={() => setShowDeposit(true)}
              onWithdraw={() => setShowWithdraw(true)}
            />
          </div>
        </div>

        {/* Activity Feed — takes 2 of 5 columns */}
        <div className="lg:col-span-2 flex flex-col min-h-0 transition-all duration-300 lg:h-0 lg:min-h-full">
          <div className="flex items-center gap-2 mb-4 px-1 shrink-0">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-secondary"
            >
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
            <h2 className="font-display text-lg font-bold text-on-surface">
              {tActivity("title")}
            </h2>
          </div>
          <div className="flex-1 min-h-0 flex flex-col">
            <ActivityFeed
              entries={activeActivityFeed}
              onViewCompleteFeed={() => {
                prefetchActivityFeed();
                setShowCompleteActivity(true);
              }}
              isLoading={isInitialLoading || (isConnected && isActivityLoading)}
            />
          </div>
        </div>
      </div>

      {/* ── Pending Redemptions Section (Dedicated Row) ───────────────── */}
      <div className="transition-all duration-300">
        <PendingRedemptionsList
          redemptions={activePendingRedemptions}
          onClaimRedemption={handleClaimRedemption}
          onSimulateSettlement={handleSimulateSettlement}
          tokenSymbol={activePool.tokenSymbol}
          tokenDecimals={activePool.tokenDecimals}
          showSimulation={false}
          isLoading={isInitialLoading || (isConnected && isBondsLoading)}
          claimingRedemptionId={claimingRedemptionId}
        />
      </div>

      {/* ── Prize History Ledger ────────────────────────────────────── */}
      <PrizeHistoryLedger
        entries={activePrizeHistory}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        bondPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        unclaimedTotal={activeUnclaimedWinnings}
        pool={activePool}
        onClaim={handleClaimNonReinvestedWinnings}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeEntry(entry)}
        onViewCompleteLedger={() => {
          prefetchPrizeLedger();
          setShowCompleteLedger(true);
        }}
        crankingCycles={crankingCycles}
        isLoading={isInitialLoading || (isConnected && isDrawHistoryLoading)}
      />

      {/* ── Recent Winners ─────────────────────────────────────────── */}
      <RecentWinnersTicker
        winners={activeRecentWinners}
        tokenDecimals={activePool.tokenDecimals}
      />

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {showDeposit && (
        <DepositModal
          pool={activePool}
          walletBalance={isConnected ? walletBalance : 0}
          isFirstDeposit={isConnected ? isFirstDeposit : true}
          onClose={() => setShowDeposit(false)}
          onDepositSuccess={handleDepositSuccess}
          onDeposit={isConnected ? actions.buyBonds : undefined}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          pool={activePool}
          userTickets={activeTickets}
          onClose={() => setShowWithdraw(false)}
          onWithdrawSuccess={handleWithdrawSuccess}
          onWithdraw={isConnected ? actions.sellBonds : undefined}
        />
      )}

      {/* Background Action Stage Modal */}
      <TransactionProgressModal
        isOpen={actionStage !== null}
        stage={actionStage}
        title={actionModalTitle}
        customSuccessMessage={actionSuccessMsg}
        error={actionError}
        txSignature={actionTxSignature}
        onRetry={retryActionTx}
        onClose={resetActionRunner}
      />

      <PrizeDetailsModal
        key={
          activeSelectedPrizeEntry
            ? `prize-details-${activeSelectedPrizeEntry.drawCycleId}-${activeSelectedPrizeEntry.winnerIndex}`
            : "prize-details-none"
        }
        entry={activeSelectedPrizeEntry}
        isOpen={activeSelectedPrizeEntry !== null}
        onClose={() => setSelectedPrizeEntry(null)}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        ticketPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        pool={activePool}
        onSimulateCrank={handleSimulateCrank}
        crankingCycles={crankingCycles}
      />

      <CompleteLedgerModal
        userAddress={isConnected ? userAddress : undefined}
        poolId={poolId}
        config={activePool}
        entries={activePrizeHistory}
        isOpen={showCompleteLedger}
        onClose={() => setShowCompleteLedger(false)}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        bondPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        pool={activePool}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeEntry(entry)}
        crankingCycles={crankingCycles}
        isLoading={isInitialLoading || (isConnected && isDrawHistoryLoading)}
      />

      <CompleteActivityModal
        key={userAddress ?? "unconnected"}
        userAddress={isConnected ? userAddress : undefined}
        poolId={poolId}
        entries={activeActivityFeed}
        isOpen={showCompleteActivity}
        onClose={() => setShowCompleteActivity(false)}
      />
    </div>
  );
}
