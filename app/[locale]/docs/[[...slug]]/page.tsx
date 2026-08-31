import React from "react";
import { setRequestLocale } from "next-intl/server";
import { Navbar } from "@/app/components/Navbar";
import { Footer } from "@/app/components/Footer";
import { DocsSearch } from "@/app/components/docs/DocsSearch";
import { DocsSidebar } from "@/app/components/docs/DocsSidebar";
import { DocArticleViewer } from "@/app/components/docs/DocArticleViewer";
import {
  DOC_CATEGORIES,
  DOC_ARTICLES,
  getDocArticle,
} from "@/app/lib/docs/data";
import { Link } from "@/i18n/routing";

type PageProps = {
  params: Promise<{ locale: string; slug?: string[] }>;
};

export default async function DocsPage({ params }: PageProps) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  // If slug has category and article, render article view
  const categorySlug = slug?.[0];
  const articleSlug = slug?.[1];

  let currentArticle =
    categorySlug && articleSlug
      ? getDocArticle(categorySlug, articleSlug)
      : undefined;

  // If single slug, maybe category or default
  if (!currentArticle && slug && slug.length === 1) {
    const matchingCategory = DOC_CATEGORIES.find((c) => c.slug === slug[0]);
    if (matchingCategory) {
      const firstArticle = DOC_ARTICLES.find(
        (a) => a.categorySlug === matchingCategory.slug
      );
      if (firstArticle) {
        currentArticle = firstArticle;
      }
    }
  }

  const isHubLanding = !currentArticle;

  return (
    <div className="relative min-h-screen bg-surface text-on-surface flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 md:px-6 pt-24 pb-16">
        {/* Header Search Section */}
        <div className="mb-8 flex flex-col items-center text-center space-y-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-semibold text-primary">
            <span>📚</span>
            <span>
              {locale === "es"
                ? "Centro de Ayuda y Documentación"
                : "Help Center & Documentation"}
            </span>
          </div>

          <h1 className="font-display text-3xl md:text-5xl font-extrabold tracking-tight text-on-surface max-w-2xl">
            {locale === "es"
              ? "¿Cómo podemos ayudarte hoy?"
              : "How can we help you today?"}
          </h1>

          <div className="w-full flex justify-center pt-2">
            <DocsSearch locale={locale} />
          </div>
        </div>

        {/* Dynamic Body: Landing Hub vs Article View */}
        {isHubLanding ? (
          <div className="space-y-12 animate-fade-in">
            {/* 4 Category Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {DOC_CATEGORIES.map((cat) => {
                const targetLocale = (locale === "es" ? "es" : "en") as
                  | "en"
                  | "es";
                const title = cat.title[targetLocale] || cat.title.en;
                const desc =
                  cat.description[targetLocale] || cat.description.en;
                const firstArticle = DOC_ARTICLES.find(
                  (a) => a.categorySlug === cat.slug
                );
                const targetSlug = firstArticle
                  ? `/docs/${cat.slug}/${firstArticle.slug}`
                  : `/docs/${cat.slug}`;

                return (
                  <Link
                    key={cat.slug}
                    href={targetSlug}
                    className="group rounded-2xl bg-surface-container-low border border-outline-variant/20 p-6 hover:border-primary/50 transition-all shadow-lg hover:shadow-2xl hover:-translate-y-1 flex flex-col justify-between"
                  >
                    <div className="space-y-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-surface-container-high text-2xl group-hover:scale-110 transition">
                        {cat.icon}
                      </div>
                      <h3 className="font-display text-lg font-bold text-on-surface group-hover:text-primary transition">
                        {title}
                      </h3>
                      <p className="text-sm text-on-surface-variant leading-relaxed">
                        {desc}
                      </p>
                    </div>

                    <div className="mt-6 flex items-center gap-1 text-sm font-semibold text-primary group-hover:underline">
                      <span>{locale === "es" ? "Explorar" : "Explore"}</span>
                      <span>→</span>
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* Popular Quick Links Section */}
            <div className="rounded-2xl bg-surface-container-low/50 border border-outline-variant/20 p-6 md:p-8 space-y-6">
              <h2 className="font-display text-xl font-bold text-on-surface flex items-center gap-2">
                <span>🔥</span>
                {locale === "es"
                  ? "Artículos Populares y Guías Rápidas"
                  : "Popular Articles & Quick Guides"}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Link
                  href="/docs/1-getting-started/wallet-setup"
                  className="rounded-xl bg-surface-container-high/60 p-4 border border-outline-variant/20 hover:border-primary/40 transition"
                >
                  <span className="text-xs sm:text-sm font-bold text-primary block mb-1">
                    🚀 Getting Started
                  </span>
                  <h4 className="font-semibold text-sm sm:text-base text-on-surface">
                    {locale === "es"
                      ? "Configurar Billetera Solana"
                      : "Setting Up Phantom / Solflare"}
                  </h4>
                  <p className="text-sm text-on-surface-variant mt-1 line-clamp-2">
                    {locale === "es"
                      ? "Guía para instalar tu billetera y mantener tus fondos seguros."
                      : "Step-by-step guide to installing and securing your wallet."}
                  </p>
                </Link>

                <Link
                  href="/docs/2-protocol-mechanics/how-it-works"
                  className="rounded-xl bg-surface-container-high/60 p-4 border border-outline-variant/20 hover:border-primary/40 transition"
                >
                  <span className="text-xs sm:text-sm font-bold text-primary block mb-1">
                    ⚙️ Protocol Mechanics
                  </span>
                  <h4 className="font-semibold text-sm sm:text-base text-on-surface">
                    {locale === "es"
                      ? "Generación de Rendimiento Huma"
                      : "Huma Finance Yield Flow"}
                  </h4>
                  <p className="text-sm text-on-surface-variant mt-1 line-clamp-2">
                    {locale === "es"
                      ? "Cómo los depósitos generan intereses para los botes de premios sin riesgo."
                      : "How deposits generate zero-loss interest for weekly prize draws."}
                  </p>
                </Link>

                <Link
                  href="/docs/4-troubleshooting/common-errors"
                  className="rounded-xl bg-surface-container-high/60 p-4 border border-outline-variant/20 hover:border-primary/40 transition"
                >
                  <span className="text-xs sm:text-sm font-bold text-primary block mb-1">
                    🛠️ Troubleshooting
                  </span>
                  <h4 className="font-semibold text-sm sm:text-base text-on-surface">
                    {locale === "es"
                      ? "Decodificador de Errores"
                      : "Self-Service Error Decoder"}
                  </h4>
                  <p className="text-sm text-on-surface-variant mt-1 line-clamp-2">
                    {locale === "es"
                      ? "Busca códigos de error de Solscan para encontrar soluciones."
                      : "Lookup error codes or hashes to get step-by-step resolution advice."}
                  </p>
                </Link>
              </div>
            </div>
          </div>
        ) : currentArticle ? (
          <div className="flex flex-col lg:flex-row gap-8 items-start">
            <DocsSidebar
              currentCategorySlug={currentArticle.categorySlug}
              currentArticleSlug={currentArticle.slug}
              locale={locale}
            />
            <DocArticleViewer article={currentArticle} locale={locale} />
          </div>
        ) : null}
      </main>

      <Footer />
    </div>
  );
}
