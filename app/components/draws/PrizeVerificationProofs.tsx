"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import { getExplorerUrl } from "@/app/lib/errors";

export interface PrizeVerificationProofsProps {
  vrfSeed?: string | null;
  txSignature?: string | null;
  cluster?: "devnet" | "mainnet-beta" | "testnet" | "localnet";
}

export function PrizeVerificationProofs({
  vrfSeed,
  txSignature,
  cluster = "devnet",
}: PrizeVerificationProofsProps) {
  const t = useTranslations("PrizeDetails");
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!vrfSeed && !txSignature) return null;

  const handleCopy = async (
    e: React.MouseEvent,
    text: string,
    fieldName: string
  ) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="space-y-4 pt-2">
      <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider">
        {t("onChainProofs")}
      </h4>

      {/* VRF Seed */}
      {vrfSeed && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-semibold uppercase tracking-wider">
            <span>{t("vrfSeedLabel")}</span>
            <button
              type="button"
              onClick={(e) => handleCopy(e, vrfSeed, "vrf")}
              className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
            >
              {copiedField === "vrf" ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 text-emerald-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                  <span className="text-emerald-400">{t("copied")}</span>
                </>
              ) : (
                <>
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                    />
                  </svg>
                  <span>{t("copy")}</span>
                </>
              )}
            </button>
          </div>
          <div className="rounded-xl border border-surface-bright/5 bg-[#08090E] p-3">
            <code className="text-xs font-mono text-on-surface break-all select-all block">
              {vrfSeed}
            </code>
          </div>
        </div>
      )}

      {/* Transaction Signature */}
      {txSignature && (
        <div className="space-y-1">
          <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-semibold uppercase tracking-wider">
            <span>{t("txSignatureLabel")}</span>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={(e) => handleCopy(e, txSignature, "tx")}
                className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
              >
                {copiedField === "tx" ? (
                  <>
                    <svg
                      className="w-3.5 h-3.5 text-emerald-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    <span className="text-emerald-400">{t("copied")}</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                      />
                    </svg>
                    <span>{t("copy")}</span>
                  </>
                )}
              </button>
              <a
                href={getExplorerUrl(txSignature, cluster, "solscan")}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                <span>Solscan</span>
              </a>
            </div>
          </div>
          <div className="rounded-xl border border-surface-bright/5 bg-[#08090E] p-3">
            <code className="text-xs font-mono text-on-surface break-all select-all block">
              {txSignature}
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
