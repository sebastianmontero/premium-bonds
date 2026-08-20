"use client";

import { useState, useRef, useEffect } from "react";
import { formatTokenAmount } from "@/app/lib/formatters";
import { useTranslations } from "next-intl";

interface UnclaimedBannerProps {
  totalUnclaimed: number; // base units
  tokenSymbol: string;
  tokenDecimals: number;
  bondPrice: number; // base units
  onClaim: () => void;
}

export function UnclaimedBanner({
  totalUnclaimed,
  tokenSymbol,
  tokenDecimals,
  bondPrice,
  onClaim,
}: UnclaimedBannerProps) {
  const [dismissed, setDismissed] = useState(false);
  const [isTooltipOpen, setIsTooltipOpen] = useState(false);
  const tooltipContainerRef = useRef<HTMLDivElement>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations("Unclaimed");

  // Handle outside clicks and Escape key with focus restoration
  useEffect(() => {
    if (!isTooltipOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        tooltipContainerRef.current &&
        !tooltipContainerRef.current.contains(event.target as Node)
      ) {
        setIsTooltipOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsTooltipOpen(false);
        triggerButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isTooltipOpen]);

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

      <div className="relative flex items-center justify-between gap-4">
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
            <p className="text-sm font-semibold text-amber-200">{t("title")}</p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-amber-200/70">
              <span className="font-mono font-semibold text-amber-300">
                {formatTokenAmount(totalUnclaimed, tokenDecimals)} {tokenSymbol}
              </span>
              <span>{t("description")}</span>

              {/* Dust info tooltip trigger & popover */}
              <div
                ref={tooltipContainerRef}
                className="relative inline-flex items-center"
                onMouseEnter={() => setIsTooltipOpen(true)}
                onMouseLeave={() => setIsTooltipOpen(false)}
              >
                <button
                  ref={triggerButtonRef}
                  type="button"
                  onClick={() => setIsTooltipOpen((prev) => !prev)}
                  className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-amber-300/80 hover:text-amber-200 focus:outline-none focus:ring-2 focus:ring-amber-400/50 cursor-help transition-colors"
                  aria-label={t("dustTooltipTrigger")}
                  aria-expanded={isTooltipOpen}
                  aria-haspopup="dialog"
                >
                  <svg
                    className="h-3.5 w-3.5 shrink-0"
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
                </button>

                {/* Floating Tooltip Popover */}
                {isTooltipOpen && (
                  <div
                    role="tooltip"
                    className="absolute top-full left-0 mt-2.5 w-72 sm:w-80 max-w-[calc(100vw-3rem)] rounded-xl border border-amber-500/30 bg-[#0F111A]/95 p-3.5 text-left text-xs font-normal text-on-surface shadow-2xl backdrop-blur-xl z-50 animate-in fade-in zoom-in-95 duration-150"
                  >
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
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onClaim}
            className="shrink-0 rounded-xl bg-amber-500/90 px-5 py-2 text-sm font-semibold text-black transition hover:bg-amber-400 cursor-pointer"
          >
            {t("claimNow")}
          </button>
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
