"use client";

import { useState } from "react";
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
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [selectedPrizeDetails, setSelectedPrizeDetails] =
    useState<PrizeHistoryEntry | null>(null);
  const [showCompleteLedger, setShowCompleteLedger] = useState(false);

  // Stateful tracking for user holdings and activity
  const [userTickets, setUserTickets] = useState(MOCK_USER_TICKETS);
  const [pendingRedemptions, setPendingRedemptions] = useState<
    PendingRedemption[]
  >(INITIAL_PENDING_REDEMPTIONS);
  const [prizeHistory, setPrizeHistory] =
    useState<PrizeHistoryEntry[]>(MOCK_PRIZE_HISTORY);
  const [activityFeed, setActivityFeed] =
    useState<ActivityEntry[]>(MOCK_ACTIVITY_FEED);

  const [unclaimedWinningsBalance, setUnclaimedWinningsBalance] =
    useState(7_000_000); // 7.00 USDC in base units representing historical dust
  const [lifetimeWinnings] = useState(MOCK_LIFETIME_WINNINGS);
  const [autoReinvestedTotal, setAutoReinvestedTotal] = useState(
    MOCK_AUTO_REINVESTED_TOTAL
  );

  // Net Worth includes active ticket value plus all pending redemptions (Huma async claims)
  const pendingRedemptionsTotal = pendingRedemptions.reduce(
    (sum, r) => sum + r.amount,
    0
  );
  const netWorth =
    userTickets.activeTicketsCount * MOCK_POOL.bondPrice +
    pendingRedemptionsTotal +
    unclaimedWinningsBalance;

  // Handlers for Deposit/Withdraw Success
  const handleDepositSuccess = (tickets: number, value: number) => {
    setUserTickets((prev) => ({
      ...prev,
      activeTicketsCount: prev.activeTicketsCount + tickets,
    }));

    const newActivity: ActivityEntry = {
      id: `act-dep-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "deposit",
      description: `Deposited ${value / 1_000_000} USDC → +${tickets} tickets`,
      amount: value,
    };
    setActivityFeed((prev) => [newActivity, ...prev]);
  };

  const handleWithdrawSuccess = (tickets: number, value: number) => {
    setUserTickets((prev) => ({
      ...prev,
      activeTicketsCount: prev.activeTicketsCount - tickets,
    }));

    const newRedemption: PendingRedemption = {
      redemptionId: `red-w-${Date.now()}`,
      amount: value,
      status: "settling",
      requestedAt: new Date().toISOString(),
      type: "bond_sale",
    };
    setPendingRedemptions((prev) => [newRedemption, ...prev]);

    const newActivity: ActivityEntry = {
      id: `act-w-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "withdraw",
      description: `Requested withdrawal of ${tickets} bonds (${value / 1_000_000} USDC) · Pending settle`,
      amount: value,
    };
    setActivityFeed((prev) => [newActivity, ...prev]);
  };

  // Handlers for Prize Crank Reinvestment & Dust Claiming
  const handleSimulateCrank = (drawCycleId: number) => {
    const entry = prizeHistory.find((p) => p.drawCycleId === drawCycleId);
    if (!entry) return;
    if (entry.status === "reinvested") return;

    const BOND_PRICE = MOCK_POOL.bondPrice; // 5 USDC in base units = 5_000_000
    const MAX_BONDS = 5;

    // Current amount already reinvested
    const currentReinvested = entry.amountReinvested || 0;
    // Winnings amount remaining to be processed
    const remainingWinnings = entry.amount - currentReinvested;

    if (remainingWinnings <= 0) return;

    // How many bonds can we purchase in this batch?
    // Capped by MAX_BONDS and by remainingWinnings / BOND_PRICE
    const possibleBondsToBuy = Math.floor(remainingWinnings / BOND_PRICE);
    const bondsToBuyInBatch = Math.min(MAX_BONDS, possibleBondsToBuy);

    const batchReinvestedAmount = bondsToBuyInBatch * BOND_PRICE;
    const newReinvestedAmount = currentReinvested + batchReinvestedAmount;
    const newTicketsCount = (entry.reinvestedTickets || 0) + bondsToBuyInBatch;

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

    // Update Prize History
    setPrizeHistory((prev) =>
      prev.map((p) =>
        p.drawCycleId === drawCycleId
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
    if (selectedPrizeDetails?.drawCycleId === drawCycleId) {
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
      setUserTickets((prev) => ({
        ...prev,
        activeTicketsCount: prev.activeTicketsCount + bondsToBuyInBatch,
      }));
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
    setActivityFeed((prev) => [newActivity, ...prev]);
  };

  const handleClaimNonReinvestedWinnings = () => {
    if (unclaimedWinningsBalance === 0) return;

    const claimAmount = unclaimedWinningsBalance;

    // Reset the unclaimed dust balance
    setUnclaimedWinningsBalance(0);

    // Add to pending redemptions as a prize claim settling
    const newRedemption: PendingRedemption = {
      redemptionId: `red-dust-claim-${Date.now()}`,
      amount: claimAmount,
      status: "settling",
      requestedAt: new Date().toISOString(),
      type: "prize_claim",
    };
    setPendingRedemptions((prev) => [newRedemption, ...prev]);

    const newActivity: ActivityEntry = {
      id: `act-claim-dust-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "win",
      description: `Claimed accumulated dust winnings of $${formatTokenAmount(claimAmount, MOCK_POOL.tokenDecimals)} USDC · Pending Huma settle`,
      amount: claimAmount,
    };
    setActivityFeed((prev) => [newActivity, ...prev]);
  };

  // Handlers for Pending Redemptions (Claims & Simulator)
  const handleSimulateSettlement = (id: string) => {
    setPendingRedemptions((prev) =>
      prev.map((r) => (r.redemptionId === id ? { ...r, status: "ready" } : r))
    );
  };

  const handleClaimRedemption = (id: string) => {
    const redemption = pendingRedemptions.find((r) => r.redemptionId === id);
    if (!redemption) return;

    setPendingRedemptions((prev) => prev.filter((r) => r.redemptionId !== id));

    const newActivity: ActivityEntry = {
      id: `act-claim-red-${id}-${Date.now()}`,
      date: new Date().toISOString().split("T")[0],
      type: "claim-redemption",
      description: `Claimed settled ${
        redemption.type === "bond_sale" ? "bond principal" : "prize winnings"
      } of $${redemption.amount / 1_000_000} USDC to wallet`,
      amount: redemption.amount,
    };
    setActivityFeed((prev) => [newActivity, ...prev]);
  };

  return (
    <div className="space-y-6">
      {/* ── Unclaimed Winnings Banner ──────────────────────────────── */}
      {unclaimedWinningsBalance > 0 && (
        <UnclaimedBanner
          totalUnclaimed={unclaimedWinningsBalance}
          tokenSymbol={MOCK_POOL.tokenSymbol}
          tokenDecimals={MOCK_POOL.tokenDecimals}
          onClaim={handleClaimNonReinvestedWinnings}
        />
      )}

      {/* ── Holdings Summary (Hero Row) ────────────────────────────── */}
      <PortfolioHeroRow
        netWorth={netWorth}
        activeTickets={userTickets.activeTicketsCount}
        pendingTickets={userTickets.pendingTicketsCount}
        lifetimeWinnings={lifetimeWinnings}
        autoReinvestedTotal={autoReinvestedTotal}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        tokenDecimals={MOCK_POOL.tokenDecimals}
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
              pool={MOCK_POOL}
              userTickets={userTickets}
              onDeposit={() => setShowDeposit(true)}
              onWithdraw={() => setShowWithdraw(true)}
            />
          </div>

          <div className="flex-1">
            <PendingRedemptionsList
              redemptions={pendingRedemptions}
              onClaimRedemption={handleClaimRedemption}
              onSimulateSettlement={handleSimulateSettlement}
              tokenSymbol={MOCK_POOL.tokenSymbol}
              tokenDecimals={MOCK_POOL.tokenDecimals}
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
            <ActivityFeed entries={activityFeed} />
          </div>
        </div>
      </div>

      {/* ── Prize History Ledger ────────────────────────────────────── */}
      <PrizeHistoryLedger
        entries={prizeHistory}
        tokenDecimals={MOCK_POOL.tokenDecimals}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        unclaimedTotal={unclaimedWinningsBalance}
        onClaim={handleClaimNonReinvestedWinnings}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeDetails(entry)}
        onViewCompleteLedger={() => setShowCompleteLedger(true)}
      />

      {/* ── Recent Winners ─────────────────────────────────────────── */}
      <RecentWinnersTicker
        winners={MOCK_RECENT_WINNERS}
        tokenDecimals={MOCK_POOL.tokenDecimals}
      />

      {/* ── Modals ─────────────────────────────────────────────────── */}
      {showDeposit && (
        <DepositModal
          pool={MOCK_POOL}
          walletBalance={MOCK_WALLET_BALANCE}
          onClose={() => setShowDeposit(false)}
          onDepositSuccess={handleDepositSuccess}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          pool={MOCK_POOL}
          userTickets={userTickets}
          onClose={() => setShowWithdraw(false)}
          onWithdrawSuccess={handleWithdrawSuccess}
        />
      )}

      <PrizeDetailsModal
        key={
          selectedPrizeDetails
            ? `prize-details-${selectedPrizeDetails.drawCycleId}`
            : "prize-details-none"
        }
        entry={selectedPrizeDetails}
        isOpen={selectedPrizeDetails !== null}
        onClose={() => setSelectedPrizeDetails(null)}
        tokenDecimals={MOCK_POOL.tokenDecimals}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        onSimulateCrank={handleSimulateCrank}
      />

      <CompleteLedgerModal
        entries={prizeHistory}
        isOpen={showCompleteLedger}
        onClose={() => setShowCompleteLedger(false)}
        tokenDecimals={MOCK_POOL.tokenDecimals}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        onSimulateCrank={handleSimulateCrank}
        onViewDetails={(entry) => setSelectedPrizeDetails(entry)}
      />
    </div>
  );
}
