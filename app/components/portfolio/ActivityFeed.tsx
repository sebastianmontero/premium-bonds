"use client";

import type { ActivityEntry, ActivityType } from "@/app/types";

interface ActivityFeedProps {
  entries: ActivityEntry[];
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

export function ActivityFeed({ entries }: ActivityFeedProps) {
  return (
    <div className="glass-strong rounded-2xl p-6 h-full flex flex-col">
      {entries.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center h-full border border-dashed border-on-surface-variant/10 rounded-xl bg-surface-container/20">
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
            No activity yet
          </p>
          <p className="text-[10px] text-on-surface-variant/60 max-w-[200px] mt-0.5">
            Your transactions, prize claims, and reinvestment events will be
            logged here.
          </p>
        </div>
      ) : (
        <div className="space-y-0">
          {entries.map((entry) => (
            <div key={entry.id} className="timeline-item py-3">
              {/* Timeline dot */}
              <div className={`timeline-dot ${dotColor(entry.type)}`} />

              {/* Content */}
              <div className="flex items-start gap-2">
                {typeIcon(entry.type)}
                <div className="flex-1 min-w-0">
                  <p
                    className="text-xs font-medium text-on-surface-variant"
                    suppressHydrationWarning
                  >
                    {formatFeedDate(entry.date)}
                  </p>
                  <p className="text-sm text-on-surface mt-0.5 leading-relaxed">
                    {entry.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
