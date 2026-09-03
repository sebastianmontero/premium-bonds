"use client";

import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

const emptySubscribe = () => () => {};

export interface InteractiveTooltipProps {
  content: React.ReactNode;
  ariaLabel: string;
  /**
   * Optional custom trigger content rendered inside the root trigger `<button>`.
   * @remarks
   * Must be inline/phrasing content (e.g. `<span>`, `<svg>`, text) and NEVER
   * interactive elements like `<button>` or `<a>` to avoid invalid HTML nesting and React hydration errors.
   */
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
  side?: "top" | "bottom";
  role?: "tooltip" | "dialog";
  className?: string;
  panelClassName?: string;
  triggerClassName?: string;
  /**
   * Whether to render the tooltip panel into `document.body` via a React Portal.
   * Prevents clipping by parent overflow containers (tables, modals, cards).
   * @default true
   */
  usePortal?: boolean;
}

/**
 * Reusable info question-mark icon with consistent styling.
 */
export function InfoIcon({
  className = "w-3.5 h-3.5",
}: {
  className?: string;
}) {
  return (
    <span className="cursor-help text-on-surface-variant/70 hover:text-primary transition-colors inline-flex items-center">
      <svg
        className={className}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10" strokeWidth="2" />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M12 16v-4m0-4h.01"
        />
      </svg>
    </span>
  );
}

interface TooltipPosition {
  top: number;
  left: number;
  actualSide: "top" | "bottom";
  arrowLeft: number;
}

/**
 * Accessible touch- & keyboard-friendly tooltip / contextual popover wrapper
 * with outside-click dismissal, Escape key isolation, auto-flipping,
 * boundary clipping prevention via React Portal, and directional alignment.
 */
export function InteractiveTooltip({
  content,
  ariaLabel,
  children,
  align = "center",
  side = "top",
  role = "tooltip",
  className = "",
  panelClassName = "",
  triggerClassName = "",
  usePortal = true,
}: InteractiveTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isClient = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<NodeJS.Timeout | null>(null);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const panelEl = panelRef.current;
    const panelRect = panelEl?.getBoundingClientRect();

    const panelWidth = panelRect?.width || 288;
    const panelHeight = panelRect?.height || 96;

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const gap = 8;

    // Determine vertical side with boundary flipping
    let chosenSide = side;
    if (side === "top" && triggerRect.top - panelHeight - gap < 10) {
      chosenSide = "bottom";
    } else if (
      side === "bottom" &&
      triggerRect.bottom + panelHeight + gap > viewportHeight - 10
    ) {
      chosenSide = "top";
    }

    const top =
      chosenSide === "top"
        ? triggerRect.top - panelHeight - gap
        : triggerRect.bottom + gap;

    // Determine horizontal alignment
    let left: number;
    if (align === "left") {
      left = triggerRect.left;
    } else if (align === "right") {
      left = triggerRect.right - panelWidth;
    } else {
      left = triggerRect.left + triggerRect.width / 2 - panelWidth / 2;
    }

    // Viewport boundary clamping (keep at least 12px from viewport edges)
    const clampedLeft = Math.max(
      12,
      Math.min(left, viewportWidth - panelWidth - 12)
    );

    // Arrow position aligned with trigger center
    const triggerCenter = triggerRect.left + triggerRect.width / 2;
    const arrowLeft = Math.max(
      16,
      Math.min(triggerCenter - clampedLeft, panelWidth - 16)
    );

    setPosition({
      top,
      left: clampedLeft,
      actualSide: chosenSide,
      arrowLeft,
    });
  }, [align, side]);

  useEffect(() => {
    if (!isOpen) return;

    updatePosition();

    // Listen for scroll & resize on all potential scrolling ancestor containers
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);

    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [isOpen, updatePosition, content]);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node;
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        panelRef.current &&
        !panelRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const handleMouseEnter = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 150);
  };

  const panelElement = (
    <div
      ref={panelRef}
      role={role}
      aria-label={role === "dialog" ? ariaLabel : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`z-[99999] w-72 sm:w-80 max-w-[calc(100vw-2rem)] rounded-xl shadow-2xl p-3 text-xs text-on-surface leading-relaxed border border-outline-variant/40 animate-fadeIn whitespace-normal break-words text-left ${
        usePortal ? "fixed" : "absolute"
      } ${panelClassName}`}
      style={{
        backgroundColor: "rgba(16, 23, 38, 0.98)",
        ...(usePortal
          ? {
              top: position ? `${position.top}px` : "-9999px",
              left: position ? `${position.left}px` : "-9999px",
              visibility: position ? "visible" : "hidden",
            }
          : {}),
      }}
    >
      <div className="relative z-10 font-normal text-on-surface whitespace-normal break-words text-left">
        {content}
      </div>
      {/* Opaque Arrow */}
      {position && (
        <div
          className={`absolute w-0 h-0 border-x-4 border-x-transparent pointer-events-none ${
            position.actualSide === "bottom"
              ? "bottom-full -mb-px border-b-4 border-b-[#101726] border-t-0"
              : "top-full -mt-px border-t-4 border-t-[#101726] border-b-0"
          }`}
          style={{
            left: `${position.arrowLeft}px`,
            transform: "translateX(-50%)",
          }}
        />
      )}
    </div>
  );

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-prevent-row-click="true"
      onClick={(e) => e.stopPropagation()}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-label={ariaLabel}
        aria-expanded={isOpen}
        aria-haspopup={role === "dialog" ? "dialog" : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen((prev) => !prev);
        }}
        onFocus={() => {
          handleMouseEnter();
        }}
        onBlur={(e) => {
          // Keep open if focus moved inside container or panel
          if (
            !containerRef.current?.contains(e.relatedTarget as Node) &&
            !panelRef.current?.contains(e.relatedTarget as Node)
          ) {
            setIsOpen(false);
          }
        }}
        className={`inline-flex items-center cursor-pointer text-left bg-transparent border-0 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md shrink-0 ${triggerClassName}`}
      >
        {children ?? <InfoIcon />}
      </button>

      {isOpen &&
        (usePortal && isClient && typeof document !== "undefined"
          ? createPortal(panelElement, document.body)
          : panelElement)}
    </div>
  );
}
