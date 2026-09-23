"use client";

import { useEffect, useCallback, MouseEvent } from "react";

export interface ModalDismissalOptions {
  isOpen: boolean;
  isBusy?: boolean;
  onClose: () => void;
  onBack?: () => void;
}

let activeModalCount = 0;

/**
 * Hook to manage modal dismissal rules, backdrop click target guarding,
 * body scroll locking, and keyboard Escape handling across idle, in-flight,
 * and terminal states.
 */
export function useModalDismissal({
  isOpen,
  isBusy = false,
  onClose,
  onBack,
}: ModalDismissalOptions) {
  // 1. Lock body scrolling while modal is open (reference-counted for stacked modals)
  useEffect(() => {
    if (!isOpen) return;
    activeModalCount++;
    if (activeModalCount === 1) {
      document.body.style.overflow = "hidden";
    }
    return () => {
      activeModalCount = Math.max(0, activeModalCount - 1);
      if (activeModalCount === 0) {
        document.body.style.overflow = "";
      }
    };
  }, [isOpen]);

  // 2. Keyboard Escape listener (blocked when busy/in-flight)
  useEffect(() => {
    if (!isOpen || isBusy) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (onBack) {
          onBack();
        } else {
          onClose();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isBusy, onClose, onBack]);

  // 3. Backdrop click handler with strict target equality check
  const handleBackdropClick = useCallback(
    (e: MouseEvent) => {
      if (e.target !== e.currentTarget || isBusy) return;
      onClose();
    },
    [isBusy, onClose]
  );

  return { handleBackdropClick };
}
