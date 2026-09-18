import {
  getMessages,
  getTranslations,
  setRequestLocale,
} from "next-intl/server";
import { NextIntlClientProvider } from "next-intl";
import { notFound } from "next/navigation";
import { routing } from "@/i18n/routing";
import { GlobalRealtimePushSync } from "@/app/components/realtime/GlobalRealtimePushSync";
import { HtmlLangDirSync } from "@/app/components/common/HtmlLangDirSync";

type SupportedLocale = (typeof routing.locales)[number];

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!routing.locales.includes(locale as SupportedLocale)) {
    return {};
  }

  const t = await getTranslations({ locale, namespace: "Metadata" });
  const isDefaultLocale = locale === routing.defaultLocale;

  return {
    title: t("title"),
    description: t("description"),
    icons: {
      icon: "/icon.svg",
      shortcut: "/icon.svg",
      apple: "/icon.svg",
    },
    alternates: {
      canonical: isDefaultLocale ? "/" : `/${locale}`,
      languages: {
        en: "/",
        es: "/es",
        "x-default": "/",
      },
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!routing.locales.includes(locale as SupportedLocale)) {
    notFound();
  }

  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <HtmlLangDirSync />
      <GlobalRealtimePushSync />
      {children}
    </NextIntlClientProvider>
  );
}
