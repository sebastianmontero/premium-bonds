---
name: react-nextjs-i18n
description: Complete playbook and best practices for localizing React 19 and Next.js 15/16 App Router applications. Use when designing i18n architecture, setting up next-intl or Paraglide, configuring middleware, handling async params, writing type-safe translations, formatting dates/numbers/currencies with ICU MessageFormat, implementing RTL directionality with CSS logical properties, or setting up hreflang SEO metadata.
user-invocable: true
license: MIT
metadata:
  author: Community & Antigravity
  version: 1.0.0
---

# React & Next.js Localization (i18n) Playbook

## What this Skill is for

Use this Skill when:

- Designing or auditing internationalization (i18n) & localization (l10n) in React 19 or Next.js 14/15/16 App Router applications.
- Setting up `next-intl`, `Paraglide JS`, or `react-i18next` with `app/[locale]/` directory routing and middleware.
- Migrating legacy Pages Router or client-side i18n to React Server Components (RSC).
- Handling Next.js 15/16 async `params` (`Promise<{ locale: string }>`) in layouts, pages, and metadata.
- Formatting dynamic strings using ICU MessageFormat (plurals, select, genders, rich text tags).
- Implementing Right-to-Left (RTL) layout directionality (`dir="rtl"`) using CSS logical properties and Tailwind CSS.
- Configuring international SEO metadata (`generateMetadata`, `alternates.languages`, `hreflang`, localized `sitemap.ts`).
- Enforcing strict end-to-end TypeScript key safety and bundle size optimizations.

---

## Core Architectural Principles

### 1. Server Components First (Zero Client Bundle Cost)

Fetch and render translation dictionaries on the server using Server Components (e.g. `getTranslations` in `next-intl`). This delivers static, localized HTML to the browser with **0 KB of translation JS shipped to the client** and eliminates Flash of Untranslated Content (FOUT).

### 2. Strict End-to-End Type Safety

Never allow arbitrary string literals as translation keys. Configure global type definitions (e.g., `interface IntlMessages`) so TypeScript provides auto-completion for nested translation paths and raises compile errors for missing keys.

### 3. CSS Logical Properties for Seamless RTL Support

Avoid physical layout attributes (`margin-left`, `padding-right`, `left-0`). Use CSS logical properties (`margin-inline-start`, `padding-inline-end`, `start-0` / Tailwind `ms-*`, `ps-*`, `start-*`). Layouts automatically adapt to RTL languages (`ar`, `he`) without extra stylesheets.

### 4. International SEO & Metadata Compliance

Every localized page must expose `alternates.languages` (`hreflang`) metadata including `x-default` to instruct search engine crawlers on regional URL structures.

---

## Library Selection Matrix

```
                          ┌───────────────────────────┐
                          │   Next.js App Router?     │
                          └─────────────┬─────────────┘
                                        │
                    ┌───────────────────┴───────────────────┐
                    ▼                                       ▼
        ┌───────────────────────┐               ┌───────────────────────┐
        │  Standard App / RSC   │               │ Extreme Performance / │
        │      (next-intl)      │               │   Zero Runtime Cost   │
        └───────────┬───────────┘               │    (Paraglide JS)     │
                    │                           └───────────────────────┘
                    ▼
     - First-class Next.js integration
     - ICU MessageFormat standard
     - Easy async params support
```

- **`next-intl` (Recommended)**: Industry standard for Next.js App Router. Native RSC support, intuitive middleware, and strong TypeScript integration.
- **`Paraglide JS`**: Compiler-based, tree-shakable translation functions with zero runtime JSON parsing overhead.
- **`react-i18next`**: Best for enterprise projects migrating legacy i18next codebases or requiring locize backends.

---

## Quick-Start Workflow & Checklist

### 1. Directory Blueprint (`next-intl` App Router)

- `app/[locale]/layout.tsx` $\rightarrow$ Root layout accepting `params: Promise<{ locale: string }>`.
- `app/[locale]/page.tsx` $\rightarrow$ Localized page using `getTranslations`.
- `i18n/routing.ts` $\rightarrow$ `defineRouting` and `createNavigation` export (`Link`, `useRouter`, `usePathname`).
- `i18n/request.ts` $\rightarrow$ `getRequestConfig` loading `messages/${locale}.json`.
- `middleware.ts` $\rightarrow$ `createMiddleware(routing)` matching `/[locale]/` paths.
- `global.d.ts` $\rightarrow$ `interface IntlMessages extends Messages {}`.

### 2. Next.js 15/16 Async Params Standard

Always `await params` in layouts, pages, and metadata functions:

```tsx
// app/[locale]/layout.tsx
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  setRequestLocale(locale);
  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
```

### 3. Server Component Translation (`page.tsx`)

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("HomePage");

  return (
    <main className="p-6">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="mt-2 text-gray-600">{t("description")}</p>
    </main>
  );
}
```

### 4. Client Component Interactive Translation

```tsx
"use client";

import { useTranslations } from "next-intl";

export function ActionButton() {
  const t = useTranslations("Actions");
  return (
    <button className="px-4 py-2 bg-blue-600 text-white rounded">
      {t("save")}
    </button>
  );
}
```

---

## RTL & Logical CSS Cheat Sheet

When styling components, translate physical directions into logical properties:

```tsx
/* Bad (Physical - breaks in RTL) */
<div className="ml-4 pr-6 text-left left-0">

/* Good (Logical - auto-adapts to LTR & RTL) */
<div className="ms-4 pe-6 text-start start-0">
```

For directional icons (chevrons, back arrows):

```tsx
<ChevronIcon className="w-5 h-5 rtl:rotate-180 transition-transform" />
```

---

## Audit Checklist for Code Review

- [ ] **No Hardcoded Strings**: All user-facing text uses `t('key')` or `t.rich('key')`.
- [ ] **Async Params Awaited**: All Next.js 15/16 layouts/pages/metadata correctly `await params`.
- [ ] **Dynamic `html` Attributes**: `lang={locale}` and `dir="rtl"| "ltr"` are correctly set on `<html>`.
- [ ] **Logical Utilities Used**: Tailwind classes use `ms-*`, `me-*`, `ps-*`, `pe-*`, `text-start`, `start-*`.
- [ ] **`hreflang` Configured**: `generateMetadata` outputs `alternates.languages` with `x-default`.
- [ ] **Strict Typing**: `global.d.ts` extends `IntlMessages` to fail builds on missing keys.
- [ ] **No Raw HTML in JSON**: Rich text formatting uses `<tag>content</tag>` placeholders handled via `t.rich()`.

---

## Progressive Disclosure References (Read When Implementing)

For detailed step-by-step code implementations and deep dives, inspect:

- **[next-intl App Router Architecture](file://./references/next-intl-app-router.md)**: Full setup guide for Next.js 15/16, middleware, RSC, client components, navigation, and Server Actions.
- **[ICU Formatting Cheatsheet](file://./references/icu-formatting-cheat-sheet.md)**: Syntax reference for plurals, select enums, numbers, currencies, dates, relative time, and rich text tags.
- **[RTL, SEO & Bundle Optimization](file://./references/rtl-seo-performance.md)**: Detailed rules for RTL CSS logical properties, `generateMetadata` `hreflang`, localized sitemaps, and TMS CI/CD pipelines.
