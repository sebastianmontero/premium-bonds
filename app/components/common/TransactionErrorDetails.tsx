"use client";

import React, { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  ParsedTransactionError,
  getErrorCategoryTheme,
  getExplorerUrl,
  truncateSignature,
} from "@/app/lib/errors";

interface TransactionErrorDetailsProps {
  error: ParsedTransactionError;
  txSignature?: string | null;
  showTitle?: boolean;
  showExplorerLink?: boolean;
  className?: string;
}

export function TransactionErrorDetails({
  error,
  txSignature,
  showTitle = false,
  showExplorerLink = true,
  className = "",
}: TransactionErrorDetailsProps) {
  const t = useTranslations("Modals");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  const theme = getErrorCategoryTheme(error.category);

  const handleCopy = () => {
    const details = [
      error.title ? `Title: ${error.title}` : "",
      `Message: ${error.message}`,
      error.code !== undefined ? `Code: ${error.code}` : "",
      error.layer ? `Layer: ${error.layer}` : "",
      txSignature ? `Signature: ${txSignature}` : "",
      error.logs?.length ? `Logs:\n${error.logs.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    if (details) {
      navigator.clipboard.writeText(details);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Optional Title (used in SolanaErrorAlert; hidden in TransactionProgressModal which renders its own header) */}
      {showTitle && (
        <h4 className={`font-semibold text-sm ${theme.titleColor}`}>
          {error.title || t("actionError")}
        </h4>
      )}

      {/* Description Message */}
      <p className="text-xs text-on-surface-variant leading-relaxed max-w-xs mx-auto">
        {error.message || t("defaultError")}
      </p>

      {/* Actionable Step Banner */}
      {error.actionableStep && (
        <p className="text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg py-1.5 px-3 max-w-xs mx-auto">
          👉 {error.actionableStep}
        </p>
      )}

      {/* Explorer link & Error Decoder Deep Link */}
      <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
        {showExplorerLink && txSignature && (
          <a
            href={getExplorerUrl(txSignature, "devnet", "solscan")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20"
          >
            {t("viewOnSolscan", {
              signature: truncateSignature(txSignature),
            })}
          </a>
        )}

        {error.code !== undefined && (
          <Link
            href={`/docs/4-troubleshooting/common-errors?code=${error.code}`}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline bg-surface-container-high px-3 py-1.5 rounded-lg border border-outline-variant/30"
          >
            <span>🛠️</span>
            <span>
              {locale === "es"
                ? "Diagnosticar en la documentación →"
                : "Diagnose in Docs →"}
            </span>
          </Link>
        )}
      </div>

      {/* Copy debug and technical logs button */}
      <div className="flex items-center justify-center gap-3 text-[11px] text-on-surface-variant pt-1 max-w-xs mx-auto">
        {error.logs && error.logs.length > 0 && (
          <button
            type="button"
            onClick={() => setShowLogs(!showLogs)}
            className="underline font-mono opacity-80 hover:opacity-100 transition cursor-pointer"
          >
            {showLogs ? t("hideTechnicalLogs") : t("viewTechnicalLogs")}
          </button>
        )}
        <button
          type="button"
          onClick={handleCopy}
          className="opacity-80 hover:opacity-100 transition cursor-pointer font-mono flex items-center gap-1"
        >
          {copied ? t("copiedDebug") : t("copyDebug")}
        </button>
      </div>

      {/* Execution logs expanded drawer */}
      {showLogs && error.logs && error.logs.length > 0 && (
        <div className="w-full p-2.5 rounded-xl bg-black/50 font-mono text-[10px] space-y-1 max-h-36 overflow-y-auto text-on-surface-variant text-left break-all border border-white/10 shadow-inner">
          <p className="font-semibold text-on-surface border-b border-white/10 pb-1 mb-1">
            {t("executionLogsTitle")}
          </p>
          {error.logs.map((log, idx) => (
            <p key={idx} className="leading-tight">
              {log}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
