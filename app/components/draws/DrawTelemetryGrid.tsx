"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import type { DetailedDrawCycle } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawTelemetryGridProps {
  draw: DetailedDrawCycle;
  tokenDecimals?: number;
  tokenSymbol?: string;
}

export function DrawTelemetryGrid({
  draw,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
}: DrawTelemetryGridProps) {
  const t = useTranslations("DrawInspector");

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {/* 1. Prize Pot */}
      <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("prizePot")}
        </p>
        <p className="text-base font-bold font-mono text-primary mt-1 truncate">
          ${formatTokenAmount(draw.prizePot, tokenDecimals)} {tokenSymbol}
        </p>
      </div>

      {/* 2. Protocol Fee */}
      <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("protocolFee")}
        </p>
        <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
          ${formatTokenAmount(draw.cycleFeeCollected, tokenDecimals)}{" "}
          {tokenSymbol}
        </p>
      </div>

      {/* 3. Locked Bonds Denominator */}
      <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("participatingBonds")}
        </p>
        <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
          {draw.lockedTicketCount.toLocaleString("en-US")} bonds
        </p>
      </div>

      {/* 4. Payout Progress */}
      <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("payoutProgress")}
        </p>
        <div className="mt-1 flex items-center gap-1.5">
          <p className="text-base font-bold font-mono text-on-surface">
            {draw.payoutsCompleted} / {draw.winnersCount}
          </p>
          {draw.winnersCount > 0 &&
            draw.payoutsCompleted === draw.winnersCount && (
              <span className="text-emerald-400 text-xs font-bold">✓</span>
            )}
        </div>
      </div>

      {/* Full Width Telemetry Details Row: Harvest Slot & Oracle Pubkey */}
      <div className="col-span-2 sm:col-span-4 p-3 rounded-xl bg-surface-container/15 border border-surface-bright/5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-semibold text-on-surface-variant">
            {t("harvestSlot")}:
          </span>
          <span className="font-mono text-on-surface font-semibold">
            {draw.harvestSlot > 0
              ? draw.harvestSlot.toLocaleString("en-US")
              : "N/A"}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase font-semibold text-on-surface-variant">
            {t("oracleAccount")}:
          </span>
          <AccountExplorerLink
            address={draw.randomnessAccount}
            provider="solscan"
            cluster="devnet"
            className="text-xs"
          />
        </div>
      </div>
    </div>
  );
}
