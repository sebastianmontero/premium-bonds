"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PoolInfo, PrizeTier } from "@/app/types";
import {
  formatTierPayoutAmount,
  DEFAULT_LIVE_YIELD_PRECISION,
  formatCycleFrequency,
  getTierTheme,
  BPS_DENOMINATOR,
  bpsToRate,
  formatBasisPoints,
} from "@/app/lib/formatters";
import { safeSetElementText } from "@/app/lib/dom-utils";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
import { useTierLabel } from "@/app/hooks/useTierLabel";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { TierBadge } from "@/app/components/common/TierBadge";
import { useTranslations } from "next-intl";
import { AdaptiveModal } from "@/app/components/common/AdaptiveModal";

export interface TierRowModel {
  tier: PrizeTier;
  idx: number;
  winnerRatio: number;
  totalRatio: number;
  basisPointsFormatted: string;
  initialWinnerFormatted: string;
  initialTotalFormatted: string;
}

export interface TierRowRefs {
  desktopWinner: HTMLSpanElement | null;
  desktopTotal: HTMLSpanElement | null;
  mobileWinner: HTMLSpanElement | null;
  mobileTotal: HTMLSpanElement | null;
}

interface PrizeTiersModalProps {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo;
  onDeposit?: () => void;
  precision?: number;
}

