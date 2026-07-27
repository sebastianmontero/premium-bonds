"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { Link } from "@/i18n/routing";
import { useTranslations } from "next-intl";

export function HeroSection() {
  const { status } = useWalletConnection();
  const t = useTranslations("Hero");

  return (
    <section className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-6 pt-24 pb-16 text-center">
      {/* Atmospheric background glows */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 h-[600px] w-[600px] rounded-full bg-secondary/6 blur-[140px]" />
        <div className="absolute top-1/2 left-1/2 h-[300px] w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-tertiary/4 blur-[100px]" />
      </div>

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-3xl space-y-8">
        {/* Badge */}
        <div className="inline-flex items-center gap-2 rounded-full bg-secondary-container/30 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-secondary animate-yield-pulse" />
          {t("pillTag")}
        </div>

        {/* Headline */}
        <h1 className="font-display text-5xl font-bold leading-[1.1] tracking-tight text-on-surface sm:text-6xl lg:text-7xl">
          {t("titleLine1")}{" "}
          <span className="text-gradient">{t("titleLine2")}</span>
        </h1>

        {/* Subheadline */}
        <p className="mx-auto max-w-xl text-lg leading-relaxed text-on-surface-variant">
          {t("subtitle")}
        </p>

        {/* CTAs */}
        <div className="flex flex-wrap items-center justify-center gap-4 pt-2">
          {status === "connected" ? (
            <>
              <Link
                href="/dashboard"
                className="btn-gradient rounded-xl px-8 py-3.5 text-base cursor-pointer"
              >
                {t("launchDashboard")}
              </Link>
              <a
                href="#how-it-works"
                className="btn-ghost rounded-xl px-8 py-3.5 text-base cursor-pointer"
              >
                {t("exploreFeatures")}
              </a>
            </>
          ) : (
            <>
              <Link
                href="/dashboard"
                className="btn-gradient rounded-xl px-8 py-3.5 text-base cursor-pointer"
              >
                {t("launchDashboard")}
              </Link>
              <a
                href="#how-it-works"
                className="btn-ghost rounded-xl px-8 py-3.5 text-base cursor-pointer"
              >
                {t("exploreFeatures")}
              </a>
            </>
          )}
        </div>

        {/* Social proof / protocol stats teaser */}
        <div className="flex flex-wrap items-center justify-center gap-6 pt-6 text-sm text-on-surface-variant">
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-tertiary"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            {t("zeroLossProtocol")}
          </div>
          <div className="hidden sm:block h-4 w-px bg-outline-variant/30" />
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-primary"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
            {t("weeklyDraws")}
          </div>
          <div className="hidden sm:block h-4 w-px bg-outline-variant/30" />
          <div className="flex items-center gap-2">
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-secondary"
            >
              <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
            </svg>
            {t("poweredByHuma")}
          </div>
        </div>
      </div>
    </section>
  );
}
