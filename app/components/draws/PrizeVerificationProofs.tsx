"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { getExplorerUrl } from "@/app/lib/errors";
import { CopyButton } from "@/app/components/common/CopyButton";

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
  const tCommon = useTranslations("Common");

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[10px] text-on-surface-variant font-semibold uppercase tracking-wider">
        <span>{label}</span>
        {!isPending && !isVoidedNotice && (
          <div className="flex items-center gap-3">
            <CopyButton
              text={value}
              label={t("copy")}
              copiedLabel={t("copied")}
              ariaLabel={`${t("copy")} ${label}`}
              className="flex items-center gap-1 hover:text-primary transition cursor-pointer text-[10px]"
              iconClassName="w-3.5 h-3.5"
            />
            {explorerUrl && (
              <a
                href={explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={tCommon("explorer.viewOnExplorerGeneric", {
                  provider: explorerLabel,
                })}
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
