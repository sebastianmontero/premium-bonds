"use client";

import React, { useState, useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
import { getExplorerUrl } from "@/app/lib/errors";

export interface PrizeVerificationProofsProps {
  vrfSeed?: string | null;
  txSignature?: string | null;
  cluster?: "devnet" | "mainnet-beta" | "testnet" | "localnet";
  isVoided?: boolean;
}

interface ProofCodeCardProps {
  label: string;
  value: string;
  isPending?: boolean;
  isVoidedNotice?: boolean;
  explorerUrl?: string;
  explorerLabel?: string;
}

function ProofCodeCard({
  label,
  value,
  isPending = false,
  isVoidedNotice = false,
  explorerUrl,
  explorerLabel = "Solscan",
}: ProofCodeCardProps) {
  const t = useTranslations("PrizeDetails");
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isPending || isVoidedNotice) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-semibold uppercase tracking-wider">
        <span>{label}</span>
        {!isPending && !isVoidedNotice && (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              aria-label={copied ? t("copied") : `${t("copy")} ${label}`}
              className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
            >
              {copied ? (
                <>
                  <svg
                    className="w-3.5 h-3.5 text-emerald-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
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
                    aria-hidden="true"
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
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`View on ${explorerLabel} (opens in new tab)`}
                className="flex items-center gap-1 hover:text-primary transition cursor-pointer"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                  />
                </svg>
                <span>{explorerLabel}</span>
              </a>
            )}
          </div>
        )}
      </div>
      <div
        className={`rounded-xl border border-surface-bright/10 px-3 py-2 ${
          isVoidedNotice
            ? "bg-red-500/5 text-red-400/80"
            : isPending
              ? "bg-surface-container/30 text-on-surface-variant/60"
              : "bg-surface-container-lowest/80 text-on-surface"
        }`}
      >
        <code className="text-xs font-mono break-all select-all block">
          {value}
        </code>
      </div>
    </div>
  );
}

export function PrizeVerificationProofs({
  vrfSeed,
  txSignature,
  cluster = "devnet",
  isVoided = false,
}: PrizeVerificationProofsProps) {
  const t = useTranslations("PrizeDetails");

  if (!vrfSeed && !txSignature && !isVoided) return null;

  return (
    <div className="space-y-3 pt-1">
      <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider">
        {t("onChainProofs")}
      </h4>

      {/* VRF Seed */}
      {vrfSeed && <ProofCodeCard label={t("vrfSeedLabel")} value={vrfSeed} />}

      {/* Transaction Signature / Settlement Proof */}
      {isVoided ? (
        <ProofCodeCard
          label={t("txSignatureLabel")}
          value={t("revokedPriorSettlement")}
          isVoidedNotice={true}
        />
      ) : txSignature ? (
        <ProofCodeCard
          label={t("txSignatureLabel")}
          value={txSignature}
          explorerUrl={getExplorerUrl(txSignature, cluster, "solscan")}
          explorerLabel="Solscan"
        />
      ) : (
        <ProofCodeCard
          label={t("txSignatureLabel")}
          value={t("pendingSettlement")}
          isPending={true}
        />
      )}
    </div>
  );
}
