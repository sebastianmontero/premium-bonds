"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useBondsContext } from "@/app/components/providers/BondsProvider";
import { usePrizePool } from "@/app/hooks/queries/usePrizePool";
import { useDrawHistory } from "@/app/hooks/useDrawHistory";
import { useActivityFeed } from "@/app/hooks/useActivityFeed";
import { bondsKeys } from "@/app/lib/query-keys";
import { resolveActivePrizeEntry, getWinnerKey } from "@/app/lib/draw-helpers";
import { mapDtoToPrizeHistoryEntry } from "@/app/lib/indexer-mappers";
import { createOptimisticActivity } from "@/app/lib/activity-helpers";
import { useCrankPrize } from "@/app/hooks/mutations/useCrankPrize";
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
import { formatCurrency } from "@/app/lib/formatters";
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
  const poolId = activePool?.poolId ?? 1;

  const queryClient = useQueryClient();

  // ── On-chain Draw History & Activity Feed hooks ──
  const {
    prizeHistory: onChainPrizeHistory,
    recentWinners: onChainRecentWinners,
    isLoading: isDrawHistoryLoading,
    refetch: refetchDrawHistory,
  } = useDrawHistory({
    poolId: 1,
    userAddress: isConnected ? userAddress : undefined,
    tokenSymbol: poolTokenSymbol,
    maxCyclesToFetch: 50,
  });

  const crankMutation = useCrankPrize(poolId);

  const {
    entries: activityEntries,
    isLoading: isActivityLoading,
    prependLocal,
  } = useActivityFeed(isConnected ? userAddress : undefined, poolId);

  const tDashboard = useTranslations("Dashboard");

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

  // Clear open modal selection when wallet switches or disconnects to prevent cross-account leaks
  useEffect(() => {
    setSelectedPrizeEntry(null);
  }, [userAddress, isConnected]);

  // Prefetch first page of prize ledger on hover/trigger
  const prefetchPrizeLedger = useCallback(() => {
    if (!isConnected || !userAddress) return;
    void queryClient.prefetchQuery({
      queryKey: bondsKeys.userPrizeLedger(poolId, userAddress, {
        page: 1,
        pageSize: 10,
        status: "all",
        tierIndex: undefined,
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

  // Pure render-time SSoT derivation via cohesive domain helper
  const activeSelectedPrizeEntry = resolveActivePrizeEntry({
    queryClient,
    poolId,
    userAddress: isConnected ? userAddress : undefined,
    entry: selectedPrizeEntry,
    activeHistory: activePrizeHistory,
  });

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
  const handleCrankPrize = useCallback(
    async (knownEntry: PrizeHistoryEntry) => {
      const entry = resolveActivePrizeEntry({
        queryClient,
        poolId,
        userAddress,
        entry: knownEntry,
        activeHistory: activePrizeHistory,
      });

      if (!entry || entry.status === "reinvested") return;
      const key = getWinnerKey(entry.drawCycleId, entry.winnerIndex);
      if (crankingCycles[key]) return;

      setCrankingCycles((prev) => ({ ...prev, [key]: true }));
      setActionModalTitle(tDashboard("crankReinvestModalTitle"));
      setActionSuccessMsg(tDashboard("crankReinvestSuccessMsg"));

      try {
        if (isConnected && userAddress) {
          await runActionTx(async ({ onSigning }) => {
            return await crankMutation.mutateAsync({
              entry,
              onSigning,
            });
          });
        }
      } catch (err) {
        console.error("Reinvest crank failed:", err);
      } finally {
        setCrankingCycles((prev) => ({ ...prev, [key]: false }));
      }
    },
    [
      queryClient,
      poolId,
      userAddress,
      activePrizeHistory,
      crankingCycles,
      isConnected,
      runActionTx,
      crankMutation,
      setActionModalTitle,
      setActionSuccessMsg,
      tDashboard,
    ]
  );

  const handleClaimNonReinvestedWinnings = async () => {
    if (activeUnclaimedWinnings === 0) return;

    const claimAmount = activeUnclaimedWinnings;
    setActionModalTitle(tDashboard("claimWinningsModalTitle"));
    setActionSuccessMsg(
      tDashboard("claimWinningsSuccessMsg", {
        amount: formatCurrency(claimAmount, activePool, {
          style: "withSymbol",
        }),
      })
    );

    try {
      if (isConnected && userAddress) {
        const initiatingAddress = userAddress;
        await runActionTx(
          ({ onSigning }) =>
            actions.claimNonReinvestedWinnings(claimAmount, { onSigning }),
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

    const amountFormatted = formatCurrency(redemption.amount, activePool, {
      style: "withSymbol",
    });
    setActionModalTitle(tDashboard("claimRedemptionModalTitle"));
    setActionSuccessMsg(
      redemption.type === "bond_sale"
        ? tDashboard("claimRedemptionBondPrincipalSuccess", {
            amount: amountFormatted,
          })
        : redemption.type === "fee_withdrawal"
          ? tDashboard("claimRedemptionFeesSuccess", {
              amount: amountFormatted,
            })
          : tDashboard("claimRedemptionPrizesSuccess", {
              amount: amountFormatted,
            })
    );

    try {
      if (isConnected && userAddress) {
        const initiatingAddress = userAddress;
        await runActionTx(
          ({ onSigning }) => actions.claimRedemption(Number(id), { onSigning }),
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
        onCrankPrize={handleCrankPrize}
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
            ? `prize-details-${getWinnerKey(
                activeSelectedPrizeEntry.drawCycleId,
                activeSelectedPrizeEntry.winnerIndex
              )}`
            : "prize-details-none"
        }
        entry={activeSelectedPrizeEntry}
        isOpen={activeSelectedPrizeEntry !== null}
        onClose={() => setSelectedPrizeEntry(null)}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        bondPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        unclaimedDust={activeUnclaimedWinnings}
        pool={activePool}
        onCrankPrize={handleCrankPrize}
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
        unclaimedDust={activeUnclaimedWinnings}
        pool={activePool}
        onCrankPrize={handleCrankPrize}
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
