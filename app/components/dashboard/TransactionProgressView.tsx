"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ParsedTransactionError,
  getErrorCategoryTheme,
  getExplorerUrl,
  truncateSignature,
} from "@/app/lib/errors";
import { TransactionErrorDetails } from "@/app/components/common/TransactionErrorDetails";
import { TransactionStage } from "./TransactionProgressModal";

export interface TransactionProgressViewProps {
  stage: TransactionStage;
  title?: string;
  showHeading?: boolean;
  customSuccessMessage?: string;
  error?: ParsedTransactionError | null;
  txSignature?: string | null;
  onRetry?: () => void;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
}

export function TransactionProgressView({
  stage,
  title,
  showHeading = true,
  customSuccessMessage,
  error,
  txSignature,
  onRetry,
  onClose,
  onBack,
  backLabel,
}: TransactionProgressViewProps) {
  const t = useTranslations("Modals");
  const [isRetrying, setIsRetrying] = useState(false);
  const theme = getErrorCategoryTheme(error?.category);

  if (stage === null) return null;

  const handleRetryClick = async () => {
    if (!onRetry || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const steps: { stage: TransactionStage; label: string }[] = [
    { stage: "signing", label: t("stepSigning") },
    { stage: "broadcasting", label: t("stepBroadcasting") },
    { stage: "confirming", label: t("stepConfirming") },
  ];

  return (
    <div
      className="w-full text-center space-y-5 py-2"
      role="status"
      aria-live="polite"
    >
      {/* Status Icon Animation */}
      <div className="relative flex items-center justify-center h-20 w-20 mx-auto">
        <div
          className={`absolute inset-0 rounded-full border-2 ${
            stage === "error" ? theme.ringBorder : "border-primary/20"
          } ${stage !== "success" && stage !== "error" ? "animate-ping opacity-75" : ""}`}
        />
        <div
          className={`absolute h-16 w-16 rounded-full flex items-center justify-center border shadow-inner ${
            stage === "error"
              ? `${theme.bgBadgeColor} ${theme.borderColor}`
              : "bg-gradient-to-br from-primary/10 to-secondary/10 border-primary/20"
          }`}
        >
          {stage === "preparing" && (
            <span className="text-2xl animate-pulse">⚙️</span>
          )}
          {stage === "signing" && (
            <span className="text-2xl animate-bounce">🪙</span>
          )}
          {stage === "broadcasting" && (
            <span className="text-2xl animate-pulse">📡</span>
          )}
          {stage === "confirming" && (
            <span className="text-2xl animate-spin">⛓️</span>
          )}
          {stage === "success" && (
            <span className="text-3xl text-tertiary">🎉</span>
          )}
          {stage === "error" && <span className="text-3xl">{theme.icon}</span>}
        </div>
      </div>

      {/* Stage Description */}
      <div className="space-y-1.5">
        {showHeading && (
          <h3
            className={`font-display text-lg sm:text-xl font-bold ${
              stage === "error" ? theme.titleColor : "text-on-surface"
            }`}
          >
            {stage === "preparing" && t("actionPreparing")}
            {stage === "signing" && (title || t("actionSigning"))}
            {stage === "broadcasting" && t("actionBroadcasting")}
            {stage === "confirming" && t("actionConfirming")}
            {stage === "success" && t("actionSuccess")}
            {stage === "error" && (error?.title || t("actionError"))}
          </h3>
        )}
        <p className="text-xs text-on-surface-variant max-w-sm mx-auto">
          {stage === "preparing" && t("preparingDesc")}
          {stage === "signing" && t("signingDesc")}
          {stage === "broadcasting" && t("broadcastingDesc")}
          {stage === "confirming" && t("confirmingDesc")}
          {stage === "success" && (customSuccessMessage || t("success"))}
          {stage === "error" && (error?.message || t("defaultError"))}
        </p>
      </div>

      {/* Multi-Step Progress Stepper (Visible during active flow) */}
      {stage !== "success" && stage !== "error" && stage !== "preparing" && (
        <div className="flex items-center justify-center gap-2 pt-1 pb-2">
          {steps.map((s, idx) => {
            const isCurrent = stage === s.stage;
            const isCompleted =
              (s.stage === "signing" &&
                (stage === "broadcasting" || stage === "confirming")) ||
              (s.stage === "broadcasting" && stage === "confirming");
            return (
              <React.Fragment key={s.stage}>
                <div className="flex items-center gap-1.5">
                  <div
                    className={`h-2 w-2 rounded-full transition-all ${
                      isCurrent
                        ? "bg-primary scale-125 ring-2 ring-primary/30"
                        : isCompleted
                          ? "bg-primary/70"
                          : "bg-surface-bright/40"
                    }`}
                  />
                  <span
                    className={`text-[11px] font-medium ${
                      isCurrent
                        ? "text-primary font-bold"
                        : isCompleted
                          ? "text-on-surface-variant"
                          : "text-on-surface-variant/40"
                    }`}
                  >
                    {s.label}
                  </span>
                </div>
                {idx < steps.length - 1 && (
                  <div
                    className={`h-[1px] w-6 transition-all ${
                      isCompleted ? "bg-primary/50" : "bg-surface-bright/20"
                    }`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </div>
      )}

      {/* Error Details Accordion */}
      {stage === "error" && error && (
        <TransactionErrorDetails error={error} txSignature={txSignature} />
      )}

      {/* Explorer Link (Only on Success to prevent duplicate explorer link on error) */}
      {stage === "success" && txSignature && (
        <div className="text-xs">
          <a
            href={getExplorerUrl(txSignature)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline font-mono inline-flex items-center gap-1.5"
          >
            <span>
              {t("viewOnSolscan", {
                signature: truncateSignature(txSignature),
              })}
            </span>
            <svg
              className="w-3.5 h-3.5"
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
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex items-center gap-3 pt-2">
        {stage === "error" && onBack && (
          <button
            type="button"
            onClick={onBack}
            className="btn-ghost flex-1 rounded-xl py-3 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            {backLabel || t("editAmount")}
          </button>
        )}
        {stage === "error" && onRetry && (
          <button
            type="button"
            onClick={handleRetryClick}
            disabled={isRetrying}
            className="btn-gradient flex-1 rounded-xl py-3 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            {isRetrying ? t("retrying") : t("retryAction")}
          </button>
        )}
        {stage === "success" && (
          <button
            type="button"
            onClick={onClose}
            className="btn-gradient w-full rounded-xl py-3 text-xs sm:text-sm font-semibold cursor-pointer"
          >
            {t("close")}
          </button>
        )}
      </div>
    </div>
  );
}
