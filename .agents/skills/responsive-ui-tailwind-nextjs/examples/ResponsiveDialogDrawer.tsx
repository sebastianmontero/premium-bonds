"use client";

import React, { useEffect, useRef } from "react";

export interface ResponsiveDialogDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * ResponsiveDialogDrawer
 *
 * Adaptive overlay pattern:
 * - Mobile (< 768px): Anchored bottom sheet drawer with safe-area padding and thumb-friendly controls.
 * - Desktop (>= 768px): Centered modal dialog with backdrop blur.
 * - Zero hydration mismatch: CSS classes govern the presentation shape.
 * - Dynamic viewport unit `h-dvh` prevents mobile browser toolbar clipping.
 * - Keyboard accessible (Esc to close, focusable container).
 */
export function ResponsiveDialogDrawer({
  isOpen,
  onClose,
  title,
  description,
  children,
}: ResponsiveDialogDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Keyboard accessibility: Close on Escape key
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Prevent background body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="responsive-dialog-title"
      className="fixed inset-0 z-50 flex items-end justify-center md:items-center p-0 md:p-4"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
        aria-hidden="true"
      />

      {/* 
        Responsive Overlay Shell:
        - Mobile: fixed to bottom, full width, rounded top corners, max-h-[85dvh], safe area bottom padding.
        - Desktop: centered, max-w-lg, rounded-3xl, natural padding.
      */}
      <div
        ref={dialogRef}
        className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-outline-variant bg-surface-container p-6 shadow-2xl transition-all md:max-h-[85vh] md:max-w-lg md:rounded-3xl md:border"
        style={{
          paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
        }}
      >
        {/* Mobile Drag Indicator Handle (Visual only, hidden on desktop) */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-outline-variant md:hidden" />

        {/* Dialog Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2
              id="responsive-dialog-title"
              className="font-display text-xl font-bold tracking-tight text-on-surface sm:text-2xl"
            >
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-sm text-on-surface-variant">
                {description}
              </p>
            )}
          </div>

          {/* Close button with minimum 44px hit target */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="flex h-11 w-11 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-surface-container-high hover:text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Dialog Content */}
        <div className="mt-6 space-y-4">{children}</div>
      </div>
    </div>
  );
}
