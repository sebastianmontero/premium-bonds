"use client";

import { useState } from "react";
import { UnclaimedBanner } from "@/app/components/dashboard/UnclaimedBanner";
import { PortfolioHeroRow } from "@/app/components/portfolio/PortfolioHeroRow";
import { PoolCard } from "@/app/components/dashboard/PoolCard";
import { ActivityFeed } from "@/app/components/portfolio/ActivityFeed";
import { PrizeHistoryLedger } from "@/app/components/portfolio/PrizeHistoryLedger";
import { RecentWinnersTicker } from "@/app/components/dashboard/RecentWinnersTicker";
import { DepositModal } from "@/app/components/dashboard/DepositModal";
import { WithdrawModal } from "@/app/components/dashboard/WithdrawModal";
import {
  MOCK_POOL,
  MOCK_USER_TICKETS,
  MOCK_USER_PREFERENCE,
  MOCK_WALLET_BALANCE,
  MOCK_RECENT_WINNERS,
  MOCK_LIFETIME_WINNINGS,
  MOCK_AUTO_REINVESTED_TOTAL,
  MOCK_PRIZE_HISTORY,
  MOCK_ACTIVITY_FEED,
  MOCK_PAYOUT,
} from "@/app/mock-data";

export default function DashboardPage() {
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Derive unclaimed amount from mock payout
  const unclaimedAmount = MOCK_PAYOUT.winners
    .filter((w) => !w.paidOut)
    .reduce((sum, w) => sum + (w.amountOwed - w.amountReinvested), 0);

  const showBanner = !MOCK_USER_PREFERENCE.autoReinvest && unclaimedAmount > 0;

  const netWorth =
    MOCK_USER_TICKETS.activeTicketsCount * MOCK_POOL.bondPrice;

  // Sum unclaimed from prize history for the ledger CTA
  const unclaimedLedgerTotal = MOCK_PRIZE_HISTORY
    .filter((e) => e.status === "unclaimed")
    .reduce((sum, e) => sum + e.amount, 0);

  return (
    <div className="space-y-6">
      {/* ── Unclaimed Winnings Banner ──────────────────────────────── */}
      {showBanner && (
        <UnclaimedBanner
          totalUnclaimed={unclaimedAmount}
          tokenSymbol={MOCK_POOL.tokenSymbol}
          tokenDecimals={MOCK_POOL.tokenDecimals}
          onClaim={() => console.log("Claim prize!")}
        />
      )}

      {/* ── Holdings Summary (Hero Row) ────────────────────────────── */}
      <PortfolioHeroRow
        netWorth={netWorth}
        activeTickets={MOCK_USER_TICKETS.activeTicketsCount}
        pendingTickets={MOCK_USER_TICKETS.pendingTicketsCount}
        lifetimeWinnings={MOCK_LIFETIME_WINNINGS}
        autoReinvestedTotal={MOCK_AUTO_REINVESTED_TOTAL}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        tokenDecimals={MOCK_POOL.tokenDecimals}
      />

      {/* ── Bond Holdings + Activity Feed (two-column) ─────────────── */}
      <div className="grid gap-6 lg:grid-cols-5">
        {/* Pool Card — takes 3 of 5 columns */}
        <div className="lg:col-span-3 flex flex-col">
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
          <div className="flex-1 min-h-0">
            <PoolCard
              pool={MOCK_POOL}
              userTickets={MOCK_USER_TICKETS}
              onDeposit={() => setShowDeposit(true)}
              onWithdraw={() => setShowWithdraw(true)}
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
            <ActivityFeed entries={MOCK_ACTIVITY_FEED} />
          </div>
        </div>
      </div>

      {/* ── Prize History Ledger ────────────────────────────────────── */}
      <PrizeHistoryLedger
        entries={MOCK_PRIZE_HISTORY}
        tokenDecimals={MOCK_POOL.tokenDecimals}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        unclaimedTotal={unclaimedLedgerTotal}
        onClaim={() => console.log("Claim prize!")}
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
          autoReinvestDefault={MOCK_USER_PREFERENCE.autoReinvest}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          pool={MOCK_POOL}
          userTickets={MOCK_USER_TICKETS}
          onClose={() => setShowWithdraw(false)}
        />
      )}
    </div>
  );
}
