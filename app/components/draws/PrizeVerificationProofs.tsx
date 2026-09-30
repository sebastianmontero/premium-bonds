"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { getExplorerUrl } from "@/app/lib/errors";
import { truncateHash, truncateSignature } from "@/app/lib/formatters";
import { CopyButton } from "@/app/components/common/CopyButton";

export interface PrizeVerificationProofsProps {
  vrfSeed?: string | null;
  txSignature?: string | null;
  cluster?: "devnet" | "mainnet-beta" | "testnet" | "localnet";
  isVoided?: boolean;
}

interface ProofRowProps {
  label: string;
  value: string;
  displayValue: string;
  isPending?: boolean;
  isVoidedNotice?: boolean;
  explorerUrl?: string;
  explorerLabel?: string;
}

function ProofCompactRow({
  label,
  value,
  displayValue,
  isPending = false,
  isVoidedNotice = false,
  explorerUrl,
  explorerLabel = "Solscan",
}: ProofRowProps) {
  const t = useTranslations("PrizeDetails");
  const tCommon = useTranslations("Common");

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between p-2.5 rounded-xl border border-surface-bright/10 bg-surface-container-lowest/60 gap-1.5 sm:gap-3 min-w-0">
      <span className="text-[10px] font-semibold text-on-surface-variant uppercase tracking-wider shrink-0">
        {label}
      </span>

      <div className="flex items-center justify-between sm:justify-end gap-2 min-w-0 font-mono text-xs">
        <code
          title={value}
          className={`truncate min-w-0 font-bold ${
            isVoidedNotice
              ? "text-red-400"
              : isPending
                ? "text-on-surface-variant/60 italic"
                : "text-on-surface"
          }`}
        >
          {displayValue}
        </code>

        {!isPending && !isVoidedNotice && (
          <div className="flex items-center gap-1.5 shrink-0">
            <CopyButton
              text={value}
              ariaLabel={`${t("copy")} ${label}`}
              className="p-1 hover:text-primary transition cursor-pointer min-h-[32px] min-w-[32px] flex items-center justify-center"
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
                className="flex items-center gap-1 px-1.5 py-1 rounded-md text-[11px] font-semibold text-primary hover:bg-primary/10 transition cursor-pointer min-h-[32px]"
              >
                <span>{explorerLabel}</span>
                <svg
                  className="w-3 h-3 shrink-0"
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
              </a>
            )}
          </div>
        )}
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
    <div className="space-y-2 pt-1">
      <h4 className="text-xs font-semibold text-on-surface uppercase tracking-wider">
        {t("onChainProofs")}
      </h4>

      {/* VRF Seed */}
      {vrfSeed && (
        <ProofCompactRow
          label={t("vrfSeedLabel")}
          value={vrfSeed}
          displayValue={truncateHash(vrfSeed)}
        />
      )}

      {/* Transaction Signature / Settlement Proof */}
      {isVoided ? (
        <ProofCompactRow
          label={t("txSignatureLabel")}
          value={t("revokedPriorSettlement")}
          displayValue={t("revokedPriorSettlement")}
          isVoidedNotice={true}
        />
      ) : txSignature ? (
        <ProofCompactRow
          label={t("txSignatureLabel")}
          value={txSignature}
          displayValue={truncateSignature(txSignature)}
          explorerUrl={getExplorerUrl(txSignature, cluster, "solscan")}
          explorerLabel="Solscan"
        />
      ) : (
        <ProofCompactRow
          label={t("txSignatureLabel")}
          value={t("pendingSettlement")}
          displayValue={t("pendingSettlement")}
          isPending={true}
        />
      )}
    </div>
  );
}
