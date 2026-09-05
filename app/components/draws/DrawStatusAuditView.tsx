"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import type { DetailedDrawCycle, DrawDisplayConfig } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawStatusAuditViewProps {
  draw: DetailedDrawCycle;
  config?: DrawDisplayConfig;
}

export function DrawStatusAuditView({
  draw,
  config,
}: DrawStatusAuditViewProps) {
  const t = useTranslations("DrawInspector");
  const tokenDecimals = config?.tokenDecimals ?? 6;
  const tokenSymbol = config?.tokenSymbol ?? "USDC";

  const isHaltedInsolvent = draw.status === "HaltedInsolvent";
  const isHaltedYieldSpike = draw.status === "HaltedYieldSpike";
  const isForceUnlocked = draw.status === "ForceUnlocked";
  const isAwaitingYield = draw.status === "AwaitingYield";
  const isAwaitingRandomness = draw.status === "AwaitingRandomness";

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-y-auto pr-1">
      {/* ── 1. Status Specific Hero Diagnostic / Progress Card ──────── */}
      {isForceUnlocked && (
        <div className="rounded-2xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 via-surface-container/60 to-surface-container/30 p-5 sm:p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xl shadow-inner"
              aria-hidden="true"
            >
              ⚠️
            </div>
            <div className="space-y-2">
              <h4 className="text-base sm:text-lg font-bold font-display text-amber-300">
                {t("forceUnlockedTitle")}
              </h4>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                {t("forceUnlockedDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {(isHaltedInsolvent || isHaltedYieldSpike) && (
        <div className="rounded-2xl border border-red-500/30 bg-gradient-to-br from-red-500/10 via-surface-container/60 to-surface-container/30 p-5 sm:p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 text-xl shadow-inner"
              aria-hidden="true"
            >
              🛑
            </div>
            <div className="space-y-2">
              <h4 className="text-base sm:text-lg font-bold font-display text-red-400">
                {isHaltedInsolvent
                  ? t("haltedInsolventTitle")
                  : t("haltedYieldSpikeTitle")}
              </h4>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                {isHaltedInsolvent
                  ? t("haltedInsolventDesc")
                  : t("haltedYieldSpikeDesc")}
              </p>
            </div>
          </div>
        </div>
      )}

      {(isAwaitingYield || isAwaitingRandomness) && (
        <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface-container/60 to-surface-container/30 p-5 sm:p-6 shadow-sm">
          <div className="flex items-start gap-4">
            <div
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-primary border border-primary/30 text-xl shadow-inner"
              aria-hidden="true"
            >
              <span className="animate-spin text-lg">⏳</span>
            </div>
            <div className="space-y-2">
              <h4 className="text-base sm:text-lg font-bold font-display text-on-surface flex items-center gap-2">
                <span>{t("inFlightTitle")}</span>
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-300 animate-pulse">
                  {draw.status}
                </span>
              </h4>
              <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
                {isAwaitingYield
                  ? t("inFlightDescAwaitingYield")
                  : t("inFlightDescAwaitingRandomness")}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 2. On-Chain Telemetry Grid ───────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("prizePot")}
          </p>
          <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
            {formatTokenAmount(draw.prizePot, tokenDecimals)} {tokenSymbol}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("participatingBonds")}
          </p>
          <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
            {draw.lockedTicketCount.toLocaleString("en-US")}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("harvestSlot")}
          </p>
          <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
            {Number(draw.harvestSlot).toLocaleString("en-US")}
          </p>
        </div>

        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("protocolFee")}
          </p>
          <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
            {formatTokenAmount(draw.cycleFeeCollected, tokenDecimals)}{" "}
            {tokenSymbol}
          </p>
        </div>
      </div>

      {/* ── 3. Diagnostic & Oracle Audit Details ──────────────────────── */}
      <div className="rounded-xl border border-surface-bright/10 bg-[#08090E]/60 p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-surface-bright/5 pb-2.5">
          <h5 className="text-xs font-bold uppercase tracking-wider text-on-surface-variant">
            {t("tabAuditTrail")}
          </h5>
          <span className="text-[11px] font-mono text-on-surface-variant/60">
            Cycle #{draw.cycleId}
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="space-y-1">
            <span className="text-[10px] uppercase text-on-surface-variant/60 font-medium">
              {t("oracleAccount")}
            </span>
            <div>
              {draw.randomnessAccount ? (
                <AccountExplorerLink
                  address={draw.randomnessAccount}
                  showCopy
                />
              ) : (
                <span className="text-on-surface-variant/40 font-mono">—</span>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-[10px] uppercase text-on-surface-variant/60 font-medium">
              {t("statusColumn")}
            </span>
            <p className="text-[11px] font-mono text-on-surface-variant/80">
              {draw.status}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
