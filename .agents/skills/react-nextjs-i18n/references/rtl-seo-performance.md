# Reference Guide: RTL, SEO (hreflang), Bundle Optimization & TMS Pipelines

---

## 1. Right-to-Left (RTL) & Directionality Best Practices

Languages like Arabic (`ar`), Hebrew (`he`), Farsi (`fa`), and Urdu (`ur`) render right-to-left. To support both LTR and RTL seamlessly, follow these rules:

### Rule 1: Dynamic HTML Attributes

In `app/[locale]/layout.tsx`, detect RTL locales and set `dir="rtl"` on `<html>`.

```tsx
const RTL_LOCALES = ["ar", "he", "fa", "ur"];

export default async function Layout({ children, params }) {
  const { locale } = await params;
  const dir = RTL_LOCALES.includes(locale) ? "rtl" : "ltr";

  return (
    <html lang={locale} dir={dir}>
      <body>{children}</body>
    </html>
  );
}
```

### Rule 2: CSS Logical Properties (Tailwind CSS v4 & Standard CSS)

Never use physical directional classes (`left`, `right`, `pl-*`, `mr-*`). Use logical equivalent utilities that adapt automatically when `dir="rtl"` is set.

| Physical Class (Avoid) | Logical Class (Use) | CSS Equivalent                 |
| :--------------------- | :------------------ | :----------------------------- |
| `ml-4`                 | `ms-4`              | `margin-inline-start: 1rem`    |
| `mr-4`                 | `me-4`              | `margin-inline-end: 1rem`      |
| `pl-6`                 | `ps-6`              | `padding-inline-start: 1.5rem` |
| `pr-6`                 | `pe-6`              | `padding-inline-end: 1.5rem`   |
| `left-0`               | `start-0`           | `inset-inline-start: 0`        |
| `right-0`              | `end-0`             | `inset-inline-end: 0`          |
| `text-left`            | `text-start`        | `text-align: start`            |
| `text-right`           | `text-end`          | `text-align: end`              |

### Rule 3: Directional Icon Flipping

Directional icons (e.g., back buttons, forward arrows, chevrons) must be flipped in RTL mode:

```tsx
// Flips chevron-right 180 degrees in RTL
<ChevronRightIcon className="w-5 h-5 rtl:rotate-180 transition-transform" />
```

---

## 2. International SEO & Metadata (`hreflang`)

Proper SEO implementation ensures search engines serve the correct localized version of your pages without duplicate content penalties.

### Dynamic `generateMetadata` with `alternates`

```tsx
// app/[locale]/products/[id]/page.tsx
import { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; id: string }>;
}): Promise<Metadata> {
  const { locale, id } = await params;
  const t = await getTranslations({ locale, namespace: "ProductDetail" });

  const baseUrl = "https://example.com";

  return {
    title: t("metaTitle", { id }),
    description: t("metaDescription"),
    alternates: {
      canonical: `${baseUrl}/${locale}/products/${id}`,
      languages: {
        en: `${baseUrl}/en/products/${id}`,
        es: `${baseUrl}/es/products/${id}`,
        ar: `${baseUrl}/ar/products/${id}`,
        "x-default": `${baseUrl}/en/products/${id}`,
      },
    },
  };
}
```

### Localized `sitemap.ts` (`app/sitemap.ts`)

```typescript
import { MetadataRoute } from "next";

const locales = ["en", "es", "ar"];
const defaultLocale = "en";
const host = "https://example.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const routes = ["", "/about", "/pricing"];

  return routes.flatMap((route) => {
    return locales.map((locale) => {
      const isDefault = locale === defaultLocale;
      const url = isDefault ? `${host}${route}` : `${host}/${locale}${route}`;

      return {
        url,
        lastModified: new Date(),
        alternates: {
          languages: Object.fromEntries(
            locales.map((loc) => [
              loc,
              loc === defaultLocale
                ? `${host}${route}`
                : `${host}/${loc}${route}`,
            ])
          ),
        },
      };
    });
  });
}
```

---

## 3. Bundle Size & Performance Optimization

1. **Zero Client Bundle Cost (RSC)**: Keep page translations inside React Server Components (`getTranslations`). The client receives pre-rendered static HTML with zero translation JSON payload!
2. **Namespace Lazy-Loading**: Split large translation files into domain namespaces (`common.json`, `dashboard.json`, `checkout.json`). Load only what is needed per request.
3. **Static Generation (`generateStaticParams`)**: Pre-build localized HTML at build time for instant CDN edge delivery.

```tsx
// Pre-render static pages for all supported locales
export function generateStaticParams() {
  return [{ locale: "en" }, { locale: "es" }, { locale: "ar" }];
}
```

---

## 4. Continuous Translation Pipelines & TMS Integration

Automate translation extraction and synchronization using Translation Management Systems (TMS):

```
┌─────────────────┐       Git Push      ┌──────────────────┐
│ Source Code     │ ──────────────────► │ Key Extractor    │
│ (t('nav.title'))│                     │ (@formatjs/cli)  │
└─────────────────┘                     └────────┬─────────┘
                                                 │
                                                 ▼
┌─────────────────┐    Auto-PR / Sync   ┌──────────────────┐
│ Web App         │ ◄────────────────── │ TMS (Crowdin /   │
│ Production      │                     │ Phrase / Inlang) │
└─────────────────┘                     └──────────────────┘
```

### Recommended Workflow:

1. **Developer**: Uses `t('key')` in TypeScript/React code.
2. **CI Check**: Runs `npm run i18n:extract` or `inlang lint` to ensure no keys are missing or malformed.
3. **TMS Sync**: Automated GitHub Action syncs updated `en.json` keys to translators.
4. **Automated PR**: Translation platform submits a PR back to the repository when translations reach 100%.
