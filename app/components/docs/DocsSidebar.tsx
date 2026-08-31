"use client";

import React, { useState } from "react";
import { DOC_CATEGORIES, DOC_ARTICLES } from "@/app/lib/docs/data";
import { Link } from "@/i18n/routing";

interface DocsSidebarProps {
  currentCategorySlug?: string;
  currentArticleSlug?: string;
  locale: string;
}

export function DocsSidebar({
  currentCategorySlug,
  currentArticleSlug,
  locale,
}: DocsSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile Toggle Button */}
      <div className="flex items-center justify-between lg:hidden mb-4 p-3 rounded-xl bg-surface-container-low border border-outline-variant/20">
        <span className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span>📚</span> Documentation Menu
        </span>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="px-3 py-1.5 text-xs sm:text-sm font-medium rounded-lg bg-surface-container-high text-primary hover:bg-surface-container-highest transition cursor-pointer"
        >
          {mobileOpen ? "Close Menu ✕" : "Browse Topics ☰"}
        </button>
      </div>

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-72 transform bg-surface-container-lowest/95 backdrop-blur-2xl p-6 transition-transform duration-300 border-r border-outline-variant/15 lg:static lg:w-64 lg:translate-x-0 shrink-0 ${
          mobileOpen
            ? "translate-x-0 shadow-2xl"
            : "-translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between mb-6 lg:hidden">
          <span className="font-display font-bold text-sm text-on-surface">
            Documentation Index
          </span>
          <button
            onClick={() => setMobileOpen(false)}
            className="text-on-surface-variant hover:text-on-surface text-base"
          >
            ✕
          </button>
        </div>

        <nav className="space-y-6 overflow-y-auto max-h-[calc(100vh-8rem)] pr-2">
          {DOC_CATEGORIES.map((cat) => {
            const targetLocale = (locale === "es" ? "es" : "en") as "en" | "es";
            const categoryTitle = cat.title[targetLocale] || cat.title.en;
            const articles = DOC_ARTICLES.filter(
              (a) => a.categorySlug === cat.slug
            );

            return (
              <div key={cat.slug} className="space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold tracking-wider uppercase text-on-surface-variant/90">
                  <span>{cat.icon}</span>
                  <span>{categoryTitle}</span>
                </div>

                <div className="space-y-0.5 pl-3 border-l border-outline-variant/20">
                  {articles.map((article) => {
                    const articleTitle =
                      article.title[targetLocale] || article.title.en;
                    const isActive =
                      currentCategorySlug === cat.slug &&
                      currentArticleSlug === article.slug;

                    return (
                      <Link
                        key={article.slug}
                        href={`/docs/${cat.slug}/${article.slug}`}
                        onClick={() => setMobileOpen(false)}
                        className={`block rounded-lg px-3 py-1.5 text-sm font-medium transition ${
                          isActive
                            ? "bg-primary/15 text-primary font-bold border-l-2 border-primary -ml-[13px] pl-[11px]"
                            : "text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high/40"
                        }`}
                      >
                        {articleTitle}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
