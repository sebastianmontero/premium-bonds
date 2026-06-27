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
} from "@/app/mock-data";
import type {
  ActivityEntry,
  PendingRedemption,
  PrizeHistoryEntry,
} from "@/app/types";

export default function DashboardPage() {
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Stateful tracking for user holdings and activity
  const [userTickets, setUserTickets] = useState(MOCK_USER_TICKETS);
  const [pendingRedemptions, setPendingRedemptions] = useState<
    PendingRedemption[]
  >(INITIAL_PENDING_REDEMPTIONS);
  const [prizeHistory, setPrizeHistory] =
    useState<PrizeHistoryEntry[]>(MOCK_PRIZE_HISTORY);
  const [activityFeed, setActivityFeed] =
    useState<ActivityEntry[]>(MOCK_ACTIVITY_FEED);

  // Sum unclaimed amount from the prize history ledger
  const unclaimedAmount = prizeHistory
    .filter((w) => w.status === "unclaimed")
    .reduce((sum, w) => sum + w.amount, 0);

  // Net Worth includes active ticket value plus all pending redemptions (Huma async claims)
  const pendingRedemptionsTotal = pendingRedemptions.reduce(
    (sum, r) => sum + r.amount,
    0
  );
  const netWorth =
    userTickets.activeTicketsCount * MOCK_POOL.bondPrice +
    pendingRedemptionsTotal;

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

  // Handlers for Prize Claiming (Asynchronous Huma Flow)
  const handleClaimSinglePrize = (drawCycleId: number) => {
    const prize = prizeHistory.find((p) => p.drawCycleId === drawCycleId);
    if (!prize) return;

    // Transition row to claiming state in ledger
    setPrizeHistory((prev) =>
      prev.map((p) =>
        p.drawCycleId === drawCycleId ? { ...p, status: "claiming" } : p
      )
    );

    // Simulate Anchor instruction execution & CPI to Huma
    setTimeout(() => {
      setPrizeHistory((prev) =>
        prev.map((p) =>
          p.drawCycleId === drawCycleId ? { ...p, status: "claimed" } : p
        )
      );

      const newRedemption: PendingRedemption = {
        redemptionId: `red-p-${drawCycleId}-${Date.now()}`,
        amount: prize.amount,
        status: "settling",
        requestedAt: new Date().toISOString(),
        type: "prize_claim",
      };
      setPendingRedemptions((prev) => [newRedemption, ...prev]);

      const newActivity: ActivityEntry = {
        id: `act-claim-${drawCycleId}-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
        type: "win",
        description: `Claimed Draw #${drawCycleId} prize of $${prize.amount / 1_000_000} USDC · Pending Huma settle`,
        amount: prize.amount,
      };
      setActivityFeed((prev) => [newActivity, ...prev]);
    }, 1000);
  };

  const handleClaimAllPrizes = () => {
    const unclaimedPrizes = prizeHistory.filter(
      (p) => p.status === "unclaimed"
    );
    if (unclaimedPrizes.length === 0) return;

    setPrizeHistory((prev) =>
      prev.map((p) =>
        p.status === "unclaimed" ? { ...p, status: "claiming" } : p
      )
    );

    setTimeout(() => {
      setPrizeHistory((prev) =>
        prev.map((p) =>
          p.status === "claiming" ? { ...p, status: "claimed" } : p
        )
      );

      const newRedemptions: PendingRedemption[] = unclaimedPrizes.map(
        (prize, idx) => ({
          redemptionId: `red-p-all-${prize.drawCycleId}-${idx}-${Date.now()}`,
          amount: prize.amount,
          status: "settling",
          requestedAt: new Date().toISOString(),
          type: "prize_claim",
        })
      );
      setPendingRedemptions((prev) => [...newRedemptions, ...prev]);

      const totalClaimed = unclaimedPrizes.reduce(
        (sum, p) => sum + p.amount,
        0
      );
      const newActivity: ActivityEntry = {
        id: `act-claim-all-${Date.now()}`,
        date: new Date().toISOString().split("T")[0],
        type: "win",
        description: `Claimed ${unclaimedPrizes.length} prizes totaling $${totalClaimed / 1_000_000} USDC · Pending Huma settle`,
        amount: totalClaimed,
      };
      setActivityFeed((prev) => [newActivity, ...prev]);
    }, 1000);
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
      {unclaimedAmount > 0 && (
        <UnclaimedBanner
          totalUnclaimed={unclaimedAmount}
          tokenSymbol={MOCK_POOL.tokenSymbol}
          tokenDecimals={MOCK_POOL.tokenDecimals}
          onClaim={handleClaimAllPrizes}
        />
      )}

      {/* ── Holdings Summary (Hero Row) ────────────────────────────── */}
      <PortfolioHeroRow
        netWorth={netWorth}
        activeTickets={userTickets.activeTicketsCount}
        pendingTickets={userTickets.pendingTicketsCount}
        lifetimeWinnings={MOCK_LIFETIME_WINNINGS}
        autoReinvestedTotal={MOCK_AUTO_REINVESTED_TOTAL}
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
        unclaimedTotal={unclaimedAmount}
        onClaim={handleClaimAllPrizes}
        onClaimSinglePrize={handleClaimSinglePrize}
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
    </div>
  );
}
