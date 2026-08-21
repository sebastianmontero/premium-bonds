"use client";

import { useState, useEffect } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useTranslations } from "next-intl";
import { useBondsContract } from "@/app/hooks/useBondsContract";
import {
  parseTransactionError,
  ParsedTransactionError,
} from "@/app/lib/errors";
import { SolanaErrorAlert } from "@/app/components/SolanaErrorAlert";
import { useDrawHistory } from "@/app/hooks/useDrawHistory";
import { useActivityFeed } from "@/app/hooks/useActivityFeed";
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
import { createDefaultPoolFallback } from "@/app/types";
import type {
  ActivityEntry,
  PendingRedemption,
  PrizeHistoryEntry,
  PoolInfo,
  UserTicketInfo,
  RecentWinner,
} from "@/app/types";

const DEFAULT_POOL_FALLBACK: PoolInfo = createDefaultPoolFallback(1);

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
    refetch,
    actions,
  } = useBondsContract(1);

  // Active pool for deriving parameters — public on-chain state when loaded, or default pool structure
  const activePool = onChainPool ?? DEFAULT_POOL_FALLBACK;

  // ── On-chain Draw History & Activity Feed hooks ──
  const {
    prizeHistory: onChainPrizeHistory,
    recentWinners: onChainRecentWinners,
    isLoading: isDrawHistoryLoading,
    refetch: refetchDrawHistory,
  } = useDrawHistory(
    1,
    onChainPool ? onChainPool.currentDrawCycleId : undefined,
    isConnected ? userAddress : undefined,
    activePool.tokenSymbol,
    activePool.bondPrice,
    50,
    activePool.currentCycleEndAt,
    activePool.stakeCycleDurationHrs
      ? activePool.stakeCycleDurationHrs * 3600
      : 604800
  );

  const {
    entries: onChainActivityFeed,
    isLoading: isActivityLoading,
    isFetchingMore: isFetchingActivityMore,
    hasMore: hasMoreActivity,
    scanProgress: activityScanProgress,
    loadMore: loadMoreActivity,
    fetchUntilMatches: fetchUntilMatchesActivity,
    refetch: refetchActivity,
    prependLocal,
  } = useActivityFeed(
    isConnected ? userAddress : undefined,
    activePool.tokenDecimals
  );

  // Initial page load simulation (1000ms) for smooth skeleton feedback and account hydration
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setIsInitialLoading(false), 1000);
    return () => clearTimeout(timer);
  }, []);

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [txError, setTxError] = useState<
    ParsedTransactionError | string | null
  >(null);
  const [lastTxAction, setLastTxAction] = useState<(() => void) | null>(null);
  const [selectedPrizeDetails, setSelectedPrizeDetails] =
    useState<PrizeHistoryEntry | null>(null);
  const [showCompleteLedger, setShowCompleteLedger] = useState(false);
  const [showCompleteActivity, setShowCompleteActivity] = useState(false);
  const [crankingCycles, setCrankingCycles] = useState<Record<string, boolean>>(
    {}
  );
  const {
    stage: actionStage,
    txSignature: actionTxSignature,
    runTransaction: runActionTx,
    reset: resetActionRunner,
  } = useTransactionRunner();
  const [actionModalTitle, setActionModalTitle] = useState<string>("");
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string>("");

  /** Composite key for crankingCycles to disambiguate entries in the same draw cycle */
  const crankKey = (drawCycleId: number, winnerIndex: number) =>
    `${drawCycleId}-${winnerIndex}`;

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
  const activePrizeHistory: PrizeHistoryEntry[] = isConnected
    ? onChainPrizeHistory
    : [];
  const activeActivityFeed: ActivityEntry[] = isConnected
    ? onChainActivityFeed
    : [];
  const activeRecentWinners: RecentWinner[] = onChainRecentWinners;

  // Net Worth includes active ticket value plus all pending redemptions (Huma async claims)
  const pendingRedemptionsTotal = activePendingRedemptions.reduce(
    (sum, r) => sum + r.amount,
    0
  );
  const investedAmount =
    (activeTickets.activeTicketsCount + activeTickets.pendingTicketsCount) *
    activePool.bondPrice;
  const redeemingAmount = pendingRedemptionsTotal;
  const netWorth = investedAmount + redeemingAmount + activeUnclaimedWinnings;

  // Handlers for Deposit/Withdraw Success
  const handleDepositSuccess = (
    tickets: number,
    value: number,
    signature?: string
  ) => {
    const newActivity: ActivityEntry = {
      id: `act-dep-${Date.now()}`,
      date: new Date().toISOString(),
      type: "deposit",
      description: `Deposited ${value / 1_000_000} USDC → +${tickets} bonds`,
      amount: value,
      txSignature: signature,
    };

    if (isConnected) {
      refetch();
      refetchDrawHistory();
      prependLocal(newActivity);
    }
  };

  const handleWithdrawSuccess = (
    tickets: number,
    value: number,
    signature?: string
  ) => {
    const newActivity: ActivityEntry = {
      id: `act-w-${Date.now()}`,
      date: new Date().toISOString(),
      type: "withdraw",
      description: `Requested withdrawal of ${tickets} bonds (${value / 1_000_000} USDC) · Pending settle`,
      amount: value,
      txSignature: signature,
    };

    if (isConnected) {
      refetch();
      prependLocal(newActivity);
    }
  };

  // Unified Transaction Error Helper (DRY logging and retry setup)
  const handleTxError = (
    err: unknown,
    actionName: string,
    retryAction?: () => void
  ) => {
    const parsed = parseTransactionError(err);
    if (parsed.isCancellation) {
      console.warn(`${actionName} cancelled by user.`);
    } else {
      console.error(`${actionName} failed:`, err);
    }
    setTxError(parsed);
    if (retryAction) {
      setLastTxAction(() => retryAction);
    }
  };

  // Handlers for Prize Crank Reinvestment & Dust Claiming
  const handleSimulateCrank = async (
    drawCycleId: number,
    winnerIndex: number
  ) => {
    const entry = activePrizeHistory.find(
      (p) => p.drawCycleId === drawCycleId && p.winnerIndex === winnerIndex
    );
    if (!entry) return;
    if (entry.status === "reinvested") return;
    const key = crankKey(drawCycleId, winnerIndex);
    if (crankingCycles[key]) return;

    setCrankingCycles((prev) => ({ ...prev, [key]: true }));
    setTxError(null);
    setActionModalTitle("Run Reinvestment Crank");
    setActionSuccessMsg("Prize draw winnings successfully reinvested!");

    try {
      if (isConnected) {
        await runActionTx(
          () =>
            actions.reinvestWinnings(
              drawCycleId,
              entry.winnerIndex,
              userAddress
            ),
          () => {
            refetch();
            refetchDrawHistory();
            refetchActivity();
          }
        );
      }
    } catch (err) {
      handleTxError(err, "Reinvest crank", () =>
        handleSimulateCrank(drawCycleId, winnerIndex)
      );
    } finally {
      setCrankingCycles((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleClaimNonReinvestedWinnings = async () => {
    if (activeUnclaimedWinnings === 0) return;

    const claimAmount = activeUnclaimedWinnings;
    setTxError(null);
    setActionModalTitle("Claim Remaining Winnings");
    setActionSuccessMsg(
      `Claimed accumulated remaining winnings of $${formatTokenAmount(claimAmount, activePool.tokenDecimals)} USDC.`
    );

    try {
      if (isConnected) {
        await runActionTx(
          () => actions.claimNonReinvestedWinnings(),
          (capturedSig) => {
            refetch();
            refetchDrawHistory();
            refetchActivity();
            const newActivity: ActivityEntry = {
              id: `act-claim-dust-${Date.now()}`,
              date: new Date().toISOString(),
              type: "win",
              description: `Claimed accumulated remaining winnings of $${formatTokenAmount(claimAmount, activePool.tokenDecimals)} USDC · Pending Huma settle`,
              amount: claimAmount,
              txSignature: capturedSig,
            };
            prependLocal(newActivity);
          }
        );
      }
    } catch (err) {
      handleTxError(err, "Claim remaining winnings", () =>
        handleClaimNonReinvestedWinnings()
      );
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

    setTxError(null);
    setActionModalTitle("Claim Settled Redemption");
    setActionSuccessMsg(
      `Successfully claimed settled ${
        redemption.type === "bond_sale" ? "bond principal" : "prize winnings"
      } of $${redemption.amount / 1_000_000} USDC to wallet.`
    );

    try {
      if (isConnected) {
        await runActionTx(
          () => actions.claimRedemption(id),
          (capturedSig) => {
            refetch();
            refetchActivity();
            const newActivity: ActivityEntry = {
              id: `act-claim-red-${id}-${Date.now()}`,
              date: new Date().toISOString(),
              type: "claim-redemption",
              description: `Claimed settled ${
                redemption.type === "bond_sale"
                  ? "bond principal"
                  : "prize winnings"
              } of $${redemption.amount / 1_000_000} USDC to wallet`,
              amount: redemption.amount,
              txSignature: capturedSig,
            };
            prependLocal(newActivity);
          }
        );
      }
    } catch (err) {
      handleTxError(err, "Claim redemption", () => handleClaimRedemption(id));
    }
  };

  return (
    <div className="space-y-6">
      {/* ── Unclaimed Winnings Banner ──────────────────────────────── */}
      {activeUnclaimedWinnings > 0 && (
        <UnclaimedBanner
          totalUnclaimed={activeUnclaimedWinnings}
          tokenSymbol={activePool.tokenSymbol}
          tokenDecimals={activePool.tokenDecimals}
          bondPrice={activePool.bondPrice}
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
              onViewCompleteFeed={() => setShowCompleteActivity(true)}
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
        onClaim={handleClaimNonReinvestedWinnings}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeDetails(entry)}
        onViewCompleteLedger={() => setShowCompleteLedger(true)}
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
        txSignature={actionTxSignature}
        onClose={resetActionRunner}
      />

      <PrizeDetailsModal
        key={
          selectedPrizeDetails
            ? `prize-details-${selectedPrizeDetails.drawCycleId}-${selectedPrizeDetails.tierIndex}-${selectedPrizeDetails.winningTicket || ""}`
            : "prize-details-none"
        }
        entry={selectedPrizeDetails}
        isOpen={selectedPrizeDetails !== null}
        onClose={() => setSelectedPrizeDetails(null)}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        ticketPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        onSimulateCrank={handleSimulateCrank}
        crankingCycles={crankingCycles}
      />

      <CompleteLedgerModal
        entries={activePrizeHistory}
        isOpen={showCompleteLedger}
        onClose={() => setShowCompleteLedger(false)}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        bondPrice={activePool.bondPrice}
        payoutTimelockSeconds={activePool.payoutTimelockSeconds ?? 300}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeDetails(entry)}
        crankingCycles={crankingCycles}
        isLoading={isInitialLoading || (isConnected && isDrawHistoryLoading)}
      />

      <CompleteActivityModal
        entries={activeActivityFeed}
        isOpen={showCompleteActivity}
        onClose={() => setShowCompleteActivity(false)}
        hasMore={hasMoreActivity}
        isFetchingMore={isFetchingActivityMore}
        isLoading={isInitialLoading || (isConnected && isActivityLoading)}
        scanProgress={activityScanProgress}
        onLoadMore={loadMoreActivity}
        onFetchUntilMatches={fetchUntilMatchesActivity}
      />

      {/* Floating Transaction Error Toast (Bottom-Right Viewport Overlay) */}
      {txError && (
        <SolanaErrorAlert
          key={
            typeof txError === "string" ? txError : txError.message + Date.now()
          }
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
