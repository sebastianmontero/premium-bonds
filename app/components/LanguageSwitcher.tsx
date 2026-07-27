"use client";

import { useLocale, useTranslations } from "next-intl";
import { usePathname, useRouter } from "@/i18n/routing";
import { useState, useRef, useEffect } from "react";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("Language");
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const toggleDropdown = () => setIsOpen(!isOpen);

  const handleSelectLanguage = (newLocale: "en" | "es") => {
    setIsOpen(false);
    if (newLocale !== locale) {
      router.replace(pathname, { locale: newLocale });
    }
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={toggleDropdown}
        className="inline-flex items-center gap-1.5 rounded-xl bg-surface-container-high/60 px-3 py-1.5 text-xs font-semibold text-on-surface transition-colors hover:bg-surface-container-high hover:text-primary focus:outline-none focus:ring-2 focus:ring-primary/40 cursor-pointer"
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <span className="text-sm">🌐</span>
        <span className="uppercase tracking-wider">{locale}</span>
        <svg
          className={`h-3.5 w-3.5 text-on-surface-variant transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          }`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-32 origin-top-right rounded-xl glass bg-surface-container/95 py-1.5 shadow-xl ring-1 ring-white/10 z-50 animate-in fade-in zoom-in-95 duration-150">
          <button
            onClick={() => handleSelectLanguage("en")}
            className={`flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
              locale === "en"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-on-surface hover:bg-surface-container-high"
            }`}
          >
            <span>{t("english")}</span>
            <span className="text-xs text-on-surface-variant font-mono">
              EN
            </span>
          </button>
          <button
            onClick={() => handleSelectLanguage("es")}
            className={`flex w-full items-center justify-between px-3 py-2 text-xs font-medium transition-colors cursor-pointer ${
              locale === "es"
                ? "bg-primary/10 text-primary font-semibold"
                : "text-on-surface hover:bg-surface-container-high"
            }`}
          >
            <span>{t("spanish")}</span>
            <span className="text-xs text-on-surface-variant font-mono">
              ES
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
