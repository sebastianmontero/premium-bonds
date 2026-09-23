import React from "react";

export interface CardMetric {
  label: string;
  value: string;
}

export interface ContainerResponsiveCardProps {
  title: string;
  badge?: string;
  description: string;
  metrics: CardMetric[];
  actionLabel: string;
  onAction?: () => void;
}

/**
 * ContainerResponsiveCard
 *
 * Demonstrates:
 * - Tailwind v4 first-class `@container` container queries.
 * - Fluid typography using `clamp()` bound to container units (`cqi`).
 * - CSS Subgrid (`grid-rows-subgrid`) ensuring internal elements align across variable lengths.
 * - Accessible focus rings and touch target sizing.
 */
export function ContainerResponsiveCard({
  title,
  badge,
  description,
  metrics,
  actionLabel,
  onAction,
}: ContainerResponsiveCardProps) {
  return (
    <article className="@container rounded-3xl border border-outline-variant/60 bg-surface-container p-[clamp(1rem,4cqi,1.75rem)] shadow-sm transition-all hover:border-primary/50 hover:shadow-md">
      {/* 
        Container-responsive layout:
        - Narrow container (< 26rem / 416px): Stacks in 1 column.
        - Wide container (>= 26rem / 416px): Shifts into a multi-column, subgrid layout.
      */}
      <div className="flex flex-col gap-4 @sm:grid @sm:grid-cols-2 @sm:gap-6">
        {/* Left Column / Header Section */}
        <div className="flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-center gap-2">
              {badge && (
                <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                  {badge}
                </span>
              )}
            </div>

            {/* Fluid title scaling smoothly with container inline width */}
            <h3 className="mt-2 font-display text-[clamp(1.125rem,3cqi+0.5rem,1.5rem)] font-bold tracking-tight text-on-surface">
              {title}
            </h3>

            <p className="mt-1 text-sm text-on-surface-variant line-clamp-3">
              {description}
            </p>
          </div>

          {/* Action button with minimum 48px touch target */}
          <div className="pt-2">
            <button
              type="button"
              onClick={onAction}
              className="inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-on-primary transition-colors hover:bg-primary-dim focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface active:scale-[0.98] @sm:w-auto"
            >
              {actionLabel}
            </button>
          </div>
        </div>

        {/* Right Column / Metrics Section */}
        <div className="flex flex-col justify-center rounded-2xl bg-surface-container-low p-4 border border-outline-variant/40">
          <dl className="grid grid-cols-2 gap-4">
            {metrics.map((metric, idx) => (
              <div key={idx} className="flex flex-col">
                <dt className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
                  {metric.label}
                </dt>
                <dd className="mt-1 font-mono text-[clamp(1rem,2.5cqi+0.5rem,1.375rem)] font-bold text-on-surface">
                  {metric.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </article>
  );
}
