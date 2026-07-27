"use client";

import { useTranslations } from "next-intl";

const ACCENT_COLORS = {
  primary: {
    bg: "bg-primary/10",
    text: "text-primary",
    line: "bg-primary/40",
  },
  secondary: {
    bg: "bg-secondary/10",
    text: "text-secondary",
    line: "bg-secondary/40",
  },
  tertiary: {
    bg: "bg-tertiary/10",
    text: "text-tertiary",
    line: "bg-tertiary/40",
  },
};

export function HowItWorksSection() {
  const t = useTranslations("HowItWorks");

  const steps = [
    {
      step: "01",
      title: t("step1Title"),
      description: t("step1Desc"),
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" />
        </svg>
      ),
      accent: "primary" as const,
    },
    {
      step: "02",
      title: t("step2Title"),
      description: t("step2Desc"),
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
          <polyline points="17 6 23 6 23 12" />
        </svg>
      ),
      accent: "secondary" as const,
    },
    {
      step: "03",
      title: t("step3Title"),
      description: t("step3Desc"),
      icon: (
        <svg
          width="28"
          height="28"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
      ),
      accent: "tertiary" as const,
    },
  ];

  return (
    <section id="how-it-works" className="relative px-6 py-24">
      {/* Section header */}
      <div className="mx-auto max-w-2xl text-center space-y-4 mb-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">
          {t("tag")}
        </p>
        <h2 className="font-display text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
          {t("title")}
        </h2>
        <p className="text-base text-on-surface-variant leading-relaxed">
          {t("subtitle")}
        </p>
      </div>

      {/* Steps grid */}
      <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-3">
        {steps.map((s) => {
          const colors = ACCENT_COLORS[s.accent];
          return (
            <div
              key={s.step}
              className="group relative rounded-2xl bg-surface-container-low p-8 space-y-5 transition-all duration-300 hover:-translate-y-1 hover:bg-surface-container"
            >
              {/* Step number */}
              <span className="text-xs font-bold tracking-widest text-on-surface-variant/50">
                {t("step")} {s.step}
              </span>

              {/* Icon circle */}
              <div
                className={`flex h-14 w-14 items-center justify-center rounded-xl ${colors.bg} ${colors.text} transition-transform group-hover:scale-110`}
              >
                {s.icon}
              </div>

              {/* Title */}
              <h3 className="font-display text-xl font-bold text-on-surface">
                {s.title}
              </h3>

              {/* Description */}
              <p className="text-sm leading-relaxed text-on-surface-variant">
                {s.description}
              </p>

              {/* Decorative bottom line */}
              <div
                className={`h-0.5 w-12 rounded-full ${colors.line} transition-all group-hover:w-20`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
