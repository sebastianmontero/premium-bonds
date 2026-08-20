"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PoolInfo } from "@/app/types";
import {
  calculateTierPayout,
  getLocalizedTierLabel,
  formatTierPayoutAmount,
  DEFAULT_LIVE_YIELD_PRECISION,
  getLiveYieldFormatter,
} from "@/app/lib/formatters";
import { useLivePrizePot } from "@/app/hooks/useLivePrizePot";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { useTranslations } from "next-intl";

interface PrizeTiersModalProps {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo;
  onDeposit?: () => void;
}

export function PrizeTiersModal({
  isOpen,
  onClose,
  pool,
  onDeposit,
}: PrizeTiersModalProps) {
  const t = useTranslations("Pools");

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

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
  const isUsdc = tokenSymbol.toUpperCase() === "USDC";

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

  const numberFormatter = useMemo(
    () => getLiveYieldFormatter(DEFAULT_LIVE_YIELD_PRECISION),
    []
  );

  const precomputedTiers = useMemo(
    () =>
      activeTiers.map((tier) => {
        const sanitizedBps = Math.min(tier.basisPoints, 10_000);
        return {
          winnerRatio: sanitizedBps / 10_000,
          totalRatio: (sanitizedBps * Math.max(1, tier.numWinners)) / 10_000,
        };
      }),
    [activeTiers]
  );

  useEffect(() => {
    if (!isOpen || pool.isFrozenForDraw || precomputedTiers.length === 0)
      return;

    let animFrameId: number;

    const formatCurrency = (val: number) =>
      isUsdc
        ? `$${numberFormatter.format(val)}`
        : `${numberFormatter.format(val)} ${tokenSymbol}`;

    const tick = () => {
      const nowInSeconds = Date.now() / 1000;
      const currentPotUi = calculateCurrentValue(nowInSeconds);

      for (let i = 0; i < precomputedTiers.length; i++) {
        const { winnerRatio, totalRatio } = precomputedTiers[i];
        const winnerFormatted = formatCurrency(currentPotUi * winnerRatio);
        const totalFormatted = formatCurrency(currentPotUi * totalRatio);

        const dWinnerEl = desktopWinnerSpanRefs.current[i];
        if (dWinnerEl) dWinnerEl.textContent = winnerFormatted;

        const dTotalEl = desktopTotalSpanRefs.current[i];
        if (dTotalEl) dTotalEl.textContent = totalFormatted;

        const mWinnerEl = mobileWinnerSpanRefs.current[i];
        if (mWinnerEl) mWinnerEl.textContent = winnerFormatted;

        const mTotalEl = mobileTotalSpanRefs.current[i];
        if (mTotalEl) mTotalEl.textContent = totalFormatted;
      }

      const formattedTotalPot = formatCurrency(currentPotUi);
      if (footerTotalSpanRef.current) {
        footerTotalSpanRef.current.textContent = formattedTotalPot;
      }
      if (mobileFooterTotalSpanRef.current) {
        mobileFooterTotalSpanRef.current.textContent = formattedTotalPot;
      }

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
    precomputedTiers,
    numberFormatter,
    isUsdc,
    tokenSymbol,
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* ── Solid High-Blur Backdrop (Eliminates Ghost Text Bleeding) ── */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-200 animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* ── Modal Dialog Container ──────────────────────────────────── */}
      <div
        className="relative w-full max-w-2xl rounded-2xl border border-surface-container-high/60 bg-[#0F111A]/95 p-6 shadow-2xl z-10 overflow-hidden flex flex-col max-h-[88vh] space-y-4 animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prize-tiers-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-surface-container-high/40 pb-4 shrink-0">
          <div className="flex items-center gap-2.5">
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
            <div>
              <h2
                id="prize-tiers-modal-title"
                className="font-display text-lg font-bold text-on-surface"
              >
                {t("allPrizeTiersTitle", { count: activeTiers.length })}
              </h2>
              <p className="text-[11px] text-on-surface-variant">
                {t("weeklyDraw", { cycleId: pool.currentDrawCycleId })}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface transition cursor-pointer"
            aria-label="Close"
          >
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* ── Live Pot Hero Sub-Header ───────────────────────────────── */}
        <div className="rounded-xl bg-surface-container/70 px-4 py-3 border border-surface-container-high/50 shrink-0 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-on-surface-variant">
              {t("estimatedPot")}
            </span>
            <LiveYieldTicker
              pool={pool}
              precision={DEFAULT_LIVE_YIELD_PRECISION}
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
                const bgClass =
                  idx === 0
                    ? "bg-amber-400"
                    : idx === 1
                      ? "bg-secondary"
                      : idx === 2
                        ? "bg-tertiary"
                        : "bg-primary/70";
                return (
                  <div
                    key={idx}
                    style={{ width: `${tierSharePct}%` }}
                    className={`h-full ${bgClass} transition-all`}
                    title={`${getLocalizedTierLabel(idx, activeTiers.length, t)}: ${tierSharePct.toFixed(1)}%`}
                  />
                );
              })}
            </div>
            <div className="flex items-center justify-between text-[10px] text-on-surface-variant px-0.5">
              <span>{t("potDistributionLabel")}</span>
              <span className="font-mono text-primary font-semibold">
                {totalSharePctFormatted}% {t("allocated")}
              </span>
            </div>
          </div>
        </div>

        {/* ── Content Area: Desktop Table & Mobile Cards ─────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          {/* Desktop Table View (>= sm) */}
          <div className="hidden sm:block overflow-x-auto rounded-xl border border-surface-container-high/40 bg-surface-container/30">
            <table className="w-full min-w-[560px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-container-high/40 bg-surface-container/60 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                  <th
                    scope="col"
                    className="py-3 px-4 min-w-[155px] whitespace-nowrap"
                  >
                    {t("tierColumn")}
                  </th>
                  <th
                    scope="col"
                    className="py-3 px-4 text-right w-[85px] whitespace-nowrap"
                  >
                    {t("shareColumn")}
                  </th>
                  <th
                    scope="col"
                    className="py-3 px-4 text-center w-[90px] whitespace-nowrap"
                  >
                    {t("winnersColumn")}
                  </th>
                  <th
                    scope="col"
                    className="py-3 px-4 text-right whitespace-nowrap"
                  >
                    {t("estPerWinnerColumn")}
                  </th>
                  <th
                    scope="col"
                    className="py-3 px-4 text-right whitespace-nowrap"
                  >
                    {t("totalTierShareColumn")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-high/30 font-medium text-on-surface">
                {activeTiers.map((tier, i) => {
                  const basisPointsPct = (
                    tier.basisPoints / 100
                  ).toLocaleString("en-US", { maximumFractionDigits: 1 });
                  const breakdown = calculateTierPayout(baseUi, tier, 0);
                  const initialWinnerFormatted = formatTierPayoutAmount(
                    breakdown.payoutPerWinnerUi,
                    tokenSymbol,
                    DEFAULT_LIVE_YIELD_PRECISION
                  );
                  const initialTotalFormatted = formatTierPayoutAmount(
                    breakdown.totalTierShareUi,
                    tokenSymbol,
                    DEFAULT_LIVE_YIELD_PRECISION
                  );

                  return (
                    <tr
                      key={i}
                      className="hover:bg-surface-container-high/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold whitespace-nowrap">
                        <TierBadge
                          tierIndex={i}
                          totalTiers={activeTiers.length}
                          label={getLocalizedTierLabel(
                            i,
                            activeTiers.length,
                            t
                          )}
                        />
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-primary font-semibold whitespace-nowrap">
                        {basisPointsPct}%
                      </td>
                      <td className="py-3 px-4 text-center whitespace-nowrap">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-surface-container-high/60 font-mono text-xs text-on-surface-variant font-medium whitespace-nowrap">
                          ×{tier.numWinners}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono font-bold tabular-nums whitespace-nowrap text-on-surface">
                        <span
                          ref={(el) => {
                            desktopWinnerSpanRefs.current[i] = el;
                          }}
                          aria-hidden="true"
                        >
                          {initialWinnerFormatted}
                        </span>
                        <span className="sr-only">
                          {t("estPerWinnerColumn")}: {initialWinnerFormatted}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums whitespace-nowrap text-on-surface-variant">
                        <span
                          ref={(el) => {
                            desktopTotalSpanRefs.current[i] = el;
                          }}
                          aria-hidden="true"
                        >
                          {initialTotalFormatted}
                        </span>
                        <span className="sr-only">
                          {t("totalTierShareColumn")}: {initialTotalFormatted}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {/* Summary Totals Footer Row */}
              <tfoot className="border-t-2 border-surface-container-high/60 bg-surface-container/60 font-semibold text-xs text-on-surface">
                <tr>
                  <td className="py-3 px-4 text-on-surface whitespace-nowrap">
                    {t("totalSummaryLabel")}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-primary font-bold whitespace-nowrap">
                    {totalSharePctFormatted}%
                  </td>
                  <td className="py-3 px-4 text-center font-mono text-on-surface whitespace-nowrap">
                    {totalWinnersCount} {t("winnersShort")}
                  </td>
                  <td className="py-3 px-4 text-right text-on-surface-variant text-[11px] font-normal whitespace-nowrap">
                    {t("distributedAcrossTiers")}
                  </td>
                  <td className="py-3 px-4 text-right font-mono font-bold text-gradient whitespace-nowrap">
                    <span ref={footerTotalSpanRef} aria-hidden="true">
                      {formatTierPayoutAmount(
                        baseUi,
                        tokenSymbol,
                        DEFAULT_LIVE_YIELD_PRECISION
                      )}
                    </span>
                    <span className="sr-only">
                      {t("totalSummaryLabel")}:{" "}
                      {formatTierPayoutAmount(
                        baseUi,
                        tokenSymbol,
                        DEFAULT_LIVE_YIELD_PRECISION
                      )}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Mobile Stacked Card View (< sm) */}
          <div className="block sm:hidden space-y-2.5">
            {activeTiers.map((tier, i) => {
              const basisPointsPct = (tier.basisPoints / 100).toLocaleString(
                "en-US",
                { maximumFractionDigits: 1 }
              );
              const breakdown = calculateTierPayout(baseUi, tier, 0);
              const initialWinnerFormatted = formatTierPayoutAmount(
                breakdown.payoutPerWinnerUi,
                tokenSymbol,
                DEFAULT_LIVE_YIELD_PRECISION
              );
              const initialTotalFormatted = formatTierPayoutAmount(
                breakdown.totalTierShareUi,
                tokenSymbol,
                DEFAULT_LIVE_YIELD_PRECISION
              );

              return (
                <div
                  key={i}
                  className="rounded-xl border border-surface-container-high/50 bg-surface-container/40 p-3.5 space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <TierBadge
                      tierIndex={i}
                      totalTiers={activeTiers.length}
                      label={getLocalizedTierLabel(i, activeTiers.length, t)}
                    />
                    <span className="font-mono text-xs font-bold text-primary">
                      {basisPointsPct}% {t("shareColumn")}
                    </span>
                  </div>

                  <div className="flex items-center justify-between pt-1 text-xs">
                    <div className="space-y-0.5">
                      <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                        {t("estPerWinnerColumn")}
                      </p>
                      <p className="font-mono font-bold text-on-surface text-sm">
                        <span
                          ref={(el) => {
                            mobileWinnerSpanRefs.current[i] = el;
                          }}
                        >
                          {initialWinnerFormatted}
                        </span>
                      </p>
                    </div>
                    <div className="text-right space-y-0.5">
                      <p className="text-[10px] text-on-surface-variant uppercase font-medium">
                        {t("winnersColumn")}
                      </p>
                      <p className="font-mono text-xs text-on-surface font-semibold">
                        ×{tier.numWinners} {t("winnersShort")}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-surface-container-high/30 pt-2 flex items-center justify-between text-[11px] text-on-surface-variant">
                    <span>{t("totalTierShareColumn")}</span>
                    <span
                      ref={(el) => {
                        mobileTotalSpanRefs.current[i] = el;
                      }}
                      className="font-mono font-medium text-on-surface"
                    >
                      {initialTotalFormatted}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Mobile Summary Card */}
            <div className="rounded-xl border border-surface-container-high/70 bg-surface-container/70 p-3 flex items-center justify-between text-xs font-semibold">
              <div className="space-y-0.5">
                <span className="text-on-surface">
                  {t("totalSummaryLabel")}
                </span>
                <p className="text-[10px] text-on-surface-variant font-normal">
                  {totalWinnersCount} {t("winnersShort")} ·{" "}
                  {totalSharePctFormatted}%
                </p>
              </div>
              <span
                ref={mobileFooterTotalSpanRef}
                className="font-mono text-sm font-bold text-gradient"
              >
                {formatTierPayoutAmount(
                  baseUi,
                  tokenSymbol,
                  DEFAULT_LIVE_YIELD_PRECISION
                )}
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
      </div>
    </div>
  );
}

function TierBadge({
  tierIndex,
  totalTiers,
  label,
}: {
  tierIndex: number;
  totalTiers: number;
  label: string;
}) {
  if (tierIndex === 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 px-2.5 py-1 text-xs font-bold text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)] whitespace-nowrap shrink-0">
        <span>🏆</span>
        <span>{label}</span>
      </span>
    );
  }

  if (tierIndex === 1) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/10 border border-secondary/30 px-2.5 py-1 text-xs font-bold text-secondary whitespace-nowrap shrink-0">
        <span>🥈</span>
        <span>{label}</span>
      </span>
    );
  }

  if (tierIndex === 2 && totalTiers >= 3) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-lg bg-tertiary/10 border border-tertiary/30 px-2.5 py-1 text-xs font-semibold text-tertiary whitespace-nowrap shrink-0">
        <span>🥉</span>
        <span>{label}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-lg bg-surface-container-high border border-surface-container-highest px-2.5 py-1 text-xs font-medium text-on-surface-variant whitespace-nowrap shrink-0">
      <span className="text-[10px] font-mono text-primary font-bold">
        #{tierIndex + 1}
      </span>
      <span>{label}</span>
    </span>
  );
}