export function PrizeTiersModal({
  isOpen,
  onClose,
  pool,
  onDeposit,
  precision = DEFAULT_LIVE_YIELD_PRECISION,
}: PrizeTiersModalProps) {
  const safePrecision =
    Number.isInteger(precision) && precision >= 0 && precision <= 20
      ? precision
      : DEFAULT_LIVE_YIELD_PRECISION;

  const t = useTranslations("Pools");
  const getTierLabel = useTierLabel();

  const activeTiers = useMemo(
    () =>
      (pool.prizeTiers || []).filter(
        (tier) => tier.basisPoints > 0 && tier.numWinners > 0
      ),
    [pool.prizeTiers]
  );

  const totalWinnersCount = useMemo(
    () => activeTiers.reduce((acc, tier) => acc + tier.numWinners, 0),
    [activeTiers]
  );

  const totalBasisPoints = useMemo(
    () =>
      activeTiers.reduce(
        (acc, tier) => acc + tier.basisPoints * tier.numWinners,
        0
      ),
    [activeTiers]
  );

  const tokenSymbol = pool.tokenSymbol ?? "USDC";

  const { calculateCurrentValue, baseUi } = useLivePrizePot({
    pool,
    debugLabel: `Modal-${tokenSymbol}`,
  });

  const tierRowRefsMap = useRef<Map<number, TierRowRefs>>(new Map());
  const barRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const footerTotalSpanRef = useRef<HTMLSpanElement | null>(null);
  const mobileFooterTotalSpanRef = useRef<HTMLSpanElement | null>(null);

  const registerTierRef =
    (idx: number, role: keyof TierRowRefs) => (el: HTMLSpanElement | null) => {
      let row = tierRowRefsMap.current.get(idx);
      if (!row) {
        row = {
          desktopWinner: null,
          desktopTotal: null,
          mobileWinner: null,
          mobileTotal: null,
        };
        tierRowRefsMap.current.set(idx, row);
      }
      row[role] = el;
      return () => {
        const current = tierRowRefsMap.current.get(idx);
        if (current) {
          current[role] = null;
          if (
            !current.desktopWinner &&
            !current.desktopTotal &&
            !current.mobileWinner &&
            !current.mobileTotal
          ) {
            tierRowRefsMap.current.delete(idx);
          }
        }
      };
    };

  const handleTierHover = (idx: number | null) => {
    activeTiers.forEach((_, i) => {
      const isHovered = i === idx;
      barRefs.current[i]?.classList.toggle("brightness-125", isHovered);
      barRefs.current[i]?.classList.toggle("ring-1", isHovered);
      barRefs.current[i]?.classList.toggle("ring-primary", isHovered);
      rowRefs.current[i]?.classList.toggle(
        "bg-surface-container-high/40",
        isHovered
      );
    });
  };

  const tierRows = useMemo<TierRowModel[]>(() => {
    return activeTiers.map((tier, idx) => {
      const sanitizedBps = Math.min(tier.basisPoints, BPS_DENOMINATOR);
      const winnerRatio = bpsToRate(sanitizedBps);
      const totalRatio = bpsToRate(sanitizedBps * Math.max(1, tier.numWinners));
      const basisPointsFormatted = formatBasisPoints(tier.basisPoints, 1);
      const initialWinnerFormatted = formatTierPayoutAmount(
        baseUi * winnerRatio,
        tokenSymbol,
        safePrecision
      );
      const initialTotalFormatted = formatTierPayoutAmount(
        baseUi * totalRatio,
        tokenSymbol,
        safePrecision
      );
      return {
        tier,
        idx,
        winnerRatio,
        totalRatio,
        basisPointsFormatted,
        initialWinnerFormatted,
        initialTotalFormatted,
      };
    });
  }, [activeTiers, baseUi, tokenSymbol, safePrecision]);

  const initialTotalPotFormatted = useMemo(
    () => formatTierPayoutAmount(baseUi, tokenSymbol, safePrecision),
    [baseUi, tokenSymbol, safePrecision]
  );

  useEffect(() => {
    if (!isOpen || pool.isFrozenForDraw || tierRows.length === 0) return;

    let animFrameId: number;

    const tick = () => {
      const nowInSeconds = Date.now() / 1000;
      const currentPotUi = calculateCurrentValue(nowInSeconds);

      tierRowRefsMap.current.forEach((refs, i) => {
        const rowModel = tierRows[i];
        if (!rowModel) return;
        const { winnerRatio, totalRatio } = rowModel;
        const winnerFormatted = formatTierPayoutAmount(
          currentPotUi * winnerRatio,
          tokenSymbol,
          safePrecision
        );
        const totalFormatted = formatTierPayoutAmount(
          currentPotUi * totalRatio,
          tokenSymbol,
          safePrecision
        );

        safeSetElementText(refs.desktopWinner, winnerFormatted);
        safeSetElementText(refs.desktopTotal, totalFormatted);
        safeSetElementText(refs.mobileWinner, winnerFormatted);
        safeSetElementText(refs.mobileTotal, totalFormatted);
      });

      const formattedTotalPot = formatTierPayoutAmount(
        currentPotUi,
        tokenSymbol,
        safePrecision
      );
      safeSetElementText(footerTotalSpanRef.current, formattedTotalPot);
      safeSetElementText(mobileFooterTotalSpanRef.current, formattedTotalPot);

      animFrameId = requestAnimationFrame(tick);
    };

    animFrameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(animFrameId);
    };
  }, [
    isOpen,
    pool.isFrozenForDraw,
    calculateCurrentValue,
    tierRows,
    tokenSymbol,
    safePrecision,
  ]);

  if (!isOpen) return null;

  const totalSharePctFormatted = formatBasisPoints(totalBasisPoints, 1);

  return (
    <AdaptiveModal
      isOpen={isOpen}
      onClose={onClose}
      title={t("allPrizeTiersTitle", { count: activeTiers.length })}
      subtitle={t("drawCycleBadge", {
        cycleId: pool.currentDrawCycleId,
        frequency: formatCycleFrequency(pool.stakeCycleDurationHrs, t),
      })}
      titleIcon={
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 border border-primary/20 text-primary">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="8" r="7" />
            <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
          </svg>
        </div>
      }
      size="lg"
      scrollable={false}
      bodyClassName="space-y-4 @container"
    >
      {/* ── Live Pot Hero Sub-Header ───────────────────────────────── */}
      <div className="rounded-xl bg-surface-container/70 px-4 py-3 border border-surface-container-high/50 shrink-0 space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-on-surface-variant">
            {t("estimatedPot")}
          </span>
          <LiveYieldTicker
            pool={pool}
            precision={safePrecision}
            showBadge={true}
            valueClassName="font-display text-lg font-bold text-gradient"
            debugLabel={`Modal-${tokenSymbol}`}
          />
        </div>

        {/* Segmented Pot Distribution Progress Bar */}
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-container-high/60 flex gap-0.5">
            {activeTiers.map((tier, idx) => {
              const tierSharePct = (tier.basisPoints * tier.numWinners) / 100;
              const theme = getTierTheme(idx);
              return (
                <div
                  key={idx}
                  ref={(el) => {
                    barRefs.current[idx] = el;
                  }}
                  style={{ width: `${tierSharePct}%` }}
                  className={`h-full ${theme.barClass} transition-all cursor-pointer`}
                  title={`${getTierLabel(idx, { format: "full" })}: ${tierSharePct.toFixed(1)}%`}
                  onMouseEnter={() => handleTierHover(idx)}
                  onMouseLeave={() => handleTierHover(null)}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-on-surface-variant px-0.5">
            <span>
              {activeTiers.length > 0 && activeTiers[0].basisPoints > 0
                ? t("grandPrizeSpotlight", {
                    percent: formatBasisPoints(
                      activeTiers[0].basisPoints * activeTiers[0].numWinners,
                      1
                    ),
                  })
                : t("potDistributionLabel")}
            </span>
            <span className="font-mono text-primary font-semibold">
              {totalSharePctFormatted} {t("allocated")}
            </span>
          </div>
        </div>
      </div>

      {/* ── Content Area: Desktop Table & Mobile Cards ─────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {/* Desktop Table View (>= 590px container) */}
        <div className="hidden @[590px]:block rounded-xl border border-surface-container-high/40 bg-surface-container/30">
          <table
            className="w-full table-fixed text-left text-xs border-separate border-spacing-0"
            aria-label={t("allPrizeTiersTitle", {
              count: activeTiers.length,
            })}
          >
            <thead className="sticky top-0 z-10 bg-surface-container/95 backdrop-blur-xs">
              <tr className="border-b border-surface-container-high/40 bg-surface-container/60 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">
                <th scope="col" className="py-2.5 px-1.5 sm:px-2 w-[15%]">
                  {t("tierColumn")}
                </th>
                <th
                  scope="col"
                  className="py-2.5 px-1.5 sm:px-2 text-right w-[12%]"
                >
                  {t("shareColumn")}
                </th>
                <th
                  scope="col"
                  className="py-2.5 px-1.5 sm:px-2 text-center w-[15%]"
                >
                  {t("winnersColumn")}
                </th>
                <th
                  scope="col"
                  className="py-2.5 px-1.5 sm:px-2 text-right w-[29%]"
                >
                  {t("estPerWinnerColumn")}
                </th>
                <th
                  scope="col"
                  className="py-2.5 px-1.5 sm:px-2 text-right w-[29%]"
                >
                  {t("totalTierShareColumn")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high/30 font-medium text-on-surface">
              {tierRows.map((row) => (
                <tr
                  key={row.idx}
                  ref={(el) => {
                    rowRefs.current[row.idx] = el;
                  }}
                  className="hover:bg-surface-container-high/30 transition-colors"
                  onMouseEnter={() => handleTierHover(row.idx)}
                  onMouseLeave={() => handleTierHover(null)}
                >
                  <th
                    scope="row"
                    className="py-2.5 px-1.5 sm:px-2 font-semibold text-left"
                  >
                    <TierBadge tierIndex={row.idx} />
                  </th>
                  <td className="py-2.5 px-1.5 sm:px-2 text-right font-mono text-primary font-semibold whitespace-nowrap">
                    {row.basisPointsFormatted}
                  </td>
                  <td className="py-2.5 px-1.5 sm:px-2 text-center whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-container-high/60 font-mono text-xs text-on-surface-variant font-medium whitespace-nowrap">
                      ×{row.tier.numWinners}
                    </span>
                  </td>
                  <td className="py-2.5 px-1.5 sm:px-2 text-right font-mono font-bold tabular-nums whitespace-nowrap text-on-surface">
                    <span
                      ref={registerTierRef(row.idx, "desktopWinner")}
                      aria-hidden="true"
                    >
                      {row.initialWinnerFormatted}
                    </span>
                    <span className="sr-only">
                      {t("estPerWinnerColumn")}: {row.initialWinnerFormatted}
                    </span>
                  </td>
                  <td className="py-2.5 px-1.5 sm:px-2 text-right font-mono tabular-nums whitespace-nowrap text-on-surface-variant">
                    <span
                      ref={registerTierRef(row.idx, "desktopTotal")}
                      aria-hidden="true"
                    >
                      {row.initialTotalFormatted}
                    </span>
                    <span className="sr-only">
                      {t("totalTierShareColumn")}: {row.initialTotalFormatted}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Summary Totals Footer Row */}
            <tfoot className="border-t-2 border-surface-container-high/60 bg-surface-container/60 font-semibold text-xs text-on-surface">
              <tr>
                <th colSpan={2} scope="row" className="py-2.5 px-2 text-left">
                  <div className="font-semibold text-on-surface">
                    {t("totalSummaryLabel")}
                  </div>
                  <div className="text-[10px] text-on-surface-variant font-normal">
                    {t("distributedAcrossTiers")} ({totalSharePctFormatted})
                  </div>
                </th>
                <td className="py-2.5 px-2 text-center font-mono text-on-surface whitespace-nowrap">
                  {totalWinnersCount} {t("winnersShort")}
                </td>
                <td
                  colSpan={2}
                  className="py-2.5 px-2 text-right font-mono font-bold text-gradient whitespace-nowrap"
                >
                  <span ref={footerTotalSpanRef} aria-hidden="true">
                    {initialTotalPotFormatted}
                  </span>
                  <span className="sr-only">
                    {t("totalSummaryLabel")}: {initialTotalPotFormatted}
                  </span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Mobile Stacked Card View (< 590px container) */}
        <div className="block @[590px]:hidden space-y-2.5">
          {tierRows.map((row) => (
            <div
              key={row.idx}
              className="rounded-xl border border-surface-container-high/50 bg-surface-container/40 p-3.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TierBadge tierIndex={row.idx} />
                <span className="font-mono text-xs font-bold text-primary ml-auto">
                  {row.basisPointsFormatted} {t("allocated")}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                <div className="space-y-0.5">
                  <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                    {t("estPerWinnerColumn")}
                  </p>
                  <p className="font-mono font-bold text-on-surface text-sm tabular-nums whitespace-nowrap">
                    <span
                      ref={registerTierRef(row.idx, "mobileWinner")}
                      aria-hidden="true"
                    >
                      {row.initialWinnerFormatted}
                    </span>
                    <span className="sr-only">
                      {t("estPerWinnerColumn")}: {row.initialWinnerFormatted}
                    </span>
                  </p>
                </div>
                <div className="text-right space-y-0.5 shrink-0">
                  <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                    {t("winnersColumn")}
                  </p>
                  <p className="font-mono text-xs text-on-surface font-semibold">
                    ×{row.tier.numWinners} {t("winnersShort")}
                  </p>
                </div>
              </div>

              <div className="border-t border-surface-container-high/30 pt-2 flex items-center justify-between text-[11px] text-on-surface-variant">
                <span>{t("totalTierShareColumn")}</span>
                <span className="font-mono font-medium text-on-surface tabular-nums whitespace-nowrap">
                  <span
                    ref={registerTierRef(row.idx, "mobileTotal")}
                    aria-hidden="true"
                  >
                    {row.initialTotalFormatted}
                  </span>
                  <span className="sr-only">
                    {t("totalTierShareColumn")}: {row.initialTotalFormatted}
                  </span>
                </span>
              </div>
            </div>
          ))}

          {/* Mobile Summary Card */}
          <div className="rounded-xl border border-surface-container-high/70 bg-surface-container/70 p-3 flex items-center justify-between text-xs font-semibold">
            <div className="space-y-0.5">
              <span className="text-on-surface">{t("totalSummaryLabel")}</span>
              <p className="text-[10px] text-on-surface-variant font-normal">
                {totalWinnersCount} {t("winnersShort")} ·{" "}
                {totalSharePctFormatted}
              </p>
            </div>
            <span className="font-mono text-sm font-bold text-gradient tabular-nums whitespace-nowrap">
              <span ref={mobileFooterTotalSpanRef} aria-hidden="true">
                {initialTotalPotFormatted}
              </span>
              <span className="sr-only">
                {t("totalSummaryLabel")}: {initialTotalPotFormatted}
              </span>
            </span>
          </div>
        </div>
      </div>

      {/* ── Footer Action Bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-surface-container-high/40 shrink-0">
        <button
          onClick={onClose}
          className="btn-ghost rounded-xl px-4 py-2 text-xs font-semibold cursor-pointer"
        >
          {t("close")}
        </button>
        {onDeposit && (
          <button
            onClick={() => {
              onClose();
              onDeposit();
            }}
            disabled={pool.isFrozenForDraw || pool.status !== "Active"}
            className="btn-gradient rounded-xl px-5 py-2 text-xs font-semibold shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pool.isFrozenForDraw
              ? t("drawInProgress")
              : pool.status === "Paused"
                ? t("statusPaused")
                : pool.status === "Closed"
                  ? t("statusClosed")
                  : t("depositToEnterCta")}
          </button>
        )}
      </div>
    </AdaptiveModal>
  );
}
