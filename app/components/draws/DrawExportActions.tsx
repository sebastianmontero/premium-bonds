"use client";

import React from "react";
import { exportToCsv, exportToJson } from "@/app/lib/export-utils";
import { tierLabel } from "@/app/lib/formatters";
import { hasDrawVrfRandomness } from "@/app/lib/draw-helpers";
import type { DetailedDrawCycle } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawExportActionsProps {
  draw: DetailedDrawCycle;
  hasVrfRandomness?: boolean;
  className?: string;
}

export function DrawExportActions({
  draw,
  hasVrfRandomness,
  className = "",
}: DrawExportActionsProps) {
  const t = useTranslations("DrawInspector");
  const isVrf = hasVrfRandomness ?? hasDrawVrfRandomness(draw);

  const handleExportCSV = () => {
    const headers = [
      "Draw Cycle ID",
      "Tier Index",
      "Tier Name",
      "Winner Slot in Tier",
      "Winner Address",
      "Amount Won (Base Units)",
      "Bonds Bought",
      "Payout Processed",
      "Winning Bond Index",
      "VRF Randomness Seed",
      "Harvest Slot",
      "Randomness Oracle Account",
    ];

    const rows = draw.winners.map((w) => [
      draw.cycleId,
      w.tierIndex,
      tierLabel(w.tierIndex),
      w.slotInTier,
      w.winnerAddress,
      w.amountOwed,
      w.bondsBought,
      w.processed ? "true" : "false",
      w.winningTicketIndex !== undefined ? `#${w.winningTicketIndex}` : "",
      isVrf ? draw.vrfSeedHex : t("notApplicableSeed"),
      draw.harvestSlot,
      draw.randomnessAccount,
    ]);

    exportToCsv(
      `yieldbonds_draw_${draw.cycleId}_payout_registry`,
      headers,
      rows
    );
  };

  const handleExportJSON = () => {
    exportToJson(`yieldbonds_draw_${draw.cycleId}_payout_registry`, {
      poolId: draw.poolId,
      cycleId: draw.cycleId,
      status: draw.status,
      prizePot: draw.prizePot,
      cycleFeeCollected: draw.cycleFeeCollected,
      lockedTicketCount: draw.lockedTicketCount,
      harvestSlot: draw.harvestSlot,
      randomnessAccount: draw.randomnessAccount,
      vrfSeedHex: isVrf ? draw.vrfSeedHex : null,
      hasVrfRandomness: isVrf,
      revealedAt: draw.revealedAt,
      initiatedAt: draw.initiatedAt,
      completedAt: draw.completedAt,
      winnersCount: draw.winnersCount,
      payoutsCompleted: draw.payoutsCompleted,
      winners: draw.winners,
    });
  };

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {/* CSV Export */}
      <button
        onClick={handleExportCSV}
        disabled={draw.winners.length === 0}
        aria-label="Export Draw CSV"
        className="flex items-center gap-1.5 rounded-xl border border-surface-bright/15 hover:bg-surface-bright/5 disabled:opacity-40 disabled:cursor-not-allowed text-on-surface font-semibold text-xs px-3 py-2 transition cursor-pointer"
      >
        <svg
          className="w-3.5 h-3.5 text-primary"
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
        <span>{t("exportCSV")}</span>
      </button>

      {/* JSON Export */}
      <button
        onClick={handleExportJSON}
        aria-label="Export Draw JSON"
        className="flex items-center gap-1.5 rounded-xl border border-surface-bright/15 hover:bg-surface-bright/5 text-on-surface font-semibold text-xs px-3 py-2 transition cursor-pointer"
      >
        <svg
          className="w-3.5 h-3.5 text-tertiary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"
          />
        </svg>
        <span>{t("exportJSON")}</span>
      </button>
    </div>
  );
}
