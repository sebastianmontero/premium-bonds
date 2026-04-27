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
      return "border-amber-400";
    case "auto-reinvest":
      return "border-tertiary";
    case "withdraw":
      return "border-on-surface-variant";
  }
}

function typeIcon(type: ActivityType) {
  switch (type) {
    case "deposit":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
          <path d="M12 5v14M19 12l-7 7-7-7" />
        </svg>
      );
    case "win":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
          <circle cx="12" cy="8" r="7" />
          <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88" />
        </svg>
      );
    case "auto-reinvest":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-tertiary">
          <polyline points="23 4 23 10 17 10" />
          <path d="M20.49 15A9 9 0 115.64 5.64L1 10" />
        </svg>
      );
    case "withdraw":
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-on-surface-variant">
          <path d="M12 19V5M5 12l7-7 7 7" />
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
    <div className="glass-strong rounded-2xl p-6 space-y-4">
      <h2 className="font-display text-lg font-bold text-on-surface">
        Activity Feed
      </h2>

      <div className="space-y-0">
        {entries.map((entry) => (
          <div key={entry.id} className="timeline-item py-3">
            {/* Timeline dot */}
            <div className={`timeline-dot ${dotColor(entry.type)}`} />

            {/* Content */}
            <div className="flex items-start gap-2">
              {typeIcon(entry.type)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-on-surface-variant">
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
    </div>
  );
}
