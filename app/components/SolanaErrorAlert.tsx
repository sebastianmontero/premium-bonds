"use client";

import React, { useState } from "react";
import { ParsedTransactionError, parseTransactionError } from "../lib/errors";

interface SolanaErrorAlertProps {
  error: ParsedTransactionError | string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
}

export const SolanaErrorAlert: React.FC<SolanaErrorAlertProps> = ({
  error,
  onDismiss,
  onRetry,
  className = "",
}) => {
  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);

  if (!error) return null;

  const parsed: ParsedTransactionError =
    typeof error === "string" ? parseTransactionError(error) : error;

  // 1. Cancellation: Neutral, soft presentation
  if (parsed.isCancellation) {
    return (
      <div
        className={`rounded-xl bg-surface-container/70 border border-outline-variant/30 p-3 text-xs text-on-surface-variant flex items-center justify-between gap-3 animate-fade-in ${className}`}
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">ℹ️</span>
          <span>{parsed.message || "Transaction cancelled by user."}</span>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="text-on-surface-variant/70 hover:text-on-surface transition text-sm px-1 cursor-pointer font-bold"
            title="Dismiss"
          >
            &times;
          </button>
        )}
      </div>
    );
  }

  // 2. Determine Styling based on Error Category
  let containerStyles = "bg-error/15 border-error/30 text-error";
  let icon = "⚠️";
  let titleColor = "text-error";

  if (parsed.category === "insufficient_sol") {
    containerStyles = "bg-amber-500/15 border-amber-500/30 text-amber-300";
    icon = "⛽";
    titleColor = "text-amber-400";
  } else if (parsed.category === "blockhash_expired") {
    containerStyles = "bg-sky-500/15 border-sky-500/30 text-sky-300";
    icon = "⏱️";
    titleColor = "text-sky-400";
  }

  const handleCopy = () => {
    const details = [
      `Title: ${parsed.title}`,
      `Message: ${parsed.message}`,
      parsed.code ? `Code: ${parsed.code}` : "",
      parsed.layer ? `Layer: ${parsed.layer}` : "",
      parsed.logs?.length ? `Logs:\n${parsed.logs.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    navigator.clipboard.writeText(details);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className={`rounded-xl border p-4 text-xs flex flex-col gap-2.5 animate-fade-in ${containerStyles} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <span className="text-base shrink-0 mt-0.5">{icon}</span>
          <div className="space-y-1">
            <h4 className={`font-semibold text-sm ${titleColor}`}>
              {parsed.title || "Transaction Error"}
            </h4>
            <p className="leading-relaxed opacity-95">{parsed.message}</p>
            {parsed.actionableStep && (
              <p className="text-[11px] font-medium mt-1 text-on-surface opacity-90 flex items-center gap-1">
                <span>👉</span> {parsed.actionableStep}
              </p>
            )}
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            className="opacity-70 hover:opacity-100 transition cursor-pointer text-base font-bold px-1"
            title="Dismiss"
          >
            &times;
          </button>
        )}
      </div>

      {/* Logs / Action Buttons */}
      <div className="flex items-center justify-between pt-1 border-t border-current/15 text-[11px]">
        <div className="flex items-center gap-3">
          {parsed.logs && parsed.logs.length > 0 && (
            <button
              onClick={() => setShowLogs(!showLogs)}
              className="underline font-mono opacity-80 hover:opacity-100 transition cursor-pointer"
            >
              {showLogs ? "Hide Technical Logs" : "View Technical Logs"}
            </button>
          )}
          <button
            onClick={handleCopy}
            className="opacity-80 hover:opacity-100 transition cursor-pointer font-mono flex items-center gap-1"
          >
            {copied ? "✓ Copied!" : "📋 Copy Debug Info"}
          </button>
        </div>

        {onRetry && (
          <button
            onClick={onRetry}
            className="px-3 py-1 rounded-lg bg-surface-container-highest/80 hover:bg-surface-container-highest text-on-surface font-semibold text-xs transition cursor-pointer shadow-sm"
          >
            🔄 Retry Transaction
          </button>
        )}
      </div>

      {/* Expandable Technical Logs */}
      {showLogs && parsed.logs && parsed.logs.length > 0 && (
        <div className="mt-1 p-2.5 rounded-lg bg-black/40 font-mono text-[10px] space-y-1 max-h-36 overflow-y-auto text-on-surface-variant break-all">
          <p className="font-semibold text-on-surface border-b border-white/10 pb-1 mb-1">
            Solana Execution Logs:
          </p>
          {parsed.logs.map((log, idx) => (
            <p key={idx} className="leading-tight">
              {log}
            </p>
          ))}
        </div>
      )}
    </div>
  );
};
