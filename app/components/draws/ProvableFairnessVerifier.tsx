"use client";

import React, { useState } from "react";
import { VrfSeedBadge } from "@/app/components/common/VrfSeedBadge";
import { AccountExplorerLink } from "@/app/components/common/AccountExplorerLink";
import type { DetailedDrawCycle } from "@/app/types";
import { useTranslations } from "next-intl";

interface ProvableFairnessVerifierProps {
  draw: DetailedDrawCycle;
}

export function ProvableFairnessVerifier({
  draw,
}: ProvableFairnessVerifierProps) {
  const [copiedFormula, setCopiedFormula] = useState(false);
  const t = useTranslations("DrawInspector");

  const formulaText = `u64::from_le_bytes(SHA-256(seed || tier_idx || slot_in_tier || cycle_id)[0..8]) % ${draw.lockedTicketCount}`;

  const handleCopyFormula = () => {
    navigator.clipboard.writeText(formulaText);
    setCopiedFormula(true);
    setTimeout(() => setCopiedFormula(false), 2000);
  };

  return (
    <div className="space-y-4 p-4 rounded-xl bg-surface-container/20 border border-surface-bright/10 text-xs">
      {/* Header & Description */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-md bg-tertiary/15 text-tertiary">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h4 className="font-display text-sm font-bold text-on-surface">
            {t("provableFairnessTitle")}
          </h4>
        </div>
        <p className="text-xs text-on-surface-variant leading-relaxed">
          {t("provableFairnessDesc")}
        </p>
      </div>

      {/* VRF Seed & Oracle Box */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* Full Hex Seed */}
        <div className="p-3 rounded-lg bg-[#08090E] border border-surface-bright/5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-on-surface-variant">
              {t("randomnessSeedLabel")}
            </span>
            <VrfSeedBadge
              seedHex={draw.vrfSeedHex}
              drawCycleId={draw.cycleId}
            />
          </div>
          <p className="font-mono text-[11px] text-on-surface break-all select-all">
            {draw.vrfSeedHex}
          </p>
        </div>

        {/* Oracle Account */}
        <div className="p-3 rounded-lg bg-[#08090E] border border-surface-bright/5 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-semibold text-on-surface-variant">
              {t("oracleAccountLabel")}
            </span>
            <span className="text-[10px] text-tertiary font-semibold">
              Switchboard On-Demand
            </span>
          </div>
          <div className="pt-1">
            <AccountExplorerLink
              address={draw.randomnessAccount}
              provider="solscan"
              cluster="devnet"
            />
          </div>
        </div>
      </div>

      {/* Mathematical Derivation Formula */}
      <div className="p-3 rounded-lg bg-[#08090E] border border-surface-bright/5 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase font-semibold text-on-surface-variant">
            {t("derivationFormulaLabel")}
          </span>
          <button
            onClick={handleCopyFormula}
            className="text-[10px] text-primary hover:underline cursor-pointer flex items-center gap-1"
          >
            {copiedFormula ? "Copied!" : "Copy Formula"}
          </button>
        </div>
        <pre className="text-[11px] font-mono text-tertiary-bright p-2 rounded-md bg-surface-container/30 overflow-x-auto">
          {formulaText}
        </pre>
        <p className="text-[10px] text-on-surface-variant/70 leading-normal">
          {t("derivationFormulaExplanation", {
            tickets: draw.lockedTicketCount.toLocaleString("en-US"),
          })}
        </p>
      </div>
    </div>
  );
}
