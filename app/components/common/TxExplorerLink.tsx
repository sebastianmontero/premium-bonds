"use client";

import React, { useState } from "react";
import { getExplorerUrl, truncateSignature } from "@/app/lib/errors";

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
  const [copied, setCopied] = useState(false);

  if (!signature) return null;

  const url = getExplorerUrl(signature, cluster, provider);
  const truncated = truncateSignature(signature);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(signature);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback if clipboard API fails
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-1.5 ${className}`}
      onClick={(e) => e.stopPropagation()}
    >
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        title={`View tx ${signature} on ${provider === "solscan" ? "Solscan" : "Solana Explorer"}`}
        className="inline-flex items-center gap-1 font-mono text-[11px] text-primary/80 hover:text-primary transition hover:underline bg-primary/5 hover:bg-primary/10 px-2 py-0.5 rounded border border-primary/15 shrink-0"
      >
        <span>{variant === "compact" ? "Tx ↗" : `${truncated} ↗`}</span>
      </a>

      {showCopy && (
        <button
          type="button"
          onClick={handleCopy}
          title="Copy transaction signature"
          className="p-0.5 rounded text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-bright/10 transition cursor-pointer text-[10px]"
        >
          {copied ? (
            <span className="text-tertiary font-medium">✓</span>
          ) : (
            <svg
              className="w-3 h-3"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
              />
            </svg>
          )}
        </button>
      )}
    </div>
  );
}
