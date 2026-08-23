"use client";

import { useTranslations } from "next-intl";
import { getExplorerUrl, truncateSignature } from "@/app/lib/errors";

export type TransactionStage =
  | "preparing"
  | "signing"
  | "broadcasting"
  | "confirming"
  | "success"
  | "error"
  | null;

interface TransactionProgressModalProps {
  isOpen: boolean;
  stage: TransactionStage;
  title?: string;
  customSuccessMessage?: string;
  errorMessage?: string | null;
  actionableStep?: string | null;
  txSignature?: string | null;
  onRetry?: () => void;
  onClose: () => void;
}

export function TransactionProgressModal({
  isOpen,
  stage,
  title,
  customSuccessMessage,
  errorMessage,
  actionableStep,
  txSignature,
  onRetry,
  onClose,
}: TransactionProgressModalProps) {
  const t = useTranslations("Modals");
  if (!isOpen || stage === null) return null;

  return (
    <div
      className="modal-backdrop animate-fade-in z-50"
      onClick={() => (stage === "success" || stage === "error") && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl glass-strong p-6 text-center space-y-6 shadow-ambient mx-4 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Pulsing/spinning loader container */}
        <div className="relative flex items-center justify-center h-24 w-24 mx-auto">
          <div
            className={`absolute inset-0 rounded-full border-2 ${
              stage === "error"
                ? "border-error/30"
                : "border-primary/20"
            } ${stage !== "success" && stage !== "error" ? "animate-ping opacity-75" : ""}`}
          />
          <div
            className={`absolute h-16 w-16 rounded-full flex items-center justify-center border shadow-inner ${
              stage === "error"
                ? "bg-error/10 border-error/30"
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
            {stage === "error" && (
              <span className="text-3xl text-error">❌</span>
            )}
          </div>
        </div>

        {/* Title and Description */}
        <div className="space-y-2">
          <h3
            className={`font-display text-xl font-bold ${
              stage === "error" ? "text-error" : "text-on-surface"
            }`}
          >
            {stage === "preparing" && t("actionPreparing")}
            {stage === "signing" && (title ?? t("actionSigning"))}
            {stage === "broadcasting" && t("actionBroadcasting")}
            {stage === "confirming" && t("actionConfirming")}
            {stage === "success" && t("actionSuccess")}
            {stage === "error" && (title ?? t("actionError"))}
          </h3>
          <p className="text-xs text-on-surface-variant max-w-xs mx-auto px-4 leading-relaxed">
            {stage === "preparing" &&
              "Preparing transaction payload and fetching blockhash..."}
            {stage === "signing" &&
              "Please approve the transaction prompt in your wallet extension."}
            {stage === "broadcasting" &&
              "Submitting transaction to the Solana network cluster..."}
            {stage === "confirming" &&
              "Waiting for transaction to reach confirmed status..."}
            {stage === "success" && (customSuccessMessage ?? t("success"))}
            {stage === "error" &&
              (errorMessage || "Transaction execution failed. Please check your inputs and try again.")}
          </p>

          {stage === "error" && actionableStep && (
            <p className="text-xs font-medium text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-lg py-1.5 px-3 max-w-xs mx-auto">
              👉 {actionableStep}
            </p>
          )}

          {stage === "success" && txSignature && (
            <div className="pt-2">
              <a
                href={getExplorerUrl(txSignature, "devnet", "solscan")}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20"
              >
                View on Solscan: {truncateSignature(txSignature)} ↗
              </a>
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
              completed={stage !== "preparing" && stage !== "signing" && stage !== "broadcasting"}
            />
            <StepLine active={stage === "confirming" || stage === "success"} />
            <StepDot
              active={stage === "confirming"}
              completed={stage === "success"}
            />
          </div>
        )}

        {/* Action buttons */}
        {stage === "error" && (
          <div className="flex items-center gap-3 pt-2">
            {onRetry && (
              <button
                onClick={onRetry}
                className="flex-1 btn-gradient rounded-xl py-3 text-xs font-semibold cursor-pointer transition hover:opacity-90 shadow-sm"
              >
                🔄 {t("retryAction")}
              </button>
            )}
            <button
              onClick={onClose}
              className="flex-1 bg-surface-container-highest hover:bg-surface-bright text-on-surface border border-white/10 rounded-xl py-3 text-xs font-semibold cursor-pointer transition"
            >
              {t("close")}
            </button>
          </div>
        )}

        {/* Explicit Done action button on success */}
        {stage === "success" && (
          <button
            onClick={onClose}
            className="w-full btn-gradient rounded-xl py-3.5 text-sm font-semibold cursor-pointer transition hover:opacity-90 mt-2"
          >
            {t("close")}
          </button>
        )}
      </div>
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
