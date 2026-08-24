"use client";

import React from "react";
import {
  ParsedTransactionError,
  TransactionError,
  parseTransactionError,
  getErrorCategoryTheme,
} from "../lib/errors";
import { TransactionErrorDetails } from "@/app/components/common/TransactionErrorDetails";

interface SolanaErrorAlertProps {
  error: ParsedTransactionError | TransactionError | Error | string | null;
  onDismiss?: () => void;
  onRetry?: () => void;
  className?: string;
  variant?: "inline";
}

export const SolanaErrorAlert: React.FC<SolanaErrorAlertProps> = ({
  error,
  onDismiss,
  onRetry,
  className = "",
}) => {
  const parsed: ParsedTransactionError | null = error
    ? parseTransactionError(error)
    : null;

  if (!parsed) return null;

  // 1. Cancellation: Quiet, polite neutral slate presentation
  if (parsed.isCancellation) {
    return (
      <div
        className={`group relative overflow-hidden rounded-xl bg-surface-container-highest/95 backdrop-blur-xl border border-surface-bright/50 border-l-4 border-l-surface-variant p-3.5 text-xs text-on-surface flex flex-col gap-2.5 animate-fade-in shadow-ambient ${className}`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              aria-hidden="true"
              className="bg-white/5 text-on-surface-variant border border-white/10 p-2 rounded-xl shrink-0 flex items-center justify-center shadow-inner"
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
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </div>
            <div className="space-y-0.5">
              <h4 className="font-semibold text-xs text-on-surface">
                Transaction Cancelled
              </h4>
              <p className="text-on-surface-variant text-xs leading-relaxed">
                {parsed.message ||
                  "You cancelled the transaction request in your wallet."}
              </p>
            </div>
          </div>

          {onDismiss && (
            <button
              type="button"
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
      </div>
    );
  }

  // 2. Determine Styling based on Error Category Theme
  const theme = getErrorCategoryTheme(parsed.category);

  return (
    <div
      role="alert"
      className={`rounded-xl border border-l-4 p-4 text-xs flex flex-col gap-2.5 animate-fade-in backdrop-blur-md bg-surface-container-highest/95 text-on-surface ${theme.borderColor} ${theme.accentBorder} ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <div
            aria-hidden="true"
            className={`${theme.bgBadgeColor} ${theme.borderColor} border p-2 rounded-xl shrink-0 flex items-center justify-center shadow-inner text-base`}
          >
            {theme.icon}
          </div>
          <div className="flex-1 min-w-0">
            <TransactionErrorDetails
              error={parsed}
              showTitle={true}
              showExplorerLink={false}
            />
          </div>
        </div>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label="Dismiss alert"
            className="p-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-white/10 transition cursor-pointer shrink-0"
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

      {onRetry && (
        <div className="flex justify-end pt-1 border-t border-white/10">
          <button
            type="button"
            onClick={onRetry}
            className="px-3 py-1.5 rounded-lg bg-surface-container-highest/80 hover:bg-surface-container-highest text-on-surface font-semibold text-xs transition cursor-pointer shadow-sm border border-white/10"
          >
            🔄 Retry Transaction
          </button>
        </div>
      )}
    </div>
  );
};
