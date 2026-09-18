"use client";

import React from "react";
import { getExplorerUrl, truncateSignature } from "@/app/lib/errors";
import { CopyButton } from "@/app/components/common/CopyButton";
import { useTranslations } from "next-intl";

interface TxExplorerLinkProps {
  signature?: string;
  cluster?: "devnet" | "mainnet-beta" | "testnet" | "localnet";
  provider?: "solscan" | "solana-explorer";
  showCopy?: boolean;
  variant?: "badge" | "subtle" | "compact";
  className?: string;
}

export function TxExplorerLink({
  signature,
  cluster = "devnet",
  provider = "solscan",
  showCopy = true,
  variant = "badge",
  className = "",
}: TxExplorerLinkProps) {
  const t = useTranslations("Common.explorer");

  if (!signature) return null;

  const url = getExplorerUrl(signature, cluster, provider);
  const truncated = truncateSignature(signature);
  const providerName = provider === "solscan" ? "Solscan" : "Solana Explorer";

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={t("viewTxOnExplorer", { signature, provider: providerName })}
        className="inline-flex items-center gap-1 font-mono text-[11px] text-primary/80 hover:text-primary transition hover:underline bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded border border-primary/15 shrink-0"
      >
        <span>{variant === "compact" ? "Tx ↗" : `${truncated} ↗`}</span>
      </a>

      {showCopy && (
        <CopyButton
          text={signature}
          ariaLabel={t("copyTxSignature")}
          title={t("copyTxSignature")}
          className="p-0.5 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-bright/10 transition cursor-pointer text-[10px] shrink-0 inline-flex items-center"
          iconClassName="w-3 h-3"
        />
      )}
    </div>
  );
}
