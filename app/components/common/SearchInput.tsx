"use client";

import React from "react";
import { useTranslations } from "next-intl";

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "onChange" | "value"
> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  containerClassName?: string;
  ref?: React.Ref<HTMLInputElement>;
}

export function SearchInput({
  ref,
  value,
  onChange,
  onClear,
  containerClassName = "",
  placeholder,
  disabled = false,
  className = "",
  ...rest
}: SearchInputProps) {
  const tCommon = useTranslations("Common.aria");

  return (
    <div className={`relative ${containerClassName}`}>
      <input
        ref={ref}
        type="search"
        aria-label={rest["aria-label"] || placeholder}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full rounded-xl border border-surface-bright/10 bg-[#08090E] py-2 ps-9 pe-10 text-base md:text-xs text-on-surface placeholder:text-on-surface-variant/40 focus:border-primary focus:outline-none min-h-[44px] md:min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed transition [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none ${className}`}
        {...rest}
      />
      <svg
        className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-on-surface-variant/40 pointer-events-none"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
        />
      </svg>
      {onClear && value && !disabled && (
        <button
          type="button"
          onClick={onClear}
          className="absolute end-1 top-1/2 -translate-y-1/2 text-on-surface-variant/40 hover:text-on-surface min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer"
          aria-label={tCommon("clearSearch")}
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      )}
    </div>
  );
}
