"use client";

import React, { useState, useMemo } from "react";
import type { PrizeHistoryEntry } from "@/app/types";
import { formatTokenAmount, tierLabel, tierBadgeClass } from "@/app/mock-data";

interface CompleteLedgerModalProps {
  entries: PrizeHistoryEntry[];
  isOpen: boolean;
  onClose: () => void;
  tokenDecimals: number;
  tokenSymbol: string;
  onSimulateCrank: (drawCycleId: number) => void;
  onViewDetails: (entry: PrizeHistoryEntry) => void;
}

function statusPill(status: PrizeHistoryEntry["status"]) {
  switch (status) {
    case "processing":
      return (
        <span className="pill pill-warning">
          <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulse" />
          Processing
        </span>
      );
    case "partial":
      return (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
          Reinvesting
        </span>
      );
    case "reinvested":
      return (
        <span className="pill pill-success">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Reinvested
        </span>
      );
  }
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function CompleteLedgerModal({
  entries,
  isOpen,
  onClose,
  tokenDecimals,
  tokenSymbol,
  onSimulateCrank,
  onViewDetails,
}: CompleteLedgerModalProps) {
  // Stateful Filtering
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [tierFilter, setTierFilter] = useState("all");

  const resetFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setTierFilter("all");
  };

  const filteredEntries = useMemo(() => {
    return entries.filter((entry) => {
      // Search check
      const matchesSearch =
        searchTerm === "" ||
        entry.drawCycleId.toString().includes(searchTerm) ||
        entry.winningTicket?.includes(searchTerm);

      // Status check
      const matchesStatus =
        statusFilter === "all" || entry.status === statusFilter;

      // Tier check
      const matchesTier =
        tierFilter === "all" ||
        (tierFilter === "grand" && entry.tierIndex === 0) ||
        (tierFilter === "runnerup" && entry.tierIndex === 1) ||
        (tierFilter === "consolation" && entry.tierIndex === 2);

      return matchesSearch && matchesStatus && matchesTier;
    });
  }, [entries, searchTerm, statusFilter, tierFilter]);

  // Aggregate Stats on Filtered Set
  const { totalCount, totalValue } = useMemo(() => {
    let count = 0;
    let value = 0;
    filteredEntries.forEach((entry) => {
      count += 1;
      value += entry.amount;
    });
    return { totalCount: count, totalValue: value };
  }, [filteredEntries]);

  // CSV Export Handler
  const handleExportCSV = () => {
    const headers = [
      "Draw Cycle ID",
      "Date",
      "Tier Index",
      "Tier Label",
      "Amount Won (USDC)",
      "Status",
      "Winning Ticket",
      "VRF Seed",
      "Transaction Signature",
    ];

    const rows = filteredEntries.map((entry) => [
      entry.drawCycleId,
      entry.date,
      entry.tierIndex,
      tierLabel(entry.tierIndex),
      formatTokenAmount(entry.amount, tokenDecimals),
      entry.status,
      entry.winningTicket || "",
      entry.vrfSeed || "",
      entry.txSignature || "",
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [
        headers.join(","),
        ...rows.map((row) => row.map((val) => `"${val}"`).join(",")),
      ].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute(
      "download",
      `premium_bonds_prizes_export_${Date.now()}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/75 backdrop-blur-md transition-opacity duration-300"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="relative w-full max-w-5xl rounded-2xl border border-surface-bright/10 bg-[#0F111A]/95 p-6 shadow-ambient z-10 overflow-hidden flex flex-col h-[85vh] glass-strong">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-surface-bright/5 shrink-0">
          <div>
            <h3 className="text-xl font-bold font-display text-on-surface">
              Complete Draw Ledger
            </h3>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Historical ledger containing audit records for all draws since
              inception.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/5 transition cursor-pointer"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Filter bar */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 py-4 border-b border-surface-bright/5 shrink-0">
          {/* Search */}
          <div className="relative">
            <input
              type="text"
              placeholder="Search Draw # or Ticket..."
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

          {/* Status Dropdown */}
          <div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 px-3 text-xs text-on-surface focus:border-primary focus:outline-none cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="processing">Processing</option>
              <option value="partial">Reinvesting</option>
              <option value="reinvested">Reinvested</option>
            </select>
          </div>

          {/* Tier Dropdown */}
          <div>
            <select
              value={tierFilter}
              onChange={(e) => setTierFilter(e.target.value)}
              className="w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 px-3 text-xs text-on-surface focus:border-primary focus:outline-none cursor-pointer"
            >
              <option value="all">All Tiers</option>
              <option value="grand">Grand Prize</option>
              <option value="runnerup">Runner-up</option>
              <option value="consolation">Consolation</option>
            </select>
          </div>

          {/* Action Row */}
          <div className="flex gap-2 justify-end items-center">
            {(searchTerm || statusFilter !== "all" || tierFilter !== "all") && (
              <button
                onClick={resetFilters}
                className="text-xs text-on-surface-variant hover:text-primary transition font-semibold px-2 cursor-pointer"
              >
                Clear
              </button>
            )}
            <button
              onClick={handleExportCSV}
              disabled={filteredEntries.length === 0}
              className="flex items-center gap-1.5 rounded-xl border border-surface-bright/15 hover:bg-surface-bright/5 disabled:opacity-40 disabled:cursor-not-allowed text-on-surface font-semibold text-xs px-3.5 py-2 transition cursor-pointer"
            >
              <svg
                className="w-4 h-4 text-primary"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"
                />
              </svg>
              Export CSV
            </button>
          </div>
        </div>

        {/* Aggregate Stats Summary */}
        <div className="flex flex-wrap items-center justify-between gap-4 py-3 px-4 bg-surface-container/10 border-b border-surface-bright/5 text-xs text-on-surface-variant shrink-0">
          <div className="flex items-center gap-6">
            <div>
              Matching Entries:{" "}
              <span className="font-mono text-on-surface font-bold">
                {totalCount}
              </span>
            </div>
            <div>
              Total Filtered Value:{" "}
              <span className="font-mono text-primary font-bold">
                {formatTokenAmount(totalValue, tokenDecimals)} {tokenSymbol}
              </span>
            </div>
          </div>
          <div className="text-[10px] text-on-surface-variant/60 font-semibold uppercase tracking-wider">
            Draw History Audit
          </div>
        </div>

        {/* Scrollable list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-3 min-h-0">
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center border border-dashed border-surface-bright/10 rounded-2xl bg-[#08090E]/40 mt-4">
              <svg
                className="w-10 h-10 text-on-surface-variant/20 mb-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <h4 className="text-sm font-semibold text-on-surface">
                No Prize Draws Found
              </h4>
              <p className="text-xs text-on-surface-variant max-w-xs mt-1 leading-relaxed">
                No historical prize records matched your current search criteria
                or filter options.
              </p>
              <button
                onClick={resetFilters}
                className="mt-4 rounded-xl bg-primary hover:bg-primary-hover text-surface-container font-semibold text-xs px-4 py-2 transition cursor-pointer"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            filteredEntries.map((entry) => (
              <div
                key={entry.drawCycleId}
                className="flex flex-col md:grid md:grid-cols-[100px_130px_130px_150px_130px_1fr] items-stretch md:items-center gap-4 p-4 rounded-xl bg-surface-container/20 border border-surface-bright/5 hover:border-surface-bright/10 transition-all duration-300"
              >
                {/* Draw Cycle */}
                <div className="flex items-center gap-2">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary font-mono text-xs font-bold">
                    #{entry.drawCycleId}
                  </div>
                  <span className="text-xs font-semibold text-on-surface md:hidden">
                    Cycle #{entry.drawCycleId}
                  </span>
                </div>

                {/* Date */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                    Date
                  </p>
                  <p className="text-xs text-on-surface font-medium mt-0.5">
                    {formatDate(entry.date)}
                  </p>
                </div>

                {/* Tier */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                    Tier
                  </p>
                  <div className="mt-0.5">
                    <span className={tierBadgeClass(entry.tierIndex)}>
                      {tierLabel(entry.tierIndex)}
                    </span>
                  </div>
                </div>

                {/* Amount */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                    Amount
                  </p>
                  <p className="font-mono text-xs font-semibold text-on-surface mt-0.5">
                    {formatTokenAmount(entry.amount, tokenDecimals)}{" "}
                    {tokenSymbol}
                  </p>
                </div>

                {/* Status */}
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold md:hidden">
                    Status
                  </p>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                    {statusPill(entry.status)}
                    {entry.reinvestedTickets !== undefined &&
                      entry.reinvestedTickets > 0 && (
                        <span className="text-[10px] text-tertiary font-medium">
                          (+{entry.reinvestedTickets})
                        </span>
                      )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center justify-start md:justify-end gap-3 md:border-l md:border-surface-bright/5 md:pl-6 w-full font-sans">
                  {(entry.status === "processing" ||
                    entry.status === "partial") && (
                    <button
                      onClick={() => onSimulateCrank(entry.drawCycleId)}
                      className="rounded-lg bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-black px-2.5 py-1.5 text-[11px] font-bold transition cursor-pointer shadow-[0_2px_8px_rgba(245,158,11,0.25)] flex items-center gap-1 shrink-0"
                    >
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="animate-spin duration-3000"
                      >
                        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.57-8.38l5.67-5.67" />
                      </svg>
                      Crank
                    </button>
                  )}
                  <button
                    onClick={() => onViewDetails(entry)}
                    className="text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer px-2 py-1.5"
                  >
                    Details
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between pt-4 border-t border-surface-bright/5 shrink-0 mt-auto">
          <p className="text-[10px] text-on-surface-variant/40 uppercase tracking-wider font-semibold">
            Premium Bonds Cryptographic Ledgers v1.0
          </p>
          <button
            onClick={onClose}
            className="rounded-xl border border-surface-bright/10 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-5 py-2.5 transition cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
