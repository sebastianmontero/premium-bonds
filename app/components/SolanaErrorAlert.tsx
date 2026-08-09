"use client";

import React, { useEffect, useState } from "react";
import { ParsedTransactionError, parseTransactionError } from "../lib/errors";

interface SolanaErrorAlertProps {
  error: ParsedTransactionError | string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
  variant?: "inline" | "toast";
}

export const SolanaErrorAlert: React.FC<SolanaErrorAlertProps> = ({
  error,
  onDismiss,
  onRetry,
  className = "",
  variant = "inline",
}) => {
  const [copied, setCopied] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  const parsed: ParsedTransactionError | null = error
    ? typeof error === "string"
      ? parseTransactionError(error)
      : error
    : null;

  // Auto-dismiss cancellations after 4 seconds when in toast mode (pauses on hover)
  useEffect(() => {
    if (
      variant === "toast" &&
      parsed?.isCancellation &&
      onDismiss &&
      !isPaused
    ) {
      const timer = setTimeout(() => {
        onDismiss();
      }, 4000);
      return () => clearTimeout(timer);
    }
  }, [variant, error, parsed?.isCancellation, onDismiss, isPaused]);

  // Keyboard Escape key listener for toast dismissal
  useEffect(() => {
    if (variant === "toast" && onDismiss) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") onDismiss();
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [variant, onDismiss]);

  if (!parsed) return null;

  // 1. Cancellation: High contrast, warm amber status presentation
  if (parsed.isCancellation) {
    const cancelContent = (
      <div
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
        className={`group relative overflow-hidden rounded-xl bg-surface-container-highest/95 backdrop-blur-xl border border-amber-500/40 border-l-4 border-l-amber-400 p-3.5 text-xs text-on-surface flex flex-col gap-2.5 animate-fade-in shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_24px_rgba(245,158,11,0.18)] ${className}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className="bg-amber-500/20 text-amber-300 border border-amber-500/35 p-2 rounded-xl shrink-0 flex items-center justify-center shadow-inner"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <div className="space-y-0.5">
              <h4 className="font-semibold text-xs text-amber-300">
                Transaction Canceled
              </h4>
              <p className="text-on-surface/90 text-xs leading-relaxed">
                {parsed.message ||
                  "You cancelled the transaction request in your wallet."}
              </p>
            </div>
          </div>

          {onDismiss && (
            <button
              onClick={onDismiss}
              aria-label="Dismiss alert"
              className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition cursor-pointer"
              title="Dismiss"
            >
              <span
                aria-hidden="true"
                className="text-base font-bold leading-none"
              >
                &times;
              </span>
            </button>
          )}
        </div>

        {variant === "toast" && (
          <div
            aria-hidden="true"
            className="w-full bg-amber-500/20 h-1 rounded-full overflow-hidden mt-0.5"
          >
            <div
              className={`bg-amber-400 h-full animate-toast-progress ${
                isPaused ? "[animation-play-state:paused]" : ""
              }`}
            />
          </div>
        )}
      </div>
    );

    if (variant === "toast") {
      return (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md sm:w-full z-[110] animate-slide-up pointer-events-auto"
        >
          {cancelContent}
        </div>
      );
    }

    return cancelContent;
  }

  // 2. Determine Styling based on Error Category
  const isToast = variant === "toast";

  let containerStyles = isToast
    ? "bg-surface-container-highest/95 backdrop-blur-xl border border-error/40 border-l-4 border-l-error text-on-surface shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_24px_rgba(239,68,68,0.18)]"
    : "bg-error/15 border-error/30 text-error";
  let icon = "⚠️";
  let titleColor = isToast ? "text-red-400" : "text-error";
  let iconBadgeBg = "bg-error/20 text-red-300 border-error/35";

  if (parsed.category === "insufficient_sol") {
    containerStyles = isToast
      ? "bg-surface-container-highest/95 backdrop-blur-xl border border-amber-500/40 border-l-4 border-l-amber-400 text-on-surface shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_24px_rgba(245,158,11,0.18)]"
      : "bg-amber-500/15 border-amber-500/30 text-amber-300";
    icon = "⛽";
    titleColor = "text-amber-300";
    iconBadgeBg = "bg-amber-500/20 text-amber-300 border-amber-500/35";
  } else if (parsed.category === "blockhash_expired") {
    containerStyles = isToast
      ? "bg-surface-container-highest/95 backdrop-blur-xl border border-sky-500/40 border-l-4 border-l-sky-400 text-on-surface shadow-[0_12px_40px_rgba(0,0,0,0.6),0_0_24px_rgba(14,165,233,0.18)]"
      : "bg-sky-500/15 border-sky-500/30 text-sky-300";
    icon = "⏱️";
    titleColor = "text-sky-300";
    iconBadgeBg = "bg-sky-500/20 text-sky-300 border-sky-500/35";
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

  const alertContent = (
    <div
      className={`rounded-xl border p-4 text-xs flex flex-col gap-2.5 animate-fade-in backdrop-blur-md ${containerStyles} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          {isToast ? (
            <div
              aria-hidden="true"
              className={`${iconBadgeBg} border p-2 rounded-xl shrink-0 flex items-center justify-center shadow-inner text-base`}
            >
              {icon}
            </div>
          ) : (
            <span className="text-base shrink-0 mt-0.5">{icon}</span>
          )}
          <div className="space-y-1">
            <h4 className={`font-semibold text-sm ${titleColor}`}>
              {parsed.title || "Transaction Error"}
            </h4>
            <p
              className={
                isToast
                  ? "text-on-surface/90 text-xs leading-relaxed"
                  : "leading-relaxed opacity-95"
              }
            >
              {parsed.message}
            </p>
            {parsed.actionableStep && (
              <p
                className={
                  isToast
                    ? "text-xs font-medium mt-1 text-on-surface opacity-95 flex items-center gap-1"
                    : "text-[11px] font-medium mt-1 text-on-surface opacity-90 flex items-center gap-1"
                }
              >
                <span>👉</span> {parsed.actionableStep}
              </p>
            )}
          </div>
        </div>

        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss alert"
            className={
              isToast
                ? "p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition cursor-pointer"
                : "opacity-70 hover:opacity-100 transition cursor-pointer text-base font-bold px-1"
            }
            title="Dismiss"
          >
            <span
              aria-hidden="true"
              className={isToast ? "text-base font-bold leading-none" : ""}
            >
              &times;
            </span>
          </button>
        )}
      </div>

      {/* Logs / Action Buttons */}
      <div
        className={`flex items-center justify-between pt-1 border-t text-[11px] ${isToast ? "border-white/10 text-on-surface-variant" : "border-current/15"}`}
      >
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
            className="px-3 py-1 rounded-lg bg-surface-container-highest/80 hover:bg-surface-container-highest text-on-surface font-semibold text-xs transition cursor-pointer shadow-sm border border-white/10"
          >
            🔄 Retry Transaction
          </button>
        )}
      </div>

      {/* Expandable Technical Logs */}
      {showLogs && parsed.logs && parsed.logs.length > 0 && (
        <div className="mt-1 p-2.5 rounded-lg bg-black/40 font-mono text-[10px] space-y-1 max-h-36 overflow-y-auto text-on-surface-variant break-all border border-white/5">
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

  if (variant === "toast") {
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:bottom-6 sm:max-w-md sm:w-full z-[110] shadow-2xl animate-slide-up pointer-events-auto"
      >
        {alertContent}
      </div>
    );
  }

  return alertContent;
};
