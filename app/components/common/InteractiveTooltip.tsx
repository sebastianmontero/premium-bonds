"use client";

import React, { useState, useRef, useEffect } from "react";

export interface InteractiveTooltipProps {
  content: React.ReactNode;
  ariaLabel: string;
  children?: React.ReactNode;
  align?: "left" | "center" | "right";
  side?: "top" | "bottom";
  role?: "tooltip" | "dialog";
  className?: string;
  panelClassName?: string;
  triggerClassName?: string;
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

/**
 * Accessible touch- & keyboard-friendly tooltip / contextual popover wrapper
 * with outside-click dismissal, Escape key isolation, and directional alignment.
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
}: InteractiveTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent | TouchEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
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

  const getPositionClasses = () => {
    const horizontal =
      align === "left"
        ? "left-0 translate-x-0"
        : align === "right"
          ? "right-0 left-auto translate-x-0"
          : "left-1/2 -translate-x-1/2";

    const vertical =
      side === "bottom" ? "top-full mt-2.5" : "bottom-full mb-2.5";

    return `${horizontal} ${vertical}`;
  };

  const getArrowClasses = () => {
    const horizontal =
      align === "left"
        ? "left-4 translate-x-0"
        : align === "right"
          ? "right-4 left-auto translate-x-0"
          : "left-1/2 -translate-x-1/2";

    const vertical =
      side === "bottom"
        ? "bottom-full -mb-px border-b-4 border-b-[#101726] border-t-0"
        : "top-full -mt-px border-t-4 border-t-[#101726] border-b-0";

    return `${horizontal} ${vertical}`;
  };

  return (
    <div
      ref={containerRef}
      className={`relative inline-flex items-center ${className}`}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
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
        onFocus={() => setIsOpen(true)}
        onBlur={(e) => {
          // Keep open if focus moved inside container
          if (!containerRef.current?.contains(e.relatedTarget as Node)) {
            setIsOpen(false);
          }
        }}
        className={`inline-flex items-center cursor-pointer text-left bg-transparent border-0 p-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-md shrink-0 ${triggerClassName}`}
      >
        {children ?? <InfoIcon />}
      </button>

      {isOpen && (
        <div
          role={role}
          aria-label={role === "dialog" ? ariaLabel : undefined}
          className={`absolute z-50 w-56 sm:w-72 max-w-[calc(100vw-2.5rem)] rounded-xl shadow-2xl p-3 text-xs text-on-surface leading-relaxed border border-outline-variant/40 animate-fadeIn ${getPositionClasses()} ${panelClassName}`}
          style={{ backgroundColor: "rgba(16, 23, 38, 0.98)" }}
        >
          <div className="relative z-10 font-normal text-on-surface">
            {content}
          </div>
          {/* Opaque Arrow */}
          <div
            className={`absolute w-0 h-0 border-x-4 border-x-transparent ${getArrowClasses()}`}
          />
        </div>
      )}
    </div>
  );
}
