"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { useClipboard } from "@/app/hooks/useClipboard";

function CheckIcon({ className }: { className: string }) {
  return (
    <svg
      className={`${className} text-emerald-400 shrink-0`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function ClipboardIcon({ className }: { className: string }) {
  return (
    <svg
      className={`${className} shrink-0`}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
      />
    </svg>
  );
}

export interface CopyButtonProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "onClick" | "children"
> {
  text: string;
  label?: React.ReactNode;
  copiedLabel?: React.ReactNode;
  showIcon?: boolean;
  ariaLabel?: string;
  copiedAriaLabel?: string;
  title?: string;
  copiedTitle?: string;
  className?: string;
  iconClassName?: string;
  timeoutMs?: number;
  onCopySuccess?: (text: string) => void;
  onCopyError?: (error: unknown) => void;
  children?:
    | React.ReactNode
    | ((props: { copied: boolean }) => React.ReactNode);
}

export function CopyButton({
  text,
  label,
  copiedLabel,
  showIcon = true,
  ariaLabel,
  copiedAriaLabel,
  title,
  copiedTitle,
  className = "p-1 rounded-md text-on-surface-variant/60 hover:text-on-surface hover:bg-surface-bright/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary transition cursor-pointer text-xs shrink-0 inline-flex items-center gap-1",
  iconClassName = "w-3.5 h-3.5",
  timeoutMs = 2000,
  disabled = false,
  onCopySuccess,
  onCopyError,
  children,
  ...buttonProps
}: CopyButtonProps) {
  const t = useTranslations("Common.actions");
  const { copied, copy } = useClipboard({
    timeoutMs,
    onSuccess: onCopySuccess,
    onError: onCopyError,
  });

  const handleCopy = async (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (disabled || !text) return;
    await copy(text);
  };

  const buttonTitle = copied
    ? (copiedTitle ?? t("copied"))
    : (title ?? t("copy"));

  const buttonAriaLabel = copied
    ? (copiedAriaLabel ?? t("copied"))
    : (ariaLabel ?? title ?? t("copy"));

  const currentLabel = copied ? (copiedLabel ?? label) : label;

  return (
    <button
      type="button"
      data-prevent-row-click="true"
      onClick={handleCopy}
      disabled={disabled || !text}
      title={buttonTitle}
      aria-label={buttonAriaLabel}
      className={`${className} ${disabled || !text ? "opacity-50 cursor-not-allowed" : ""}`}
      {...buttonProps}
    >
      {showIcon &&
        (copied ? (
          <CheckIcon className={iconClassName} />
        ) : (
          <ClipboardIcon className={iconClassName} />
        ))}
      {currentLabel && (
        <span className={copied ? "text-emerald-400" : ""}>{currentLabel}</span>
      )}
      {typeof children === "function" ? children({ copied }) : children}

      {/* WCAG 2.1 AA Polite Live Region for Screen Readers */}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? (copiedAriaLabel ?? t("copied")) : ""}
      </span>
    </button>
  );
}
