"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

interface VrfSeedBadgeProps {
  seedHex?: string;
  drawCycleId?: number;
  className?: string;
  label?: string;
  variant?: "default" | "compact";
  tooltipPlacement?: "top" | "bottom";
  tooltipAlign?: "left" | "center" | "right";
}

export function VrfSeedBadge({
  seedHex,
  drawCycleId,
  className = "",
  label,
  variant = "default",
  tooltipPlacement = "bottom",
  tooltipAlign = "center",
}: VrfSeedBadgeProps) {
  const [copied, setCopied] = useState(false);
  const t = useTranslations("Ledger");

  if (!seedHex || /^(?:0x)?0+$/i.test(seedHex.trim())) return null;

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    navigator.clipboard.writeText(seedHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const truncated = `${seedHex.slice(0, 8)}...${seedHex.slice(-6)}`;
  const displayLabel =
    label || (variant === "compact" ? t("compactVrfLabel") : truncated);

  const placementClass =
    tooltipPlacement === "top" ? "bottom-full mb-2" : "top-full mt-2";

  const alignClass =
    tooltipAlign === "left"
      ? "left-0"
      : tooltipAlign === "right"
        ? "right-0"
        : "left-1/2 -translate-x-1/2";

  return (
    <button
      type="button"
      data-prevent-row-click="true"
      onClick={handleCopy}
      aria-label={`Copy VRF Randomness Seed ${seedHex}`}
      title={t("copyVrfTitle")}
      className={`inline-flex items-center gap-1.5 text-[10px] leading-tight font-mono text-on-surface-variant/60 hover:text-primary hover:border-primary/30 bg-surface-container/50 hover:bg-surface-container/80 border border-surface-bright/10 px-2 py-0.5 rounded-lg transition-all duration-200 relative group/vrf cursor-pointer select-none shrink-0 align-middle focus-visible:ring-1 focus-visible:ring-primary outline-none hover:z-50 focus-within:z-50 ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="w-3 h-3 text-tertiary animate-pulse shrink-0 my-auto"
      >
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>

      <span className="leading-none tracking-tight">{displayLabel}</span>

      {/* Floating Tooltip */}
      <div
        className={`absolute ${placementClass} ${alignClass} w-52 max-w-[calc(100vw-32px)] p-2.5 rounded-xl bg-[#0F111A] border border-surface-bright/15 text-on-surface text-[10px] leading-normal font-sans font-normal opacity-0 pointer-events-none group-hover/vrf:opacity-100 group-focus-within/vrf:opacity-100 transition-opacity duration-200 shadow-2xl z-50 text-center whitespace-normal`}
      >
        {copied ? (
          <span className="text-emerald-400 font-semibold flex items-center justify-center gap-1.5">
            <svg
              className="w-3.5 h-3.5 text-emerald-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M5 13l4 4L19 7"
              />
            </svg>
            {t("vrfSeedCopied")}
          </span>
        ) : (
          <span>
            <strong className="text-primary block mb-0.5 font-semibold">
              {t("vrfRandomnessSeed")} {drawCycleId ? `#${drawCycleId}` : ""}
            </strong>
            {t("vrfHelp")}
          </span>
        )}
      </div>
    </button>
  );
}
