"use client";

import { useEffect } from "react";
import type { PoolInfo } from "@/app/types";
import { formatTokenAmount, tierColor } from "@/app/lib/formatters";
import { useTranslations } from "next-intl";

interface PrizeTiersModalProps {
  isOpen: boolean;
  onClose: () => void;
  pool: PoolInfo;
}

export function PrizeTiersModal({
  isOpen,
  onClose,
  pool,
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

  if (!isOpen) return null;

  const activeTiers = (pool.prizeTiers || []).filter(
    (tier) => tier.basisPoints > 0 && tier.numWinners > 0
  );

  const getTierLabel = (tierIndex: number, totalCount: number) => {
    switch (tierIndex) {
      case 0:
        return t("grand");
      case 1:
        return t("runnerUp");
      default:
        if (totalCount <= 3) {
          return t("consolation");
        }
        return t("tierN", { tier: tierIndex + 1 });
    }
  };

  const totalAccruedYield = pool.estimatedPrizePot ?? 0;

  return (
    <div
      className="modal-backdrop animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="prize-tiers-modal-title"
    >
      <div
        className="w-full max-w-2xl rounded-2xl glass-strong p-6 shadow-ambient mx-4 relative overflow-hidden animate-scale-in flex flex-col max-h-[85vh] space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between border-b border-surface-container-high/40 pb-4 shrink-0">
          <div className="flex items-center gap-2">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <circle cx="12" cy="8" r="7" />
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
            </svg>
            <h2
              id="prize-tiers-modal-title"
              className="font-display text-lg font-bold text-on-surface"
            >
              {t("allPrizeTiersTitle", { count: activeTiers.length })}
            </h2>
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

        {/* ── Content / Table ────────────────────────────────────────── */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-1">
          <div className="overflow-x-auto rounded-xl border border-surface-container-high/40 bg-surface-container/30">
            <table className="w-full min-w-[520px] text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-surface-container-high/40 bg-surface-container/60 text-on-surface-variant font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3 px-4">{t("tierColumn")}</th>
                  <th className="py-3 px-4 text-right">{t("shareColumn")}</th>
                  <th className="py-3 px-4 text-center">
                    {t("winnersColumn")}
                  </th>
                  <th className="py-3 px-4 text-right">
                    {t("estPerWinnerColumn")}
                  </th>
                  <th className="py-3 px-4 text-right">
                    {t("totalTierShareColumn")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container-high/30 font-medium text-on-surface">
                {activeTiers.map((tier, i) => {
                  const basisPointsPct = (
                    tier.basisPoints / 100
                  ).toLocaleString("en-US", { maximumFractionDigits: 1 });
                  const totalTierYield =
                    (totalAccruedYield * tier.basisPoints) / 10000;
                  const estPerWinner =
                    tier.numWinners > 0 ? totalTierYield / tier.numWinners : 0;

                  return (
                    <tr
                      key={i}
                      className="hover:bg-surface-container-high/30 transition-colors"
                    >
                      <td className="py-3 px-4 font-semibold">
                        <span className={tierColor(i)}>
                          {getTierLabel(i, activeTiers.length)}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-primary font-semibold">
                        {basisPointsPct}%
                      </td>
                      <td className="py-3 px-4 text-center font-mono text-on-surface-variant">
                        ×{tier.numWinners}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-on-surface">
                        $
                        {formatTokenAmount(estPerWinner, pool.tokenDecimals, 2)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-on-surface-variant">
                        $
                        {formatTokenAmount(
                          totalTierYield,
                          pool.tokenDecimals,
                          2
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
