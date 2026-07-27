"use client";

import type { ActivityEntry, ActivityType } from "@/app/types";
import { TxExplorerLink } from "@/app/components/common/TxExplorerLink";
import { useTranslations, useLocale } from "next-intl";
import { formatLocalizedActivityDescription } from "@/app/lib/i18n-helpers";

interface ActivityFeedProps {
  entries: ActivityEntry[];
  onViewCompleteFeed?: () => void;
  isLoading?: boolean;
}

function dotColor(type: ActivityType): string {
  switch (type) {
    case "deposit":
      return "border-primary";
    case "win":
      return "border-secondary";
    case "auto-reinvest":
      return "border-tertiary";
    case "withdraw":
      return "border-error";
    case "claim-redemption":
      return "border-primary-dim";
  }
}

function typeIcon(type: ActivityType) {
  switch (type) {
    case "deposit":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary"
        >
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      );
    case "win":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-secondary"
        >
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      );
    case "auto-reinvest":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-tertiary"
        >
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15A9 9 0 115.64 5.64L1 10" />
        </svg>
      );
    case "withdraw":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-error"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      );
    case "claim-redemption":
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-primary-dim"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
      );
  }
}

function formatFeedDate(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function ActivityFeed({
  entries,
  onViewCompleteFeed,
  isLoading = false,
}: ActivityFeedProps) {
  const t = useTranslations("Activity");
  const locale = useLocale();
  const PREVIEW_LIMIT = 10;
  const previewEntries = entries.slice(0, PREVIEW_LIMIT);

  return (
    <div className="glass-strong rounded-2xl p-6 h-full max-h-[460px] flex flex-col min-h-0">
      {isLoading ? (
        <div
          className="flex-1 min-h-0 space-y-3 pointer-events-none select-none"
          aria-hidden="true"
        >
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="flex items-center gap-3 p-3 rounded-xl skeleton-card"
            >
              <div className="w-8 h-8 rounded-lg skeleton-box shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-36 rounded-md skeleton-box" />
                  <div className="h-3 w-16 rounded-md skeleton-box" />
                </div>
                <div className="h-3.5 w-48 rounded-md skeleton-box" />
              </div>
            </div>
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center my-auto border border-dashed border-on-surface-variant/10 rounded-xl bg-surface-container/20">
          <svg
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-on-surface-variant/40 mb-2"
          >
            <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
          </svg>
          <p className="text-xs font-semibold text-on-surface-variant">
            {t("noActivity")}
          </p>
          <p className="text-[10px] text-on-surface-variant/60 max-w-[200px] mt-0.5">
            {t("noActivitySub")}
          </p>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-0 scroll-smooth">
          {previewEntries.map((entry) => (
            <div key={entry.id} className="timeline-item py-3">
              {/* Timeline dot */}
              <div className={`timeline-dot ${dotColor(entry.type)}`} />

              {/* Content */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  {typeIcon(entry.type)}
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-xs font-medium text-on-surface-variant"
                      suppressHydrationWarning
                    >
                      {formatFeedDate(entry.date)}
                    </p>
                    <p className="text-sm text-on-surface mt-0.5 leading-relaxed">
                      {formatLocalizedActivityDescription(
                        entry.description,
                        locale
                      )}
                    </p>
                  </div>
                </div>
                {entry.txSignature && (
                  <TxExplorerLink
                    signature={entry.txSignature}
                    variant="compact"
                    showCopy={false}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {entries.length > 0 && onViewCompleteFeed && (
        <div className="text-center pt-3 border-t border-surface-bright/5 mt-3 shrink-0">
          <button
            onClick={onViewCompleteFeed}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-on-surface-variant hover:text-primary transition cursor-pointer"
          >
            <svg
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
              />
            </svg>
            <span>{t("searchAndFilter")}</span>
          </button>
        </div>
      )}
    </div>
  );
}
