"use client";

import React from "react";
import { getAccountExplorerUrl, truncateAddress } from "@/app/lib/errors";
import { CopyButton } from "@/app/components/common/CopyButton";
import { useTranslations } from "next-intl";

interface AccountExplorerLinkProps {
  address?: string;
  label?: string;
  cluster?: "devnet" | "mainnet-beta" | "testnet" | "localnet";
  provider?: "solscan" | "solana-explorer";
  showCopy?: boolean;
  showExplorer?: boolean;
  className?: string;
}

export function AccountExplorerLink({
  address,
  label,
  cluster = "devnet",
  provider = "solscan",
  showCopy = true,
  showExplorer = true,
  className = "",
}: AccountExplorerLinkProps) {
  const t = useTranslations("Common.explorer");

  if (!address) return null;

  const url = getAccountExplorerUrl(address, cluster, provider);
  const displayLabel = label || truncateAddress(address);
  const providerName = provider === "solscan" ? "Solscan" : "Solana Explorer";

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      {showExplorer ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          title={t("viewAddressOnExplorer", {
            address,
            provider: providerName,
          })}
          className="inline-flex items-center gap-1 font-mono text-xs text-primary/80 hover:text-primary transition hover:underline bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded-md border border-primary/15 shrink-0"
        >
          <span>{displayLabel}</span>
          <svg
            className="w-3 h-3 text-primary/60"
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
        </a>
      ) : (
        <span className="font-mono text-xs text-on-surface-variant font-medium">
          {displayLabel}
        </span>
      )}

      {showCopy && (
        <CopyButton
          text={address}
          ariaLabel={t("copyAddress")}
          title={t("copyAddress")}
          className="p-1 rounded-md text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-bright/10 transition cursor-pointer text-xs shrink-0 inline-flex items-center"
          iconClassName="w-3 h-3"
        />
      )}
    </div>
  );
}
