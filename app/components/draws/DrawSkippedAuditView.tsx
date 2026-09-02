"use client";

import React from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import type { DetailedDrawCycle, DrawDisplayConfig } from "@/app/types";
import { useTranslations } from "next-intl";

interface DrawSkippedAuditViewProps {
  draw: DetailedDrawCycle;
  config?: DrawDisplayConfig;
  minYieldThreshold?: number | bigint;
}

export function DrawSkippedAuditView({
  draw,
  config,
  minYieldThreshold,
}: DrawSkippedAuditViewProps) {
  const t = useTranslations("DrawInspector");
  const tokenDecimals = config?.tokenDecimals ?? 6;
  const tokenSymbol = config?.tokenSymbol ?? "USDC";

  const formattedThreshold =
    minYieldThreshold !== undefined && Number(minYieldThreshold) > 0
      ? `${formatTokenAmount(Number(minYieldThreshold), tokenDecimals)} ${tokenSymbol}`
      : undefined;

  return (
    <div className="flex-1 min-h-0 flex flex-col space-y-4 overflow-y-auto pr-1">
      {/* ── 1. Hero Reassurance & Rollover Banner ──────────────────────── */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/10 via-surface-container/60 to-surface-container/30 p-5 sm:p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-primary border border-primary/30 text-xl shadow-inner">
            🛡️
          </div>
          <div className="space-y-2">
            <h4 className="text-base sm:text-lg font-bold font-display text-on-surface">
              {t("skippedTitle")}
            </h4>
            <p className="text-xs sm:text-sm text-on-surface-variant leading-relaxed">
              {formattedThreshold
                ? t("skippedExplanation", { threshold: formattedThreshold })
                : t("skippedExplanationNoThreshold")}
            </p>
            <div className="pt-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/25 text-emerald-400 text-xs font-semibold">
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2.5}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                {t("principalSafetyNotice")}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* ── 2. Specialized Rollover Telemetry Metrics ─────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 shrink-0">
        {/* Metric 1: Harvest Slot */}
        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("harvestSlot")}
          </p>
          <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
            {Number(draw.harvestSlot).toLocaleString("en-US")}
          </p>
        </div>

        {/* Metric 2: Participating Mature Bonds */}
        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("participatingBonds")}
          </p>
          <p className="text-base font-bold font-mono text-on-surface mt-1 truncate">
            {draw.lockedTicketCount.toLocaleString("en-US")}
          </p>
        </div>

        {/* Metric 3: Rollover Yield Destination */}
        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("rolloverDestinationLabel")}
          </p>
          <p className="text-xs sm:text-sm font-bold text-primary mt-1 truncate">
            {t("rolloverDestinationVault")}
          </p>
        </div>

        {/* Metric 4: Protocol Fee (Zero Taken) */}
        <div className="p-3.5 rounded-xl bg-surface-container/20 border border-surface-bright/5 flex flex-col justify-between">
          <p className="text-[10px] uppercase tracking-wider text-on-surface-variant font-semibold">
            {t("protocolFee")}
          </p>
          <p className="text-xs sm:text-sm font-bold font-mono text-emerald-400 mt-1 truncate">
            {t("zeroFeesAssessed")}
          </p>
        </div>
      </div>

      {/* ── 3. On-Chain Audit & Cryptographic Transparency Card ──────── */}
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
              {t("noRandomnessNotice")}
            </span>
            <p className="text-[11px] text-on-surface-variant/70 leading-relaxed">
              {t("noRandomnessSkippedSub")}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
