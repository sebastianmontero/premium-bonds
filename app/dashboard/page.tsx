"use client";

import { useState } from "react";
import { UnclaimedBanner } from "@/app/components/dashboard/UnclaimedBanner";
import { PortfolioSummary } from "@/app/components/dashboard/PortfolioSummary";
import { PoolCard } from "@/app/components/dashboard/PoolCard";
import { RecentWinnersTicker } from "@/app/components/dashboard/RecentWinnersTicker";
import { DepositModal } from "@/app/components/dashboard/DepositModal";
import { WithdrawModal } from "@/app/components/dashboard/WithdrawModal";
import {
  MOCK_POOL,
  MOCK_USER_TICKETS,
  MOCK_USER_PREFERENCE,
  MOCK_PAYOUT,
  MOCK_WALLET_BALANCE,
  MOCK_RECENT_WINNERS,
} from "@/app/mock-data";

export default function DashboardPage() {
  const [showDeposit, setShowDeposit] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);

  // Derive unclaimed amount from mock payout
  const unclaimedAmount = MOCK_PAYOUT.winners
    .filter((w) => !w.paidOut)
    .reduce((sum, w) => sum + (w.amountOwed - w.amountReinvested), 0);

  const showBanner = !MOCK_USER_PREFERENCE.autoReinvest && unclaimedAmount > 0;

  const totalDeposited = MOCK_USER_TICKETS.activeTicketsCount * MOCK_POOL.bondPrice;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* ── Unclaimed Winnings Banner ──────────────────────────────── */}
      {showBanner && (
        <UnclaimedBanner
          totalUnclaimed={unclaimedAmount}
          tokenSymbol={MOCK_POOL.tokenSymbol}
          tokenDecimals={MOCK_POOL.tokenDecimals}
          onClaim={() => console.log("Claim prize!")}
        />
      )}

      {/* ── Portfolio Summary ─────────────────────────────────────── */}
      <PortfolioSummary
        totalDeposited={totalDeposited}
        walletBalance={MOCK_WALLET_BALANCE}
        autoReinvest={MOCK_USER_PREFERENCE.autoReinvest}
        tokenSymbol={MOCK_POOL.tokenSymbol}
        tokenDecimals={MOCK_POOL.tokenDecimals}
        activeTickets={MOCK_USER_TICKETS.activeTicketsCount}
      />

      {/* ── Prize Pool Card ───────────────────────────────────────── */}
      <div>
        <div className="flex items-center gap-2 mb-4 px-1">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
            <circle cx="12" cy="8" r="7" />
            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
          </svg>
          <h2 className="font-display text-lg font-bold text-on-surface">
            Active Pool
          </h2>
        </div>
        <PoolCard
          pool={MOCK_POOL}
          userTickets={MOCK_USER_TICKETS}
          onDeposit={() => setShowDeposit(true)}
          onWithdraw={() => setShowWithdraw(true)}
        />
      </div>

      {/* ── Recent Winners ────────────────────────────────────────── */}
      <RecentWinnersTicker
        winners={MOCK_RECENT_WINNERS}
        tokenDecimals={MOCK_POOL.tokenDecimals}
      />

      {/* ── Modals ────────────────────────────────────────────────── */}
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
