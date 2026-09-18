"use client";

import type { ActivityEntry } from "@/app/types";
import { TxExplorerLink } from "@/app/components/common/TxExplorerLink";
import { useTranslations, useFormatter } from "next-intl";
import { renderLocalizedActivityDescription } from "@/app/lib/i18n-helpers";
import { formatLocalDate } from "@/app/lib/formatters";
import { dotColor, typeIcon } from "./activity-utils";

interface ActivityFeedProps {
  entries: ActivityEntry[];
  onViewCompleteFeed?: () => void;
  isLoading?: boolean;
}

export function ActivityFeed({
  entries,
  onViewCompleteFeed,
  isLoading = false,
}: ActivityFeedProps) {
  const t = useTranslations("Activity");
  const format = useFormatter();

  const formatFeedDate = (isoDate: string): string => {
    return formatLocalDate(
      isoDate,
      { month: "short", day: "numeric" },
      format.dateTime
    );
  };

  const PREVIEW_LIMIT = 10;
  const previewEntries = entries.slice(0, PREVIEW_LIMIT);

  return (
    <div className="glass rounded-2xl p-6 h-[460px] lg:h-full flex flex-col min-h-0">
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
        <div className="flex-1 min-h-0 overflow-y-auto pe-1 space-y-0 scroll-smooth">
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
                      {renderLocalizedActivityDescription(entry, t)}
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
