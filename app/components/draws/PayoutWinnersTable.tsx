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
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { TimelockTooltipContent } from "./TimelockTooltipContent";
import { usePayoutTimelock } from "@/app/hooks/usePayoutTimelock";
import type { DrawWinnerRecord } from "@/app/types";
import { useTranslations } from "next-intl";

interface PayoutWinnersTableProps {
  cycleId?: number;
  winners: DrawWinnerRecord[];
  connectedUserAddress?: string;
  tokenDecimals?: number;
  tokenSymbol?: string;
  bondPrice?: number;
  revealedAt?: number;
  payoutTimelockSeconds?: number;
  pool?: { isFrozenForDraw?: boolean } | null;
  isFrozenForDraw?: boolean;
  isVoided?: boolean;
  onCrankWinner?: (winnerIndex: number, winnerAddress: string) => void;
  crankingCycles?: Record<string, boolean>;
}

export function PayoutWinnersTable({
  cycleId,
  winners,
  connectedUserAddress,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  bondPrice = 5_000_000,
  revealedAt,
  payoutTimelockSeconds = 300,
  pool,
  isFrozenForDraw,
  isVoided = false,
  onCrankWinner,
  crankingCycles = {},
}: PayoutWinnersTableProps) {
  const [searchTerm, setSearchTerm] = useState("");
  const [tierFilter, setTierFilter] = useState("all");
  const t = useTranslations("DrawInspector");
  const tLedger = useTranslations("Ledger");

  const effectivePool =
    pool ?? (isFrozenForDraw !== undefined ? { isFrozenForDraw } : null);

  const timelockState = usePayoutTimelock(revealedAt, payoutTimelockSeconds);

  const connectedUserWinsCount = useMemo(() => {
    if (!connectedUserAddress) return 0;
    const addrLower = connectedUserAddress.toLowerCase();
    return winners.filter((w) => w.winnerAddress.toLowerCase() === addrLower)
      .length;
  }, [winners, connectedUserAddress]);

  const tierOptions = useMemo(() => {
    const opts = [
      { value: "all", label: tLedger("allTiers") },
      { value: "grand", label: tLedger("grandPrize") },
      { value: "runnerup", label: tLedger("runnerUp") },
      { value: "consolation", label: tLedger("consolation") },
    ];
    if (connectedUserWinsCount > 0) {
      opts.splice(1, 0, {
        value: "mine",
        label: t("myWinningsFilter", { count: connectedUserWinsCount }),
      });
    }
    return opts;
  }, [connectedUserWinsCount, t, tLedger]);

  const filteredWinners = useMemo(() => {
    return winners.filter((w) => {
      const isUser =
        !!connectedUserAddress &&
        w.winnerAddress.toLowerCase() === connectedUserAddress.toLowerCase();

      // Tier / My Wins Matching
      const matchesTier =
        tierFilter === "all" ||
        (tierFilter === "mine" && isUser) ||
        (tierFilter === "grand" && w.tierIndex === 0) ||
        (tierFilter === "runnerup" && w.tierIndex === 1) ||
        (tierFilter === "consolation" && w.tierIndex >= 2);

      if (!matchesTier) return false;

      // Search Matching
      const matchesSearch =
        searchTerm === "" ||
        w.winnerAddress.toLowerCase().includes(searchTerm.toLowerCase()) ||
        tierLabel(w.tierIndex)
          .toLowerCase()
          .includes(searchTerm.toLowerCase()) ||
        (w.winningTicketIndex !== undefined &&
          w.winningTicketIndex.toString().includes(searchTerm));

      return matchesSearch;
    });
  }, [winners, searchTerm, tierFilter, connectedUserAddress]);

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-3">
      {/* Admin Rollback Notice for Voided Draws */}
      {isVoided && (
        <div
          role="alert"
          aria-live="polite"
          className="rounded-xl border border-red-500/30 bg-red-500/10 p-3.5 shrink-0 flex items-start gap-3"
        >
          <span className="text-lg" aria-hidden="true">
            🛑
          </span>
          <div>
            <h5 className="text-xs font-bold text-red-400">
              {t("voidedBannerTitle")}
            </h5>
            <p className="text-[11px] text-on-surface-variant leading-relaxed mt-0.5">
              {t("voidedBannerDesc")}
            </p>
          </div>
        </div>
      )}

      {winners.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border border-dashed border-surface-bright/10 rounded-xl bg-[#08090E]/40">
          <p className="text-xs font-semibold text-on-surface-variant">
            {t("noWinnersRegistered")}
          </p>
          <p className="text-[10px] text-on-surface-variant/60 max-w-xs mt-1">
            {t("noWinnersSub")}
          </p>
        </div>
      ) : (
        <>
          {/* Table Filter Toolbar */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
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

        {/* Tier Filter Dropdown & Clear Action */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {(searchTerm || tierFilter !== "all") && (
            <button
              onClick={() => {
                setSearchTerm("");
                setTierFilter("all");
              }}
              className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 cursor-pointer shrink-0"
            >
              {t("clearFilters")}
            </button>
          )}
          <div className="w-full sm:w-56">
            <CustomSelect
              value={tierFilter}
              onChange={(val) => setTierFilter(val)}
              options={tierOptions}
              ariaLabel="Filter winners by tier"
            />
          </div>
        </div>
      </div>

      {/* Winner Roster List or Filtered Empty State */}
      {filteredWinners.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center border border-dashed border-surface-bright/10 rounded-xl bg-[#08090E]/40">
          <p className="text-xs font-semibold text-on-surface-variant">
            {t("noMatchingWinners")}
          </p>
          <p className="text-[10px] text-on-surface-variant/60 max-w-xs mt-1">
            {t("noMatchingWinnersSub")}
          </p>
          <button
            onClick={() => {
              setSearchTerm("");
              setTierFilter("all");
            }}
            className="mt-3 rounded-xl bg-primary hover:bg-primary-hover text-surface-container font-semibold text-xs px-3.5 py-1.5 transition cursor-pointer"
          >
            {t("clearFilters")}
          </button>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-xl border border-surface-bright/10 bg-surface-container/20">
          <table
            aria-label={t("payoutRegistryRosterTitle", {
              count: winners.length,
            })}
            className="w-full min-w-[650px] text-left text-xs border-separate border-spacing-0"
          >
            <thead>
              <tr className="bg-[#12141F] text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-4 whitespace-nowrap"
                >
                  {t("tierColumn")}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-4 whitespace-nowrap"
                >
                  {t("winnerColumn")}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-4 text-center whitespace-nowrap"
                >
                  {t("winningBondColumn")}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-4 text-right whitespace-nowrap"
                >
                  {t("amountWonColumn")}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-4 text-center whitespace-nowrap"
                >
                  {t("statusColumn")}
                </th>
                <th
                  scope="col"
                  className="sticky top-0 z-10 bg-[#12141F] border-b border-surface-bright/10 py-3 px-4 text-right whitespace-nowrap"
                >
                  {t("actionsColumn")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-bright/5 font-medium text-on-surface">
              {filteredWinners.map((winner) => {
                const isConnectedWinner =
                  !!connectedUserAddress &&
                  winner.winnerAddress.toLowerCase() ===
                    connectedUserAddress.toLowerCase();

                const isCranking =
                  cycleId !== undefined &&
                  !!crankingCycles[`${cycleId}-${winner.winnerIndex}`];

                return (
                  <tr
                    key={`${winner.tierIndex}-${winner.winnerIndex}-${winner.winnerAddress}`}
                    className={`transition-colors ${
                      isConnectedWinner
                        ? "bg-gradient-to-r from-primary/[0.08] via-primary/[0.03] to-transparent hover:from-primary/[0.13] hover:via-primary/[0.06]"
                        : "hover:bg-surface-container/40"
                    }`}
                  >
                    {/* Tier */}
                    <td
                      className={`py-3 px-4 border-b border-surface-bright/5 whitespace-nowrap ${
                        isConnectedWinner
                          ? "relative before:absolute before:left-0 before:top-2 before:bottom-2 before:w-1 before:rounded-r-full before:bg-primary"
                          : ""
                      }`}
                    >
                      <span className={tierBadgeClass(winner.tierIndex)}>
                        {tierLabel(winner.tierIndex)}
                      </span>
                    </td>

                    {/* Winner Address */}
                    <td className="py-3 px-4 border-b border-surface-bright/5 whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <AccountExplorerLink
                          address={winner.winnerAddress}
                          provider="solscan"
                          cluster="devnet"
                        />
                        {isConnectedWinner && (
                          <span className="inline-flex items-center gap-1 rounded-md bg-primary/15 border border-primary/30 px-1.5 py-0.5 text-[9px] font-bold text-primary">
                            <span aria-hidden="true">🎉</span> {t("youWonBadge")}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Winning Bond Index */}
                    <td className="py-3 px-4 border-b border-surface-bright/5 text-center font-mono whitespace-nowrap">
                      {winner.winningTicketIndex !== undefined ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold ${
                            isConnectedWinner
                              ? "bg-primary/15 border border-primary/40 text-primary shadow-xs"
                              : "bg-surface-container/80 border border-surface-bright/10 text-tertiary"
                          }`}
                        >
                          <span aria-hidden="true">🎫</span> #
                          {winner.winningTicketIndex.toLocaleString("en-US")}
                        </span>
                      ) : (
                        <span className="text-on-surface-variant/40">—</span>
                      )}
                    </td>

                    {/* Amount Won & Reinvested Bonds */}
                    <td className="py-3 px-4 border-b border-surface-bright/5 text-right whitespace-nowrap">
                      <p
                        className={`font-mono text-xs font-bold ${
                          isVoided
                            ? "opacity-60 text-on-surface-variant"
                            : winner.tierIndex === 0
                              ? "text-amber-400"
                              : isConnectedWinner
                                ? "text-primary"
                                : "text-on-surface"
                        }`}
                      >
                        <span className={isVoided ? "line-through" : ""}>
                          {formatTokenAmount(winner.amountOwed, tokenDecimals)}
                        </span>{" "}
                        <span className="text-[10px] text-on-surface-variant/60 font-normal">
                          {tokenSymbol}
                        </span>
                      </p>
                      {!isVoided && (
                        <BonusBondDustBadge
                          bondsBought={winner.bondsBought}
                          amountWon={winner.amountOwed}
                          bondPrice={bondPrice}
                          tokenDecimals={tokenDecimals}
                          tokenSymbol={tokenSymbol}
                          tooltipAlign="right"
                          className="mt-0.5"
                        />
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3 px-4 border-b border-surface-bright/5 text-center whitespace-nowrap">
                      {isVoided ? (
                        <span className="font-mono text-[10px] font-semibold text-red-400/80 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20">
                          {t("voidedPrizesNotice")}
                        </span>
                      ) : !winner.processed && timelockState.isTimelocked ? (
                        <InteractiveTooltip
                          ariaLabel={tLedger("timelocked")}
                          align="center"
                          side="top"
                          triggerClassName="inline-flex p-0"
                          panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                          content={
                            <TimelockTooltipContent timelock={timelockState} />
                          }
                        >
                          <StatusBadge
                            status="timelocked"
                            isCranking={isCranking}
                            size="sm"
                            className="cursor-help"
                          />
                        </InteractiveTooltip>
                      ) : (
                        <StatusBadge
                          status={
                            winner.processed ? "reinvested" : "processing"
                          }
                          isCranking={isCranking}
                          size="sm"
                        />
                      )}
                    </td>

                    {/* Actions / Permissionless Crank Trigger */}
                    <td className="py-3 px-4 border-b border-surface-bright/5 text-right whitespace-nowrap">
                      {isVoided ? (
                        <span
                          className="text-[10px] text-red-400/70 font-mono"
                          title={t("voidedCrankTooltip")}
                        >
                          —
                        </span>
                      ) : winner.processed ? (
                        <span className="text-[10px] text-on-surface-variant/40">
                          {tLedger("disbursed")}
                        </span>
                      ) : timelockState.isTimelocked ? (
                        <InteractiveTooltip
                          ariaLabel={`Crank locked: ${tLedger("timelockTooltip", { remaining: timelockState.formattedRemaining })}`}
                          align="right"
                          side="bottom"
                          triggerClassName="inline-flex p-0"
                          panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                          content={
                            <TimelockTooltipContent timelock={timelockState} />
                          }
                        >
                          <span
                            aria-disabled="true"
                            className="rounded-lg px-2.5 py-1 text-[11px] font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/80 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1 shrink-0"
                          >
                            <span aria-hidden="true">🔒</span> {timelockState.formattedRemaining}
                          </span>
                        </InteractiveTooltip>
                      ) : effectivePool?.isFrozenForDraw ? (
                        <InteractiveTooltip
                          ariaLabel={tLedger("frozenCrankTooltip")}
                          align="right"
                          side="top"
                          triggerClassName="inline-flex"
                          panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                          content={
                            <p className="text-xs leading-relaxed text-amber-200">
                              {tLedger("frozenCrankTooltip")}
                            </p>
                          }
                        >
                          <span
                            aria-disabled="true"
                            className="rounded-lg px-2.5 py-1 text-[11px] font-bold bg-surface-container/60 border border-amber-500/20 text-amber-300/60 cursor-not-allowed opacity-80 shadow-xs inline-flex items-center gap-1"
                          >
                            <span aria-hidden="true">❄️</span> {tLedger("claimingPaused")}
                          </span>
                        </InteractiveTooltip>
                      ) : onCrankWinner ? (
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
                          {isCranking
                            ? tLedger("cranking")
                            : tLedger("runCrank")}
                        </button>
                      ) : (
                        <span className="text-[10px] text-on-surface-variant/40">
                          {tLedger("pending")}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
        </>
      )}
    </div>
  );
}
