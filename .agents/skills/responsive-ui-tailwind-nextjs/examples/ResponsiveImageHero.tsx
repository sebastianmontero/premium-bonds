import React from "react";
import Image from "next/image";

export interface ResponsiveImageHeroProps {
  title: string;
  subtitle: string;
  imageSrc: string;
  imageAlt: string;
  primaryCtaText: string;
  secondaryCtaText?: string;
  onPrimaryCta?: () => void;
  onSecondaryCta?: () => void;
}

/**
 * ResponsiveImageHero
 *
 * Demonstrates:
 * - Next.js 16 `next/image` with accurate `sizes` attribute to avoid mobile bandwidth bloat.
 * - `priority` flag for sub-second Largest Contentful Paint (LCP).
 * - Responsive aspect ratios (`aspect-4/3` on mobile -> `aspect-16/9` on tablet -> `aspect-21/9` on desktop).
 * - Accessible fluid typography using `clamp()`.
 * - Responsive layout positioning (bottom-sheet overlay on mobile -> split hero on desktop).
 */
export function ResponsiveImageHero({
  title,
  subtitle,
  imageSrc,
  imageAlt,
  primaryCtaText,
  secondaryCtaText,
  onPrimaryCta,
  onSecondaryCta,
}: ResponsiveImageHeroProps) {
  return (
    <section className="relative w-full overflow-hidden rounded-3xl bg-surface-container-lowest border border-outline-variant/50 shadow-ambient">
      {/* 
        Responsive Aspect Ratio Container:
        - Mobile: taller ratio (4:3) to allow readable overlay text without squishing.
        - Tablet: standard wide (16:9).
        - Desktop: cinematic widescreen (21:9).
      */}
      <div className="relative aspect-4/3 w-full sm:aspect-16/9 lg:aspect-21/9">
        <Image
          src={imageSrc}
          alt={imageAlt}
          fill
          priority // Highest priority for hero LCP candidate
          quality={80}
          // The crucial sizes attribute: instructs browser which srcset candidate to fetch
          sizes="(max-width: 640px) 100vw, (max-width: 1024px) 95vw, 1280px"
          className="object-cover object-center"
        />

        {/* Gradient backdrop ensuring contrast across both light and dark images */}
        <div className="absolute inset-0 bg-gradient-to-t from-surface via-surface/60 to-transparent sm:bg-gradient-to-r sm:from-surface sm:via-surface/75 sm:to-transparent" />

        {/* Content Container */}
        <div className="absolute inset-0 flex flex-col justify-end p-6 sm:justify-center sm:p-10 lg:p-16">
          <div className="max-w-xl space-y-4">
            <h1 className="font-display text-[clamp(1.75rem,2rem+2.5vw,3.25rem)] font-extrabold tracking-tight text-on-surface leading-[1.1]">
              {title}
            </h1>

            <p className="text-sm sm:text-base lg:text-lg text-on-surface-variant max-w-lg">
              {subtitle}
            </p>

            {/* Responsive Actions: Full-width stacked buttons on mobile, row on tablet+ */}
            <div className="flex flex-col gap-3 pt-2 sm:flex-row sm:items-center">
              <button
                type="button"
                onClick={onPrimaryCta}
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-primary px-6 py-3 text-base font-semibold text-on-primary transition-all hover:bg-primary-dim active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                {primaryCtaText}
              </button>

              {secondaryCtaText && (
                <button
                  type="button"
                  onClick={onSecondaryCta}
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-outline-variant bg-surface-container/80 px-6 py-3 text-base font-semibold text-on-surface transition-all hover:bg-surface-container-high active:scale-[0.98] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {secondaryCtaText}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
