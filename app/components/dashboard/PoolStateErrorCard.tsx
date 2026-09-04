"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

interface PoolStateErrorCardProps {
  error?: string | null;
  onRetry?: () => void;
}

export function PoolStateErrorCard({ error, onRetry }: PoolStateErrorCardProps) {
  const t = useTranslations("Pools");
  const [isRetrying, setIsRetrying] = useState(false);

  const handleRetry = async () => {
    if (!onRetry || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="card border-error/30 bg-error/5 p-6 rounded-2xl shadow-sm space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-error/15 text-error border border-error/20">
          <svg
            className="h-5 w-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-on-surface">
            {t("poolLoadErrorTitle")}
          </h3>
          <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
            {t("poolLoadErrorDesc")}
          </p>
        </div>
      </div>

      {error && (
        <details className="text-xs text-on-surface-variant border border-outline-variant/10 rounded-xl bg-surface-container-lowest/60 overflow-hidden">
          <summary className="cursor-pointer px-3 py-2 font-medium hover:text-on-surface transition select-none flex items-center justify-between">
            <span>Diagnostic Details</span>
            <span className="text-[10px] opacity-70">Expand ▾</span>
          </summary>
          <pre className="p-3 text-[11px] font-mono text-error/90 whitespace-pre-wrap break-all border-t border-outline-variant/10 bg-surface-container-lowest">
            {error}
          </pre>
        </details>
      )}

      {onRetry && (
        <div className="pt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={handleRetry}
            disabled={isRetrying}
            aria-busy={isRetrying}
            className="btn btn-primary min-h-[40px] px-4 py-2 text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition"
          >
            {isRetrying && (
              <svg
                className="animate-spin h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
            )}
            <span>{t("retry")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
