"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  searchDocArticles,
  searchErrorLookupItems,
  getDocCategory,
} from "@/app/lib/docs/data";
import { Link, useRouter } from "@/i18n/routing";

interface DocsSearchProps {
  locale: string;
}

type SearchItem =
  | {
      type: "article";
      key: string;
      categorySlug: string;
      slug: string;
      title: string;
      categoryTitle: string;
      summary: string;
      href: string;
    }
  | {
      type: "error";
      key: string;
      code: string;
      name: string;
      category: string;
      diagnosis: string;
      href: string;
    };

export function DocsSearch({ locale }: DocsSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Derived search results combining articles and matching errors
  const results = useMemo<SearchItem[]>(() => {
    if (!query.trim()) return [];

    const articleMatches = searchDocArticles(query, locale).map(
      (article): SearchItem => {
        const cat = getDocCategory(article.categorySlug);
        const categoryTitle =
          article.categoryTitle?.[locale as "en" | "es"] ||
          cat?.title[locale as "en" | "es"] ||
          "Documentation";
        const title = article.title[locale as "en" | "es"] || article.title.en;
        const summary =
          article.summary[locale as "en" | "es"] || article.summary.en;

        return {
          type: "article",
          key: `article-${article.categorySlug}-${article.slug}`,
          categorySlug: article.categorySlug,
          slug: article.slug,
          title,
          categoryTitle,
          summary,
          href: `/docs/${article.categorySlug}/${article.slug}`,
        };
      }
    );

    const errorMatches = searchErrorLookupItems(query, locale)
      .slice(0, 5)
      .map((item): SearchItem => {
        const diagnosis =
          item.diagnosis[locale as "en" | "es"] || item.diagnosis.en;
        return {
          type: "error",
          key: `error-${item.code}`,
          code: item.code,
          name: item.name,
          category: item.category,
          diagnosis,
          href: `/docs/4-troubleshooting/common-errors?code=${item.code}`,
        };
      });

    return [...articleMatches, ...errorMatches];
  }, [query, locale]);

  const showDropdown = isOpen && query.trim().length > 0;

  const handleQueryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setSelectedIndex(0);
    setIsOpen(val.trim().length > 0);
  };

  // Keyboard shortcut listener (Cmd+K or Ctrl+K or /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === "/" && document.activeElement !== inputRef.current) {
        if (
          document.activeElement?.tagName !== "INPUT" &&
          document.activeElement?.tagName !== "TEXTAREA"
        ) {
          e.preventDefault();
          inputRef.current?.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Handle clicking outside to close
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Handle keyboard navigation in search results
  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || results.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const selected = results[selectedIndex];
      if (selected) {
        setIsOpen(false);
        setQuery("");
        router.push(selected.href);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
    }
  };

  const placeholderText =
    locale === "es"
      ? "Buscar documentación o código de error... (Ctrl + K)"
      : "Search documentation or error code... (Cmd + K)";

  return (
    <div ref={searchRef} className="relative w-full max-w-xl">
      <div className="relative flex items-center">
        <span className="absolute left-3.5 text-on-surface-variant/60 pointer-events-none">
          🔍
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => query.trim() && setIsOpen(true)}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholderText}
          className="w-full rounded-xl bg-surface-container-high/80 border border-outline-variant/30 py-2.5 pl-10 pr-16 text-sm text-on-surface placeholder:text-on-surface-variant/60 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 transition shadow-inner"
        />
        <div className="absolute right-3 hidden md:flex items-center gap-1">
          <kbd className="rounded border border-outline-variant/30 bg-surface-container px-1.5 py-0.5 text-[10px] font-mono text-on-surface-variant">
            ⌘K
          </kbd>
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {showDropdown && (
        <div className="absolute left-0 right-0 top-full mt-2 z-50 rounded-2xl bg-surface-container-high border border-outline-variant/30 shadow-2xl overflow-hidden backdrop-blur-xl animate-fade-in max-h-96 overflow-y-auto">
          {results.length === 0 ? (
            <div className="p-4 text-center text-sm text-on-surface-variant">
              {locale === "es"
                ? "No se encontraron resultados."
                : "No matching articles or error codes found."}
            </div>
          ) : (
            <div className="p-2 space-y-1">
              {results.map((item, idx) => {
                const isSelected = idx === selectedIndex;

                if (item.type === "error") {
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      onClick={() => {
                        setIsOpen(false);
                        setQuery("");
                      }}
                      className={`block rounded-xl p-3 transition ${
                        isSelected
                          ? "bg-primary/15 border-l-4 border-primary pl-4"
                          : "hover:bg-surface-container-highest/60"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-bold text-sm text-primary">
                          🛠️ Error {item.code}: {item.name}
                        </span>
                        <span className="rounded-md bg-surface-container px-2 py-0.5 text-[10px] font-medium text-amber-300 border border-amber-500/20 shrink-0 capitalize">
                          {item.category}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-on-surface-variant/80 line-clamp-1">
                        {item.diagnosis}
                      </p>
                    </Link>
                  );
                }

                return (
                  <Link
                    key={item.key}
                    href={item.href}
                    onClick={() => {
                      setIsOpen(false);
                      setQuery("");
                    }}
                    className={`block rounded-xl p-3 transition ${
                      isSelected
                        ? "bg-primary/15 border-l-4 border-primary pl-4"
                        : "hover:bg-surface-container-highest/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-on-surface">
                        {item.title}
                      </span>
                      <span className="rounded-md bg-surface-container px-2 py-0.5 text-[10px] font-medium text-primary border border-primary/20 shrink-0">
                        {item.categoryTitle}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-on-surface-variant/80 line-clamp-1">
                      {item.summary}
                    </p>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
