"use client";

import { useState } from "react";
import { useWalletConnection } from "@solana/react-hooks";
import { useBondsContract } from "@/app/hooks/useBondsContract";
import { parseTransactionError } from "@/app/lib/errors";
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
import PrizeDetailsModal from "@/app/components/portfolio/PrizeDetailsModal";
import CompleteLedgerModal from "@/app/components/portfolio/CompleteLedgerModal";
import {
  MOCK_POOL,
  MOCK_USER_TICKETS,
  MOCK_WALLET_BALANCE,
  MOCK_RECENT_WINNERS,
  MOCK_LIFETIME_WINNINGS,
  MOCK_AUTO_REINVESTED_TOTAL,
  MOCK_PRIZE_HISTORY,
  MOCK_ACTIVITY_FEED,
  INITIAL_PENDING_REDEMPTIONS,
  formatTokenAmount,
} from "@/app/mock-data";
import type {
  ActivityEntry,
  PendingRedemption,
  PrizeHistoryEntry,
  PrizeStatus,
} from "@/app/types";

export default function DashboardPage() {
  const { status, wallet } = useWalletConnection();
  const isConnected = status === "connected";
  const userAddress = wallet?.account.address.toString();

  const {
    pool: onChainPool,
    userTickets: onChainTickets,
    userWinnings: onChainWinnings,
    pendingRedemptions: onChainPendingRedemptions,
    walletBalance,
    refetch,
    actions,
  } = useBondsContract(1);

  // Active pool for deriving parameters
  const activePool = isConnected && onChainPool ? onChainPool : MOCK_POOL;

  // ── On-chain Draw History & Activity Feed hooks ──
  const {
    prizeHistory: onChainPrizeHistory,
    recentWinners: onChainRecentWinners,
    refetch: refetchDrawHistory,
  } = useDrawHistory(
    1,
    isConnected && onChainPool ? onChainPool.currentDrawCycleId : undefined,
    isConnected ? userAddress : undefined,
    activePool.tokenSymbol,
    activePool.bondPrice
  );

  const {
    entries: onChainActivityFeed,
    refetch: refetchActivity,
    prependLocal,
  } = useActivityFeed(
    isConnected ? userAddress : undefined,
    activePool.tokenDecimals
  );

  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [selectedPrizeDetails, setSelectedPrizeDetails] =
    useState<PrizeHistoryEntry | null>(null);
  const [showCompleteLedger, setShowCompleteLedger] = useState(false);
  const [crankingCycles, setCrankingCycles] = useState<Record<string, boolean>>(
    {}
  );

  /** Composite key for crankingCycles to disambiguate entries in the same draw cycle */
  const crankKey = (drawCycleId: number, winnerIndex: number) =>
    `${drawCycleId}-${winnerIndex}`;

  // Fallbacks to mock data when wallet is not connected
  const [pendingRedemptions, setPendingRedemptions] = useState<
    PendingRedemption[]
  >(INITIAL_PENDING_REDEMPTIONS);
  const [mockPrizeHistory, setMockPrizeHistory] =
    useState<PrizeHistoryEntry[]>(MOCK_PRIZE_HISTORY);
  const [mockActivityFeed, setMockActivityFeed] =
    useState<ActivityEntry[]>(MOCK_ACTIVITY_FEED);

  const [unclaimedWinningsBalance, setUnclaimedWinningsBalance] =
    useState(7_000_000); // 7.00 USDC in base units representing historical dust
  const [lifetimeWinnings] = useState(MOCK_LIFETIME_WINNINGS);
  const [autoReinvestedTotal, setAutoReinvestedTotal] = useState(
    MOCK_AUTO_REINVESTED_TOTAL
  );

  // Active state selections — prefer on-chain data when connected
  const activeTickets =
    isConnected && onChainTickets ? onChainTickets : MOCK_USER_TICKETS;
  const activePendingRedemptions = isConnected
    ? onChainPendingRedemptions
    : pendingRedemptions;
  const activeUnclaimedWinnings =
    isConnected && onChainWinnings
      ? Number(onChainWinnings.unclaimedNonReinvestedWinnings)
      : unclaimedWinningsBalance;
  const activeAutoReinvestedTotal =
    isConnected && onChainWinnings
      ? Number(onChainWinnings.totalReinvested)
      : autoReinvestedTotal;
  const activeLifetimeWinnings =
    isConnected && onChainWinnings
      ? Number(
          onChainWinnings.totalClaimed +
            onChainWinnings.totalReinvested +
            onChainWinnings.unclaimedNonReinvestedWinnings
        )
      : lifetimeWinnings;
  const activeNonReinvestedWinnings =
    activeLifetimeWinnings - activeAutoReinvestedTotal;

  // ── Hydrated data: real when connected, mock when disconnected ──
  const activePrizeHistory = isConnected
    ? onChainPrizeHistory
    : mockPrizeHistory;
  const activeActivityFeed = isConnected
    ? onChainActivityFeed
    : mockActivityFeed;
  const activeRecentWinners = isConnected
    ? onChainRecentWinners
    : MOCK_RECENT_WINNERS;

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
  const handleDepositSuccess = (tickets: number, value: number) => {
    const newActivity: ActivityEntry = {
      id: `act-dep-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "deposit",
      description: `Deposited ${value / 1_000_000} USDC → +${tickets} tickets`,
      amount: value,
    };

    if (isConnected) {
      refetch();
      refetchDrawHistory();
      prependLocal(newActivity);
    } else {
      setMockActivityFeed((prev) => [newActivity, ...prev]);
    }
  };

  const handleWithdrawSuccess = (tickets: number, value: number) => {
    const newActivity: ActivityEntry = {
      id: `act-w-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "withdraw",
      description: `Requested withdrawal of ${tickets} bonds (${value / 1_000_000} USDC) · Pending settle`,
      amount: value,
    };

    if (isConnected) {
      refetch();
      prependLocal(newActivity);
    } else {
      const newRedemption: PendingRedemption = {
        redemptionId: `red-w-${Date.now()}`,
        amount: value,
        status: "settling",
        requestedAt: new Date().toISOString(),
        type: "bond_sale",
      };
      setPendingRedemptions((prev) => [newRedemption, ...prev]);
      setMockActivityFeed((prev) => [newActivity, ...prev]);
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

    // Set status to cranking
    setCrankingCycles((prev) => ({ ...prev, [key]: true }));

    setTxError(null);
    try {
      if (isConnected) {
        // Run contract reinvest crank (max 5 bonds batch)
        await actions.reinvestWinnings(drawCycleId, entry.winnerIndex, 5);
        refetch();
        refetchDrawHistory();
        refetchActivity();
      } else {
        // Simulate a realistic 1.5-second transaction processing delay
        await new Promise((resolve) => setTimeout(resolve, 1500));

        const BOND_PRICE = MOCK_POOL.bondPrice; // 5 USDC in base units = 5_000_000
        const MAX_BONDS = 5;

        // Current amount already reinvested
        const currentReinvested = entry.amountReinvested || 0;
        // Winnings amount remaining to be processed
        const remainingWinnings = entry.amount - currentReinvested;

        if (remainingWinnings <= 0) return;

        // How many bonds can we purchase in this batch?
        const possibleBondsToBuy = Math.floor(remainingWinnings / BOND_PRICE);
        const bondsToBuyInBatch = Math.min(MAX_BONDS, possibleBondsToBuy);

        const batchReinvestedAmount = bondsToBuyInBatch * BOND_PRICE;
        const newReinvestedAmount = currentReinvested + batchReinvestedAmount;
        const newTicketsCount =
          (entry.reinvestedTickets || 0) + bondsToBuyInBatch;

        // Remaining after this batch
        const postBatchRemaining = entry.amount - newReinvestedAmount;

        // Is this the final batch?
        const isFinalBatch = postBatchRemaining < BOND_PRICE;

        let finalStatus: PrizeStatus = "partial";
        let dustAmount = 0;
        const finalReinvestedAmount = newReinvestedAmount;

        if (isFinalBatch) {
          finalStatus = "reinvested";
          dustAmount = postBatchRemaining; // Any leftovers < 1 bond is dust
        }

        // Update Prize History (mock path only)
        setMockPrizeHistory((prev) =>
          prev.map((p) =>
            p.drawCycleId === drawCycleId && p.winnerIndex === winnerIndex
              ? {
                  ...p,
                  status: finalStatus,
                  amountReinvested: finalReinvestedAmount,
                  reinvestedTickets: newTicketsCount,
                  dustAccumulated: dustAmount,
                }
              : p
          )
        );

        // If modal is open and showing this entry, update the modal's selected entry state too
        if (
          selectedPrizeDetails?.drawCycleId === drawCycleId &&
          selectedPrizeDetails?.winnerIndex === winnerIndex
        ) {
          setSelectedPrizeDetails((prev) =>
            prev
              ? {
                  ...prev,
                  status: finalStatus,
                  amountReinvested: finalReinvestedAmount,
                  reinvestedTickets: newTicketsCount,
                  dustAccumulated: dustAmount,
                }
              : null
          );
        }

        // Update user tickets (active)
        if (bondsToBuyInBatch > 0) {
          MOCK_USER_TICKETS.activeTicketsCount += bondsToBuyInBatch;
        }

        // Update stateful autoReinvestedTotal
        setAutoReinvestedTotal((prev) => prev + batchReinvestedAmount);

        // If final batch, credit any dust to unclaimedWinningsBalance
        if (isFinalBatch && dustAmount > 0) {
          setUnclaimedWinningsBalance((prev) => prev + dustAmount);
        }

        // Add Activity Feed Entry
        const newActivity: ActivityEntry = {
          id: `act-crank-${drawCycleId}-${Date.now()}`,
          date: new Date().toISOString().split("T")[0],
          type: "auto-reinvest",
          description: isFinalBatch
            ? `Crank finalized Draw #${drawCycleId} reinvestment: +${newTicketsCount} tickets, $${formatTokenAmount(dustAmount, MOCK_POOL.tokenDecimals)} USDC dust accumulated`
            : `Crank batch executed for Draw #${drawCycleId}: reinvested $${formatTokenAmount(batchReinvestedAmount, MOCK_POOL.tokenDecimals)} USDC (+${bondsToBuyInBatch} tickets)`,
          amount: batchReinvestedAmount,
        };
        setMockActivityFeed((prev) => [newActivity, ...prev]);
      }
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Reinvest crank cancelled by user.");
      } else {
        console.error("Reinvest crank failed:", err);
        setTxError(parsed.message);
      }
    } finally {
      // Clear cranking status
      setCrankingCycles((prev) => ({ ...prev, [key]: false }));
    }
  };

  const handleClaimNonReinvestedWinnings = async () => {
    if (activeUnclaimedWinnings === 0) return;

    const claimAmount = activeUnclaimedWinnings;

    const newActivity: ActivityEntry = {
      id: `act-claim-dust-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "win",
      description: `Claimed accumulated dust winnings of $${formatTokenAmount(claimAmount, activePool.tokenDecimals)} USDC · Pending Huma settle`,
      amount: claimAmount,
    };

    setTxError(null);
    try {
      if (isConnected) {
        await actions.claimNonReinvestedWinnings();
        refetch();
        refetchDrawHistory();
        prependLocal(newActivity);
      } else {
        setUnclaimedWinningsBalance(0);
        const newRedemption: PendingRedemption = {
          redemptionId: `red-dust-claim-${Date.now()}`,
          amount: claimAmount,
          status: "settling",
          requestedAt: new Date().toISOString(),
          type: "prize_claim",
        };
        setPendingRedemptions((prev) => [newRedemption, ...prev]);
        setMockActivityFeed((prev) => [newActivity, ...prev]);
      }
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Claim non-reinvested winnings cancelled by user.");
      } else {
        console.error("Failed to claim dust on-chain:", err);
        setTxError(parsed.message);
      }
    }
  };

  // Handlers for Pending Redemptions (Claims & Simulator)
  const handleSimulateSettlement = (id: string) => {
    setPendingRedemptions((prev) =>
      prev.map((r) => (r.redemptionId === id ? { ...r, status: "ready" } : r))
    );
  };

  const handleClaimRedemption = async (id: string) => {
    const redemption = activePendingRedemptions.find(
      (r) => r.redemptionId === id
    );
    if (!redemption) return;

    setTxError(null);
    try {
      if (isConnected) {
        await actions.claimRedemption(id);
        refetch();
      } else {
        setPendingRedemptions((prev) =>
          prev.filter((r) => r.redemptionId !== id)
        );
      }

      const newActivity: ActivityEntry = {
        id: `act-claim-red-${id}-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
        type: "claim-redemption",
        description: `Claimed settled ${
          redemption.type === "bond_sale" ? "bond principal" : "prize winnings"
        } of $${redemption.amount / 1_000_000} USDC to wallet`,
        amount: redemption.amount,
      };

      if (isConnected) {
        prependLocal(newActivity);
      } else {
        setMockActivityFeed((prev) => [newActivity, ...prev]);
      }
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Claim redemption cancelled by user.");
      } else {
        console.error("Failed to claim redemption on-chain:", err);
        setTxError(parsed.message);
      }
    }
  };

  return (
    <div className="space-y-6">
      {/* Transaction Error Banner */}
      {txError && (
        <div className="rounded-xl bg-error/15 border border-error/30 p-4 text-sm text-error flex items-start gap-3 animate-fade-in shadow-ambient">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0 mt-0.5"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div className="flex-1 space-y-1">
            <h4 className="font-bold text-on-surface">Transaction Failed</h4>
            <p className="text-xs text-on-surface-variant font-mono leading-normal break-all">
              {txError}
            </p>
          </div>
          <button
            onClick={() => setTxError(null)}
            className="text-error/70 hover:text-error transition cursor-pointer text-lg font-bold leading-none px-1.5"
          >
            &times;
          </button>
        </div>
      )}

      {/* ── Unclaimed Winnings Banner ──────────────────────────────── */}
      {activeUnclaimedWinnings > 0 && (
        <UnclaimedBanner
          totalUnclaimed={activeUnclaimedWinnings}
          tokenSymbol={activePool.tokenSymbol}
          tokenDecimals={activePool.tokenDecimals}
          onClaim={handleClaimNonReinvestedWinnings}
        />
      )}

      {/* ── Holdings Summary (Hero Row) ────────────────────────────── */}
      <PortfolioHeroRow
        netWorth={netWorth}
        investedAmount={investedAmount}
        redeemingAmount={redeemingAmount}
        activeTickets={activeTickets.activeTicketsCount}
        pendingTickets={activeTickets.pendingTicketsCount}
        lifetimeWinnings={activeLifetimeWinnings}
        autoReinvestedTotal={activeAutoReinvestedTotal}
        nonReinvestedWinnings={activeNonReinvestedWinnings}
        tokenSymbol={activePool.tokenSymbol}
        tokenDecimals={activePool.tokenDecimals}
      />

      {/* ── Bond Holdings + Activity Feed (two-column) ─────────────── */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Pool Card & Pending Redemptions — takes 3 of 5 columns */}
        <div className="lg:col-span-3 flex flex-col gap-6">
          <div>
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
                Active Pool
              </h2>
            </div>
            <PoolCard
              pool={activePool}
              userTickets={activeTickets}
              onDeposit={() => setShowDeposit(true)}
              onWithdraw={() => setShowWithdraw(true)}
            />
          </div>

          <div className="flex-1">
            <PendingRedemptionsList
              redemptions={activePendingRedemptions}
              onClaimRedemption={handleClaimRedemption}
              onSimulateSettlement={handleSimulateSettlement}
              tokenSymbol={activePool.tokenSymbol}
              tokenDecimals={activePool.tokenDecimals}
              showSimulation={!isConnected}
            />
          </div>
        </div>

        {/* Activity Feed — takes 2 of 5 columns */}
        <div className="lg:col-span-2 flex flex-col">
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
              Activity Feed
            </h2>
          </div>
          <div className="flex-1 min-h-0">
            <ActivityFeed entries={activeActivityFeed} />
          </div>
        </div>
      </div>

      {/* ── Prize History Ledger ────────────────────────────────────── */}
      <PrizeHistoryLedger
        entries={activePrizeHistory}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        unclaimedTotal={activeUnclaimedWinnings}
        onClaim={handleClaimNonReinvestedWinnings}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeDetails(entry)}
        onViewCompleteLedger={() => setShowCompleteLedger(true)}
        crankingCycles={crankingCycles}
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
          walletBalance={isConnected ? walletBalance : MOCK_WALLET_BALANCE}
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
        onSimulateCrank={handleSimulateCrank}
        crankingCycles={crankingCycles}
      />

      <CompleteLedgerModal
        entries={activePrizeHistory}
        isOpen={showCompleteLedger}
        onClose={() => setShowCompleteLedger(false)}
        tokenDecimals={activePool.tokenDecimals}
        tokenSymbol={activePool.tokenSymbol}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeDetails(entry)}
        crankingCycles={crankingCycles}
      />
    </div>
  );
}
