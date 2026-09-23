"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PoolInfo } from "@/app/types";
import {
  formatTierPayoutAmount,
  DEFAULT_LIVE_YIELD_PRECISION,
  formatCycleFrequency,
  getTierTheme,
} from "@/app/lib/formatters";
import { safeSetElementText } from "@/app/lib/dom-utils";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
import { useTierLabel } from "@/app/hooks/useTierLabel";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { TierBadge } from "@/app/components/common/TierBadge";
import { useTranslations } from "next-intl";
import { AdaptiveModal } from "@/app/components/common/AdaptiveModal";

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

  const desktopWinnerSpanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const desktopTotalSpanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const mobileWinnerSpanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const mobileTotalSpanRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const footerTotalSpanRef = useRef<HTMLSpanElement | null>(null);
  const mobileFooterTotalSpanRef = useRef<HTMLSpanElement | null>(null);

  const tierRows = useMemo(() => {
    return activeTiers.map((tier, idx) => {
      const sanitizedBps = Math.min(tier.basisPoints, 10_000);
      const winnerRatio = sanitizedBps / 10_000;
      const totalRatio = (sanitizedBps * Math.max(1, tier.numWinners)) / 10_000;
      const basisPointsPct = (tier.basisPoints / 100).toLocaleString("en-US", {
        maximumFractionDigits: 1,
      });
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
        basisPointsPct,
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

      for (let i = 0; i < tierRows.length; i++) {
        const { winnerRatio, totalRatio } = tierRows[i];
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

        safeSetElementText(desktopWinnerSpanRefs.current[i], winnerFormatted);
        safeSetElementText(desktopTotalSpanRefs.current[i], totalFormatted);
        safeSetElementText(mobileWinnerSpanRefs.current[i], winnerFormatted);
        safeSetElementText(mobileTotalSpanRefs.current[i], totalFormatted);
      }

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

  const totalSharePctFormatted = (totalBasisPoints / 100).toLocaleString(
    "en-US",
    {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }
  );

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
      size="md"
      bodyClassName="space-y-4"
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
                  style={{ width: `${tierSharePct}%` }}
                  className={`h-full ${theme.barClass} transition-all`}
                  title={`${getTierLabel(idx, { format: "full" })}: ${tierSharePct.toFixed(1)}%`}
                />
              );
            })}
          </div>
          <div className="flex items-center justify-between text-[10px] text-on-surface-variant px-0.5">
            <span>
              {activeTiers.length > 0 && activeTiers[0].basisPoints > 0
                ? t("grandPrizeSpotlight", {
                    percent: (
                      (activeTiers[0].basisPoints * activeTiers[0].numWinners) /
                      100
                    ).toLocaleString("en-US", { maximumFractionDigits: 1 }),
                  })
                : t("potDistributionLabel")}
            </span>
            <span className="font-mono text-primary font-semibold">
              {totalSharePctFormatted}% {t("allocated")}
            </span>
          </div>
        </div>
      </div>

      {/* ── Content Area: Desktop Table & Mobile Cards ─────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto pr-1">
        {/* Desktop Table View (>= md) */}
        <div
          className="hidden md:block overflow-x-auto rounded-xl border border-surface-container-high/40 bg-surface-container/30 focus:outline-none"
          tabIndex={0}
          role="region"
          aria-label={t("allPrizeTiersTitle", { count: activeTiers.length })}
        >
          <table
            className="w-full min-w-[640px] text-left text-xs border-collapse"
            aria-label={t("allPrizeTiersTitle", {
              count: activeTiers.length,
            })}
          >
            <thead>
              <tr className="border-b border-surface-container-high/40 bg-surface-container/60 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">
                <th scope="col" className="py-3 px-2.5 sm:px-3 w-[23%]">
                  {t("tierColumn")}
                </th>
                <th
                  scope="col"
                  className="py-3 px-2.5 sm:px-3 text-right w-[16%]"
                >
                  {t("shareColumn")}
                </th>
                <th
                  scope="col"
                  className="py-3 px-2.5 sm:px-3 text-center w-[17%]"
                >
                  {t("winnersColumn")}
                </th>
                <th
                  scope="col"
                  className="py-3 px-2.5 sm:px-3 text-right w-[21%]"
                >
                  {t("estPerWinnerColumn")}
                </th>
                <th
                  scope="col"
                  className="py-3 px-2.5 sm:px-3 text-right w-[23%]"
                >
                  {t("totalTierShareColumn")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-container-high/30 font-medium text-on-surface">
              {tierRows.map((row) => (
                <tr
                  key={row.idx}
                  className="hover:bg-surface-container-high/30 transition-colors"
                >
                  <th
                    scope="row"
                    className="py-3 px-2.5 sm:px-3 font-semibold text-left"
                  >
                    <TierBadge tierIndex={row.idx} />
                  </th>
                  <td className="py-3 px-2.5 sm:px-3 text-right font-mono text-primary font-semibold whitespace-nowrap">
                    {row.basisPointsPct}%
                  </td>
                  <td className="py-3 px-2.5 sm:px-3 text-center whitespace-nowrap">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-container-high/60 font-mono text-xs text-on-surface-variant font-medium whitespace-nowrap">
                      ×{row.tier.numWinners}
                    </span>
                  </td>
                  <td className="py-3 px-2.5 sm:px-3 text-right font-mono font-bold tabular-nums whitespace-nowrap text-on-surface">
                    <span
                      ref={(el) => {
                        desktopWinnerSpanRefs.current[row.idx] = el;
                      }}
                      aria-hidden="true"
                    >
                      {row.initialWinnerFormatted}
                    </span>
                    <span className="sr-only">
                      {t("estPerWinnerColumn")}: {row.initialWinnerFormatted}
                    </span>
                  </td>
                  <td className="py-3 px-2.5 sm:px-3 text-right font-mono tabular-nums whitespace-nowrap text-on-surface-variant">
                    <span
                      ref={(el) => {
                        desktopTotalSpanRefs.current[row.idx] = el;
                      }}
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
                <th scope="row" className="py-3 px-2.5 sm:px-3 text-left">
                  <div className="font-semibold text-on-surface">
                    {t("totalSummaryLabel")}
                  </div>
                  <div className="text-[10px] text-on-surface-variant font-normal">
                    {t("distributedAcrossTiers")}
                  </div>
                </th>
                <td className="py-3 px-2.5 sm:px-3 text-right font-mono text-primary font-bold whitespace-nowrap">
                  {totalSharePctFormatted}%
                </td>
                <td className="py-3 px-2.5 sm:px-3 text-center font-mono text-on-surface whitespace-nowrap">
                  {totalWinnersCount} {t("winnersShort")}
                </td>
                <td className="py-3 px-2.5 sm:px-3 text-right font-mono text-on-surface-variant/40 whitespace-nowrap">
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{t("notApplicable")}</span>
                </td>
                <td className="py-3 px-2.5 sm:px-3 text-right font-mono font-bold text-gradient whitespace-nowrap">
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

        {/* Mobile Stacked Card View (< md) */}
        <div className="block md:hidden space-y-2.5">
          {tierRows.map((row) => (
            <div
              key={row.idx}
              className="rounded-xl border border-surface-container-high/50 bg-surface-container/40 p-3.5 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <TierBadge tierIndex={row.idx} />
                <span className="font-mono text-xs font-bold text-primary ml-auto">
                  {row.basisPointsPct}% {t("allocated")}
                </span>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 text-xs">
                <div className="space-y-0.5">
                  <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                    {t("estPerWinnerColumn")}
                  </p>
                  <p className="font-mono font-bold text-on-surface text-sm tabular-nums whitespace-nowrap">
                    <span
                      ref={(el) => {
                        mobileWinnerSpanRefs.current[row.idx] = el;
                      }}
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
                    ref={(el) => {
                      mobileTotalSpanRefs.current[row.idx] = el;
                    }}
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
                {totalSharePctFormatted}%
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
            disabled={pool.isFrozenForDraw || pool.status === "Paused"}
            className="btn-gradient rounded-xl px-5 py-2 text-xs font-semibold shadow-lg cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {pool.isFrozenForDraw
              ? t("drawInProgress")
              : t("depositToEnterCta")}
          </button>
        )}
      </div>
    </AdaptiveModal>
  );
}
