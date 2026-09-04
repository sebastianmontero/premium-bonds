"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";

interface PoolStateUninitializedCardProps {
  poolId?: number;
  onRetry?: () => void;
}

export function PoolStateUninitializedCard({
  poolId = 1,
  onRetry,
}: PoolStateUninitializedCardProps) {
  const t = useTranslations("Pools");
  const [isChecking, setIsChecking] = useState(false);

  const handleCheck = async () => {
    if (!onRetry || isChecking) return;
    setIsChecking(true);
    try {
      await onRetry();
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div
      role="status"
      className="card border-warning/30 bg-warning/5 p-6 rounded-2xl shadow-sm space-y-4"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning/15 text-warning border border-warning/20">
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
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-base font-bold text-on-surface">
            {t("poolUninitializedTitle", { poolId })}
          </h3>
          <p className="text-sm text-on-surface-variant mt-1 leading-relaxed">
            {t("poolUninitializedDesc")}
          </p>
        </div>
      </div>

      {onRetry && (
        <div className="pt-1 flex items-center gap-3">
          <button
            type="button"
            onClick={handleCheck}
            disabled={isChecking}
            aria-busy={isChecking}
            className="btn btn-secondary min-h-[40px] px-4 py-2 text-sm font-semibold rounded-xl inline-flex items-center gap-2 transition"
          >
            {isChecking && (
              <svg
                className="animate-spin h-4 w-4 text-secondary"
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
            <span>{t("checkAgain")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
