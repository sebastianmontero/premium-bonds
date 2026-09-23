"use client";

import React from "react";
import { ParsedTransactionError } from "@/app/lib/errors";
import { AdaptiveModal } from "@/app/components/common/AdaptiveModal";
import { TransactionProgressView } from "./TransactionProgressView";

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
  if (!isOpen || stage === null) return null;

  const content = (
    <TransactionProgressView
      stage={stage}
      title={title}
      showHeading={true}
      customSuccessMessage={customSuccessMessage}
      error={error}
      txSignature={txSignature}
      onRetry={onRetry}
      onClose={onClose}
      onBack={onBack}
      backLabel={backLabel}
    />
  );

  if (isEmbedded) {
    return content;
  }

  return (
    <AdaptiveModal
      isOpen={isOpen}
      onClose={onClose}
      onBack={stage === "error" ? onBack : undefined}
      size="sm"
      zIndex="z-[70]"
      showHeader={false}
      isBusy={isInFlightStage(stage)}
    >
      {content}
    </AdaptiveModal>
  );
}
