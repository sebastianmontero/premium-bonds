"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ParsedTransactionError,
  getErrorCategoryTheme,
  getExplorerUrl,
  truncateSignature,
} from "@/app/lib/errors";
import { TransactionErrorDetails } from "@/app/components/common/TransactionErrorDetails";

export type TransactionStage =
  | "preparing"
  | "signing"
  | "broadcasting"
  | "confirming"
  | "success"
  | "error"
  | null;

export function isInFlightStage(stage: TransactionStage): boolean {
  return (
    stage === "preparing" ||
    stage === "signing" ||
    stage === "broadcasting" ||
    stage === "confirming"
  );
}

export function isTerminalStage(stage: TransactionStage): boolean {
  return stage === "success" || stage === "error";
}

export interface TransactionProgressModalProps {
  isOpen: boolean;
  stage: TransactionStage;
  title?: string;
  customSuccessMessage?: string;
  error?: ParsedTransactionError | null;
  txSignature?: string | null;
  onRetry?: () => void;
  onClose: () => void;
  onBack?: () => void;
  backLabel?: string;
  isEmbedded?: boolean;
}

export function TransactionProgressModal({
  isOpen,
  stage,
  title,
  customSuccessMessage,
  error,
  txSignature,
  onRetry,
  onClose,
  onBack,
  backLabel,
  isEmbedded = false,
}: TransactionProgressModalProps) {
  const t = useTranslations("Modals");
  const [isRetrying, setIsRetrying] = useState(false);

  // Keyboard Escape key listener for terminal states
  useEffect(() => {
    if (!isOpen) return;
    const isTerminal = isTerminalStage(stage);
    if (!isTerminal) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (stage === "error" && onBack) {
          onBack();
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, stage, onClose, onBack]);

  if (!isOpen || stage === null) return null;

  const theme = getErrorCategoryTheme(error?.category);

  const handleRetryClick = async () => {
    if (!onRetry || isRetrying) return;
    setIsRetrying(true);
    try {
      await onRetry();
    } finally {
      setIsRetrying(false);
    }
  };

  const isTerminalState = isTerminalStage(stage);
  const ariaRole =
    stage === "error"
      ? error?.category === "blockhash_expired"
        ? "status"
        : "alertdialog"
      : "dialog";

  const modalContent = (
    <div
      role={ariaRole}
      aria-modal="true"
      aria-labelledby="tx-progress-title"
      aria-describedby="tx-progress-desc"
      aria-live={
        stage === "error"
          ? error?.category === "blockhash_expired"
            ? "polite"
            : "assertive"
          : "polite"
      }
      className="w-full max-w-md rounded-2xl glass-strong p-6 text-center space-y-5 shadow-ambient mx-4 animate-scale-in"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Pulsing/spinning loader container */}
      <div className="relative flex items-center justify-center h-24 w-24 mx-auto">
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
            <span className="text-2xl animate-spin duration-3000">⛓️</span>
          )}
          {stage === "success" && (
            <span className="text-3xl text-tertiary">🎉</span>
          )}
          {stage === "error" && <span className="text-3xl">{theme.icon}</span>}
        </div>
      </div>

      {/* Title and Description */}
      <div className="space-y-2">
        {/* Action context tag for error states */}
        {stage === "error" && title && (
          <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-white/5 border border-white/10 text-on-surface-variant max-w-xs truncate mx-auto mb-1">
            {t("actionPrefix", { title })}
          </div>
        )}

        <h3
          id="tx-progress-title"
          className={`font-display text-xl font-bold ${
            stage === "error" ? theme.titleColor : "text-on-surface"
          }`}
        >
          {stage === "preparing" && t("actionPreparing")}
          {stage === "signing" && (title ?? t("actionSigning"))}
          {stage === "broadcasting" && t("actionBroadcasting")}
          {stage === "confirming" && t("actionConfirming")}
          {stage === "success" && t("actionSuccess")}
          {stage === "error" && (error?.title ?? t("actionError"))}
        </h3>

        {stage !== "error" && (
          <p
            id="tx-progress-desc"
            className="text-xs text-on-surface-variant max-w-xs mx-auto px-4 leading-relaxed"
          >
            {stage === "preparing" && t("preparingDesc")}
            {stage === "signing" && t("signingDesc")}
            {stage === "broadcasting" && t("broadcastingDesc")}
            {stage === "confirming" && t("confirmingDesc")}
            {stage === "success" && (customSuccessMessage ?? t("success"))}
          </p>
        )}

        {/* Solscan Explorer link on success with txSignature */}
        {stage === "success" && txSignature && (
          <div className="pt-1">
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
          </div>
        )}

        {/* Unified Technical Error Details & Debug Controls on error */}
        {stage === "error" && (
          <div id="tx-progress-desc">
            {error ? (
              <TransactionErrorDetails
                error={error}
                txSignature={txSignature}
                showTitle={false}
              />
            ) : (
              <p className="text-xs text-on-surface-variant max-w-xs mx-auto px-4 leading-relaxed">
                {t("defaultError")}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Stepper indicators (hidden on error) */}
      {stage !== "error" && (
        <div className="flex items-center justify-center gap-2 pt-2">
          <StepDot
            active={stage === "preparing" || stage === "signing"}
            completed={stage !== "preparing" && stage !== "signing"}
          />
          <StepLine active={stage !== "preparing" && stage !== "signing"} />
          <StepDot
            active={stage === "broadcasting"}
            completed={
              stage !== "preparing" &&
              stage !== "signing" &&
              stage !== "broadcasting"
            }
          />
          <StepLine active={stage === "confirming" || stage === "success"} />
          <StepDot
            active={stage === "confirming"}
            completed={stage === "success"}
          />
        </div>
      )}

      {/* Action buttons on error */}
      {stage === "error" && (
        <div className="flex items-center gap-3 pt-2">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              className="flex-1 btn-gradient rounded-xl py-3 text-xs font-semibold cursor-pointer transition hover:opacity-90 shadow-sm"
            >
              {backLabel ?? t("editAmount")}
            </button>
          )}
          {onRetry && (
            <button
              type="button"
              disabled={isRetrying}
              onClick={handleRetryClick}
              className={`${
                onBack
                  ? "flex-1 bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-white/10"
                  : "flex-1 btn-gradient"
              } rounded-xl py-3 text-xs font-semibold cursor-pointer transition hover:opacity-90 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {t("retryAction")}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className={`${
              onBack && onRetry ? "px-4" : "flex-1"
            } bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-white/10 rounded-xl py-3 text-xs font-semibold cursor-pointer transition`}
          >
            {t("close")}
          </button>
        </div>
      )}

      {/* Explicit Done action button on success */}
      {stage === "success" && (
        <button
          type="button"
          onClick={onClose}
          className="w-full btn-gradient rounded-xl py-3.5 text-sm font-semibold cursor-pointer transition hover:opacity-90 mt-2"
        >
          {t("close")}
        </button>
      )}
    </div>
  );

  if (isEmbedded) {
    return modalContent;
  }

  return (
    <div
      className="modal-backdrop animate-fade-in z-50"
      onClick={() => isTerminalState && onClose()}
    >
      {modalContent}
    </div>
  );
}

function StepDot({
  active,
  completed,
}: {
  active: boolean;
  completed: boolean;
}) {
  return (
    <div
      className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
        completed
          ? "bg-tertiary"
          : active
            ? "bg-primary scale-125 shadow-[0_0_8px_rgba(135,173,255,0.6)]"
            : "bg-surface-bright"
      }`}
    />
  );
}

function StepLine({ active }: { active: boolean }) {
  return (
    <div
      className={`h-0.5 w-6 transition-all duration-500 ${
        active ? "bg-primary/50" : "bg-surface-bright"
      }`}
    />
  );
}
