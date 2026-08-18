"use client";

import React, { useState, useMemo } from "react";
import {
  formatTokenAmount,
  tierLabel,
  tierBadgeClass,
} from "@/app/lib/formatters";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { CustomSelect } from "@/app/components/common/CustomSelect";
import { BonusBondDustBadge } from "@/app/components/common/BonusBondDustBadge";
import type { DrawWinnerRecord } from "@/app/types";
import { useTranslations } from "next-intl";

interface PayoutWinnersTableProps {
  winners: DrawWinnerRecord[];
  connectedUserAddress?: string;
  tokenDecimals?: number;
  tokenSymbol?: string;
  bondPrice?: number;
  onCrankWinner?: (winnerIndex: number, winnerAddress: string) => void;
  crankingWinnerIndices?: Record<number, boolean>;
}

export function PayoutWinnersTable({
  winners,
  connectedUserAddress,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  bondPrice = 5_000_000,
  onCrankWinner,
  crankingWinnerIndices = {},
}: PayoutWinnersTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const t = useTranslations("DrawInspector");
  const tLedger = useTranslations("Ledger");

  const filteredWinners = useMemo(() => {
    return winners.filter((w) => {
      // Search Matching
      const matchesSearch =
        searchTerm === "" ||
        w.winnerAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tierLabel(w.tierIndex)
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        (w.winningTicketIndex !== undefined &&
          w.winningTicketIndex.toString().includes(searchTerm));

      // Tier Matching
      const matchesTier =
        tierFilter === "all" ||
        (tierFilter === "grand" && w.tierIndex === 0) ||
        (tierFilter === "runnerup" && w.tierIndex === 1) ||
        (tierFilter === "consolation" && w.tierIndex >= 2);

      return matchesSearch && matchesTier;
    });
  }, [winners, searchTerm, tierFilter]);

  if (winners.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center p-8 text-center border border-dashed border-surface-bright/10 rounded-xl bg-[#08090E]/40">
        <p className="text-xs font-semibold text-on-surface-variant">
          {t("noWinnersRegistered")}
        </p>
        <p className="text-[10px] text-on-surface-variant/60 max-w-xs mt-1">
          {t("noWinnersSub")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Table Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder={t("searchWinnerPlaceholder")}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 pl-9 pr-4 text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none"
          />
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant/40"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>

        {/* Tier Filter Dropdown */}
        <div className="w-full sm:w-48">
          <CustomSelect
            value={tierFilter}
            onChange={(val) => setTierFilter(val)}
            options={[
              { value: "all", label: tLedger("allTiers") },
              { value: "grand", label: tLedger("grandPrize") },
              { value: "runnerup", label: tLedger("runnerUp") },
              { value: "consolation", label: tLedger("consolation") },
            ]}
            ariaLabel="Filter winners by tier"
          />
        </div>
      </div>

      {/* Winner Roster List */}
      <div className="overflow-x-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
        <table className="w-full min-w-[620px] text-left text-xs border-collapse">
          <thead>
            <tr className="border-b border-surface-bright/10 bg-surface-container/40 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
              <th className="py-3 px-4">{t("tierColumn")}</th>
              <th className="py-3 px-4">{t("winnerColumn")}</th>
              <th className="py-3 px-4 text-center">
                {t("winningBondColumn")}
              </th>
              <th className="py-3 px-4 text-right">{t("amountWonColumn")}</th>
              <th className="py-3 px-4 text-center">{t("statusColumn")}</th>
              <th className="py-3 px-4 text-right">{t("actionsColumn")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-bright/5 font-medium text-on-surface">
            {filteredWinners.map((winner) => {
              const isConnectedWinner =
                connectedUserAddress &&
                winner.winnerAddress.toLowerCase() ===
                  connectedUserAddress.toLowerCase();

              const isCranking = !!crankingWinnerIndices[winner.winnerIndex];

              return (
                <tr
                  key={`${winner.tierIndex}-${winner.winnerIndex}-${winner.winnerAddress}`}
                  className={`hover:bg-surface-container/40 transition-colors ${
                    isConnectedWinner
                      ? "bg-primary/5 border-l-2 border-primary"
                      : ""
                  }`}
                >
                  {/* Tier */}
                  <td className="py-3 px-4">
                    <span className={tierBadgeClass(winner.tierIndex)}>
                      {tierLabel(winner.tierIndex)}
                    </span>
                  </td>

                  {/* Winner Address */}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <AccountExplorerLink
                        address={winner.winnerAddress}
                        provider="solscan"
                        cluster="devnet"
                      />
                      {isConnectedWinner && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-primary/20 border border-primary/40 px-2 py-0.5 text-[9px] font-bold text-primary animate-pulse">
                          🎉 {t("youWonBadge")}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Winning Bond Index */}
                  <td className="py-3 px-4 text-center font-mono">
                    {winner.winningTicketIndex !== undefined ? (
                      <span className="inline-flex items-center gap-1 bg-surface-container/80 border border-surface-bright/10 px-2 py-0.5 rounded-md text-[11px] font-bold text-tertiary">
                        🎫 #{winner.winningTicketIndex.toLocaleString("en-US")}
                      </span>
                    ) : (
                      <span className="text-on-surface-variant/40">—</span>
                    )}
                  </td>

                  {/* Amount Won & Reinvested Bonds */}
                  <td className="py-3 px-4 text-right">
                    <p
                      className={`font-mono text-xs font-bold ${
                        winner.tierIndex === 0
                          ? "text-amber-400"
                          : "text-on-surface"
                      }`}
                    >
                      ${formatTokenAmount(winner.amountOwed, tokenDecimals)}{" "}
                      <span className="text-[10px] text-on-surface-variant/60 font-normal">
                        {tokenSymbol}
                      </span>
                    </p>
                    <BonusBondDustBadge
                      bondsBought={winner.bondsBought}
                      amountWon={winner.amountOwed}
                      bondPrice={bondPrice}
                      tokenDecimals={tokenDecimals}
                      tokenSymbol={tokenSymbol}
                      tooltipAlign="right"
                      className="mt-0.5"
                    />
                  </td>

                  {/* Status */}
                  <td className="py-3 px-4 text-center">
                    <StatusBadge
                      status={winner.processed ? "reinvested" : "processing"}
                      isCranking={isCranking}
                      size="sm"
                    />
                  </td>

                  {/* Actions / Permissionless Crank Trigger */}
                  <td className="py-3 px-4 text-right">
                    {!winner.processed && onCrankWinner ? (
                      <button
                        onClick={() =>
                          onCrankWinner(
                            winner.winnerIndex,
                            winner.winnerAddress
                          )
                        }
                        disabled={isCranking}
                        className="rounded-lg px-2.5 py-1 text-[11px] font-bold bg-amber-500 hover:bg-amber-400 text-black cursor-pointer shadow-sm transition disabled:opacity-50"
                      >
                        {isCranking ? tLedger("cranking") : tLedger("runCrank")}
                      </button>
                    ) : (
                      <span className="text-[10px] text-on-surface-variant/40">
                        {winner.processed ? "Disbursed" : "Pending"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
