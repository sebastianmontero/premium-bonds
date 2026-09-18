"use client";

import { useEffect } from "react";
import { useLocale } from "next-intl";

const RTL_LOCALES = new Set(["ar", "he", "fa"]);

export function HtmlLangDirSync() {
  const locale = useLocale();

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = RTL_LOCALES.has(locale) ? "rtl" : "ltr";
  }, [locale]);

  return null;
}
