"use client";

import React from "react";

export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
  count?: number;
  icon?: React.ReactNode;
}

interface SegmentedControlProps<T extends string | number> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  disabled = false,
  className = "",
  ariaLabel = "Filter selection",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 rounded-xl bg-[#08090E]/80 p-1 border border-surface-bright/15 overflow-x-auto max-w-full no-scrollbar ${className}`}
    >
      {options.map((opt) => {
        const isSelected = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="tab"
            aria-selected={isSelected}
            disabled={disabled}
            onClick={() => onChange(opt.value)}
            className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-semibold transition-all duration-150 cursor-pointer ${
              isSelected
                ? "bg-primary/20 text-primary border border-primary/40 shadow-sm"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40 border border-transparent"
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {opt.icon}
            <span>{opt.label}</span>
            {opt.count !== undefined && (
              <span
                className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                  isSelected
                    ? "bg-primary/30 text-primary-light"
                    : "bg-surface-bright/10 text-on-surface-variant"
                }`}
              >
                {opt.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
