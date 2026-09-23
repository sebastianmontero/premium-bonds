"use client";

import React, {
  useRef,
  useEffect,
  useId,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { useModalDismissal } from "@/app/hooks/useModalDismissal";

export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";
export type ModalHeight = "auto" | "tall" | "viewport";

const SIZE_CLASSES: Record<ModalSize, string> = {
  sm: "max-w-md",
  md: "max-w-lg",
  lg: "max-w-4xl",
  xl: "max-w-5xl 2xl:max-w-6xl",
  full: "max-w-full",
};

const HEIGHT_CLASSES: Record<ModalHeight, string> = {
  auto: "max-h-[90dvh] md:max-h-[85vh]",
  tall: "h-[90dvh] md:h-[85vh]",
  viewport: "h-[100dvh] md:h-auto",
};

export const FOCUSABLE_ELEMENTS_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface AdaptiveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBack?: () => void;
  title?: ReactNode;
  ariaLabel?: string;
  titleIcon?: ReactNode;
  subtitle?: ReactNode;
  showHeader?: boolean;
  isBusy?: boolean;
  size?: ModalSize;
  height?: ModalHeight;
  scrollable?: boolean;
  bodyClassName?: string;
  zIndex?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
  headerAction?: ReactNode;
}

export function AdaptiveModal({
  isOpen,
  onClose,
  onBack,
  title,
  ariaLabel,
  titleIcon,
  subtitle,
  showHeader = true,
  isBusy = false,
  size = "lg",
  height = "auto",
  scrollable = true,
  bodyClassName = "",
  zIndex = "z-50",
  initialFocusRef,
  className = "",
  children,
  headerAction,
}: AdaptiveModalProps) {
  const tCommon = useTranslations("Common.aria");
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);
  const generatedId = useId();
  const titleId = `adaptive-modal-title-${generatedId}`;
  const subtitleId = `adaptive-modal-sub-${generatedId}`;

  const { handleBackdropClick } = useModalDismissal({
    isOpen,
    isBusy,
    onClose,
    onBack,
  });

  // 1. Lifecycle Effect: Capture and restore focus strictly across modal open/close
  useEffect(() => {
    if (!isOpen) return;
    lastActiveElementRef.current = document.activeElement as HTMLElement | null;

    return () => {
      if (
        lastActiveElementRef.current &&
        document.body.contains(lastActiveElementRef.current)
      ) {
        lastActiveElementRef.current.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  // 2. Initial Focus Effect: Prioritize ref -> primary input (desktop only) -> first visible focusable
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      if (initialFocusRef?.current) {
        initialFocusRef.current.focus({ preventScroll: true });
        return;
      }
      const modalEl = modalRef.current;
      if (!modalEl) return;

      // On mobile viewports, do not auto-focus input unless explicitly passed via initialFocusRef
      // to avoid triggering the software keyboard and crushing the viewport
      if (typeof window !== "undefined" && window.innerWidth >= 768) {
        const primaryInput = modalEl.querySelector<HTMLElement>(
          "input:not([disabled]):not([type='hidden']), textarea:not([disabled])"
        );
        if (primaryInput && primaryInput.getClientRects().length > 0) {
          primaryInput.focus({ preventScroll: true });
          return;
        }
      }

      const focusable = Array.from(
        modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR)
      ).filter((el) => el.getClientRects().length > 0);
      (focusable[0] ?? modalEl).focus({ preventScroll: true });
    }, 16);

    return () => clearTimeout(timer);
  }, [isOpen, initialFocusRef]);

  // 3. Tab Trap Effect: Attached to window to guarantee interception of escaped focus
  useEffect(() => {
    if (!isOpen) return;
    const handleTabTrap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const modalEl = modalRef.current;
      if (!modalEl) return;

      const focusable = Array.from(
        modalEl.querySelectorAll<HTMLElement>(FOCUSABLE_ELEMENTS_SELECTOR)
      ).filter((el) => el.getClientRects().length > 0);

      if (focusable.length === 0) {
        e.preventDefault();
        modalEl.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (!modalEl.contains(document.activeElement)) {
        e.preventDefault();
        first.focus({ preventScroll: true });
        return;
      }
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    window.addEventListener("keydown", handleTabTrap);
    return () => window.removeEventListener("keydown", handleTabTrap);
  }, [isOpen]);

  if (!isOpen) return null;

  const modalContent = (
    <div
      className={`fixed inset-0 ${zIndex} flex items-end md:items-center justify-center p-0 md:p-4 overscroll-contain`}
      onClick={handleBackdropClick}
    >
      {/* Backdrop */}
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-black/80 backdrop-blur-md transition-opacity duration-300 pointer-events-none touch-none"
      />

      {/* Modal Container */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={showHeader && title ? titleId : undefined}
        aria-label={!showHeader || !title ? ariaLabel : undefined}
        aria-describedby={showHeader && subtitle ? subtitleId : undefined}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full ${SIZE_CLASSES[size]} rounded-t-3xl md:rounded-2xl border-t md:border border-surface-bright/10 bg-[#0F111A]/95 p-4 sm:p-6 shadow-ambient z-10 overflow-hidden flex flex-col ${HEIGHT_CLASSES[height]} glass-strong animate-slide-up md:animate-scale-in pb-safe-lg md:pb-6 focus:outline-none ${className}`}
      >
        {/* Drag Handle Affordance for Mobile */}
        <div
          aria-hidden="true"
          className="w-12 h-1.5 bg-surface-bright/30 rounded-full mx-auto mb-3 md:hidden shrink-0"
        />

        {/* Optional Header */}
        {showHeader && (
          <div className="flex items-center justify-between pb-3 sm:pb-4 border-b border-surface-bright/5 shrink-0">
            <div className="flex items-center gap-3">
              {titleIcon}
              <div>
                {title && (
                  <h3
                    id={titleId}
                    className="text-lg sm:text-xl font-bold font-display text-on-surface"
                  >
                    {title}
                  </h3>
                )}
                {subtitle && (
                  <p
                    id={subtitleId}
                    className="text-xs text-on-surface-variant mt-0.5"
                  >
                    {subtitle}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {headerAction}
              <button
                onClick={onClose}
                disabled={isBusy}
                aria-label={tCommon("closeModal")}
                className="rounded-lg p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/5 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-50"
              >
                <svg
                  className="w-5 h-5"
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
              </button>
            </div>
          </div>
        )}

        {/* Content Body: Slot-based scrollable vs fixed flex container */}
        <div
          className={
            scrollable
              ? `flex-1 overflow-y-auto min-h-0 pt-3 sm:pt-4 overscroll-contain ${bodyClassName}`
              : `flex-1 min-h-0 flex flex-col overflow-hidden pt-3 sm:pt-4 ${bodyClassName}`
          }
        >
          {children}
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") {
    return modalContent;
  }

  return createPortal(modalContent, document.body);
}
