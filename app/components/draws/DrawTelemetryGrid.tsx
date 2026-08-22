"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import { usePayoutTimelock } from "@/app/hooks/usePayoutTimelock";
import type { DetailedDrawCycle } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawTelemetryGridProps {
  draw: DetailedDrawCycle;
  tokenDecimals?: number;
  tokenSymbol?: string;
  payoutTimelockSeconds?: number;
}

export function DrawTelemetryGrid({
  draw,
  tokenDecimals = 6,
  tokenSymbol = "USDC",
  payoutTimelockSeconds = 300,
}: DrawTelemetryGridProps) {
  const t = useTranslations("DrawInspector");

  const timelockState = usePayoutTimelock(
    draw.revealedAt,
    payoutTimelockSeconds
  );

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {/* 1. Prize Pot */}
      <div className="p-2.5 sm:p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("prizePot")}
        </p>
        <p className="text-base font-bold font-mono text-primary mt-1 truncate">
          {formatTokenAmount(draw.prizePot, tokenDecimals)} {tokenSymbol}
        </p>
      </div>

      {/* 2. Protocol Fee */}
      <div className="p-2.5 sm:p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("protocolFee")}
        </p>
        <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
          {formatTokenAmount(draw.cycleFeeCollected, tokenDecimals)}{" "}
          {tokenSymbol}
        </p>
      </div>

      {/* 3. Locked Bonds Denominator */}
      <div className="p-2.5 sm:p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
        <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
          {t("participatingBonds")}
        </p>
        <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
          {draw.lockedTicketCount.toLocaleString("en-US")} bonds
        </p>
      </div>

      {/* 4. Payout Progress */}
      <div className="p-2.5 sm:p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
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

      {/* 5. Settlement Timelock */}
      <div
        className={`col-span-2 sm:col-span-1 p-2.5 sm:p-3.5 rounded-xl border flex flex-col justify-between transition-colors ${
          timelockState.isTimelocked
            ? "bg-amber-500/10 border-amber-500/30"
            : "bg-surface-container/20 border-surface-bright/5"
        }`}
        title={
          timelockState.isTimelocked
            ? `${t("settlementTimelock")}: ${t("timelockActive", { remaining: timelockState.formattedRemaining })} (Unlocks at ${timelockState.formattedUnlockTime})`
            : undefined
        }
      >
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("settlementTimelock")}
          </p>
          {timelockState.isTimelocked && (
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse shrink-0" />
          )}
        </div>
        <div className="mt-1">
          {draw.status !== "Complete" || !draw.revealedAt ? (
            <p className="text-xs text-on-surface-variant/40 font-mono">—</p>
          ) : timelockState.isTimelocked ? (
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-mono font-bold text-amber-300">
                🔒 {timelockState.formattedRemaining}
              </span>
              <span className="text-[10px] text-amber-400/80 font-medium">
                ({timelockState.progressPercent}%)
              </span>
            </div>
          ) : (
            <p className="text-xs font-semibold text-emerald-400 flex items-center gap-1">
              <span>✓</span> {t("timelockUnlocked")}
            </p>
          )}
        </div>
      </div>

      {/* Full Width Telemetry Details Row: Harvest Slot & Oracle Pubkey */}
      <div className="col-span-2 sm:col-span-3 lg:col-span-5 p-3 rounded-xl bg-surface-container/15 border border-surface-bright/5 flex flex-wrap items-center justify-between gap-3 text-xs">
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
