# Reference Guide: `next-intl` App Router Architecture (Next.js 15 / 16)

This guide details the standard, production-ready architecture for internationalization using `next-intl` in Next.js 15/16 App Router with React 19.

---

## 1. Directory Structure

```text
my-app/
├── app/
│   └── [locale]/
│       ├── layout.tsx         # Root layout with dynamic lang & dir
│       ├── page.tsx           # Server Component page
│       ├── client-demo/
│       │   └── page.tsx       # Client Component page
│       └── actions.ts         # Server Actions with i18n
├── i18n/
│   ├── routing.ts             # Locale configuration & navigation utilities
│   └── request.ts             # Server-side message loader per request
├── messages/
│   ├── en.json                # English dictionary
│   ├── es.json                # Spanish dictionary
│   └── ar.json                # Arabic dictionary (RTL)
├── middleware.ts              # Locale detection & routing middleware
├── next.config.mjs            # next-intl plugin integration
└── global.d.ts                # TypeScript strict type definitions
```

---

## 2. Step-by-Step Configuration

### Step 2.1: `i18n/routing.ts`

Define supported locales, default locale, and exported localized navigation components.

```typescript
import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: ["en", "es", "ar"],
  defaultLocale: "en",
  localePrefix: "as-needed", // or 'always'
});

export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
```

### Step 2.2: `i18n/request.ts`

Configure how `next-intl` loads translation messages per request.

```typescript
import { getRequestConfig } from "next-intl/server";
import { routing } from "./routing";

export default getRequestConfig(async ({ requestLocale }) => {
  let locale = await requestLocale;

  // Validate locale or fall back to default
  if (!locale || !routing.locales.includes(locale as any)) {
    locale = routing.defaultLocale;
  }

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
```

### Step 2.3: `next.config.mjs`

Wrap Next.js configuration with the `next-intl` plugin.

```javascript
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/** @type {import('next').NextConfig} */
const nextConfig = {
  /* custom Next.js config */
};

export default withNextIntl(nextConfig);
```

### Step 2.4: `middleware.ts`

Intercept incoming requests to resolve locale prefixes and handle language negotiation.

```typescript
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

export default createMiddleware(routing);

export const config = {
  // Match only internationalized pathnames
  matcher: ["/", "/(ar|es|en)/:path*", "/((?!_next|_vercel|.*\\..*).*)"],
};
```

---

## 3. Component Layer Implementation

### Step 3.1: Root Layout (`app/[locale]/layout.tsx`) - Next.js 15/16

_Notice: `params` is typed as a Promise and explicitly awaited._

```tsx
import { setRequestLocale } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  // Ensure valid locale
  if (!routing.locales.includes(locale as any)) {
    notFound();
  }

  // Enable static rendering
  setRequestLocale(locale);

  const dir = locale === "ar" ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body>
        <main>{children}</main>
      </body>
    </html>
  );
}
```

### Step 3.2: Server Component Page (`app/[locale]/page.tsx`)

```tsx
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/routing";

export default async function HomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("HomePage");

  return (
    <section className="p-6">
      <h1 className="text-3xl font-bold">{t("welcome")}</h1>
      <p className="mt-2 text-gray-600">{t("description")}</p>

      <div className="mt-4">
        <Link href="/about" className="text-blue-500 hover:underline">
          {t("aboutLink")}
        </Link>
      </div>
    </section>
  );
}
```

### Step 3.3: Client Component Hook (`components/InteractiveCounter.tsx`)

```tsx
"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

export function InteractiveCounter() {
  const t = useTranslations("Counter");
  const [count, setCount] = useState(0);

  return (
    <div className="flex items-center space-x-4 rtl:space-x-reverse">
      <button
        onClick={() => setCount((c) => c - 1)}
        className="px-3 py-1 bg-gray-200 rounded"
      >
        -
      </button>
      <span>{t("currentCount", { count })}</span>
      <button
        onClick={() => setCount((c) => c + 1)}
        className="px-3 py-1 bg-blue-600 text-white rounded"
      >
        +
      </button>
    </div>
  );
}
```

---

## 4. End-to-End Strict Type Safety (`global.d.ts`)

Create `global.d.ts` at the root of the project to get strict auto-completion and error reporting for translation keys:

```typescript
import en from "./messages/en.json";

type Messages = typeof en;

declare global {
  // Use type safe messages across getTranslations & useTranslations
  interface IntlMessages extends Messages {}
}
```

---

## 5. Server Actions i18n

Server Actions accept the current locale to return localized error strings or notifications:

```typescript
"use server";

import { getTranslations } from "next-intl/server";

export async function submitContactForm(prevState: any, formData: FormData) {
  const locale = (formData.get("locale") as string) || "en";
  const t = await getTranslations({ locale, namespace: "Validation" });

  const email = formData.get("email");
  if (!email || !String(email).includes("@")) {
    return { success: false, error: t("invalidEmail") };
  }

  return { success: true, message: t("formSubmitted") };
}
```
