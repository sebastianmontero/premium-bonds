"use client";

import React, { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { DOC_CATEGORIES, DOC_ARTICLES } from "@/app/lib/docs/data";
import { Link } from "@/i18n/routing";
import { useModalDismissal } from "@/app/hooks/useModalDismissal";

interface DocsSidebarProps {
  currentCategorySlug?: string;
  currentArticleSlug?: string;
}

export function DocsSidebar({
  currentCategorySlug,
  currentArticleSlug,
}: DocsSidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const locale = useLocale();
  const t = useTranslations("Docs");

  useModalDismissal({
    isOpen: mobileOpen,
    onClose: () => setMobileOpen(false),
  });

  return (
    <>
      {/* Mobile Toggle Button */}
      <div className="flex items-center justify-between lg:hidden mb-4 p-3 rounded-xl bg-surface-container-low border border-outline-variant/20">
        <span className="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span>📚</span> {t("docsMenu")}
        </span>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="min-h-[44px] px-3.5 py-2 text-xs sm:text-sm font-medium rounded-lg bg-surface-container-high text-primary hover:bg-surface-container-highest transition cursor-pointer flex items-center justify-center"
        >
          {mobileOpen ? t("closeMenu") : t("browseTopics")}
        </button>
      </div>

      {/* Backdrop overlay for mobile */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 backdrop-blur-sm lg:hidden transition-opacity"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed inset-y-0 start-0 z-40 w-72 transform bg-surface-container-lowest/95 backdrop-blur-2xl p-6 transition-transform duration-300 border-e border-outline-variant/15 lg:static lg:w-64 lg:translate-x-0 shrink-0 ${
          mobileOpen
            ? "translate-x-0 shadow-2xl"
            : "ltr:-translate-x-full rtl:translate-x-full lg:translate-x-0"
        }`}
      >
        <div className="flex items-center justify-between mb-6 lg:hidden">
          <span className="font-display font-bold text-sm text-on-surface">
            {t("docsIndex")}
          </span>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label={t("closeMenu")}
            className="w-11 h-11 flex items-center justify-center text-on-surface-variant hover:text-on-surface text-base rounded-lg hover:bg-surface-container-high transition"
          >
            ✕
          </button>
        </div>

        <nav className="space-y-6 overflow-y-auto max-h-[calc(100vh-8rem)] pe-2">
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

                <div className="space-y-0.5 ps-3 border-s border-outline-variant/20">
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
                            ? "bg-primary/15 text-primary font-bold border-s-2 border-primary -ms-[13px] ps-[11px]"
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
