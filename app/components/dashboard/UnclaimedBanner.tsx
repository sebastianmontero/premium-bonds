"use client";

import { useState } from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { InteractiveTooltip } from "@/app/components/common/InteractiveTooltip";
import { getClaimWinningsCapability } from "@/app/lib/draw-helpers";
import { useTranslations } from "next-intl";

interface UnclaimedBannerProps {
  totalUnclaimed: number; // base units
  tokenSymbol: string;
  tokenDecimals: number;
  bondPrice: number; // base units
  pool?: { isFrozenForDraw?: boolean } | null;
  isFrozenForDraw?: boolean;
  onClaim: () => void;
}

export function UnclaimedBanner({
  totalUnclaimed,
  tokenSymbol,
  tokenDecimals,
  bondPrice,
  pool,
  isFrozenForDraw,
  onClaim,
}: UnclaimedBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const t = useTranslations("Unclaimed");

  const effectivePool =
    pool ?? (isFrozenForDraw !== undefined ? { isFrozenForDraw } : null);
  const capability = getClaimWinningsCapability({
    pool: effectivePool,
    unclaimedAmount: totalUnclaimed,
  });

  if (dismissed || totalUnclaimed <= 0) return null;

  const formattedBondPrice = formatTokenAmount(bondPrice, tokenDecimals);

  return (
    <div className="relative rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-yellow-500/8 to-amber-600/10 px-6 py-4">
      {/* Contained glow accent to prevent clipping floating popover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl"
      >
        <div className="absolute -right-10 -top-10 h-32 w-32 rounded-full bg-amber-400/15 blur-[60px]" />
      </div>

      <div className="relative flex items-center justify-between gap-4 flex-wrap sm:flex-nowrap">
        <div className="flex items-center gap-4">
          {/* Trophy icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/20">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#fbbf24"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9H4.5a2.5 2.5 0 010-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 000-5H18" />
              <path d="M4 22h16" />
              <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
              <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
              <path d="M18 2H6v7a6 6 0 0012 0V2z" />
            </svg>
          </div>

          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-amber-200">
                {t("title")}
              </p>
              {!capability.canExecute &&
                capability.disabledReason === "frozen_for_draw" && (
                  <span
                    role="status"
                    aria-live="polite"
                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] font-semibold text-amber-300 animate-yield-pulse"
                  >
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-spin" />
                    {t("frozenNotice")}
                  </span>
                )}
            </div>

            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-amber-200/70">
              <span className="font-mono font-semibold text-amber-300">
                {formatTokenAmount(totalUnclaimed, tokenDecimals)} {tokenSymbol}
              </span>
              <span>{t("description")}</span>

              {/* Remaining winnings info tooltip trigger & popover */}
              <InteractiveTooltip
                ariaLabel={t("dustTooltipTrigger")}
                align="left"
                side="bottom"
                role="dialog"
                triggerClassName="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-amber-300/80 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400/50 cursor-help transition-colors"
                panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
                content={
                  <div>
                    <div className="flex items-center gap-1.5 text-amber-300 font-semibold mb-1">
                      <svg
                        className="h-4 w-4 shrink-0 text-amber-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        aria-hidden="true"
                      >
                        <circle cx="12" cy="12" r="10" strokeWidth="2" />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 16v-4m0-4h.01"
                        />
                      </svg>
                      <span>{t("dustTooltipTitle")}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-on-surface-variant">
                      {t("dustTooltipExplanation", {
                        bondPrice: formattedBondPrice,
                        symbol: tokenSymbol,
                      })}
                    </p>
                  </div>
                }
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {capability.canExecute ? (
            <button
              onClick={onClaim}
              className="shrink-0 rounded-xl bg-amber-500/90 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 cursor-pointer"
            >
              {t("claimNow")}
            </button>
          ) : (
            <InteractiveTooltip
              ariaLabel={t("frozenTooltip")}
              align="right"
              side="top"
              triggerClassName="inline-flex"
              panelClassName="w-72 sm:w-80 border-amber-500/30 bg-[#0F111A]/95 p-3.5 backdrop-blur-xl"
              content={
                <p className="text-xs leading-relaxed text-amber-200">
                  {t("frozenTooltip")}
                </p>
              }
            >
              <span
                aria-disabled="true"
                className="shrink-0 rounded-xl bg-amber-500/30 px-5 py-2 text-sm font-semibold text-amber-200/60 cursor-not-allowed opacity-75 border border-amber-500/20 transition inline-flex items-center justify-center"
              >
                {t(capability.buttonLabelKey)}
              </span>
            </InteractiveTooltip>
          )}
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded-lg p-1.5 text-amber-300/60 transition hover:bg-amber-500/10 hover:text-amber-300 cursor-pointer"
            aria-label={t("dismiss")}
          >
            <svg
              width="16"
              height="16"
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
      </div>
    </div>
  );
}
