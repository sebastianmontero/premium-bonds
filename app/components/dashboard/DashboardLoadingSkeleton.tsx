"use client";

import React from "react";
import { useTranslations } from "next-intl";

export function DashboardLoadingSkeleton() {
  const t = useTranslations("Dashboard");

  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label={t("loadingPoolState")}
    >
      {/* ── 1. Hero Row Skeleton (4 metric cards) ────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="card p-5 rounded-2xl bg-surface-container/40 border border-outline-variant/10 min-h-[140px] flex flex-col justify-between"
          >
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 bg-surface-container-high/60 rounded-full" />
              <div className="h-8 w-8 bg-surface-container-high/40 rounded-xl" />
            </div>
            <div className="space-y-2">
              <div className="h-6 w-32 bg-surface-container-high/80 rounded-lg" />
              <div className="h-3 w-20 bg-surface-container-high/40 rounded-full" />
            </div>
          </div>
        ))}
      </div>

      {/* ── 2. Two-Column Row (PoolCard + ActivityFeed) ──────────────── */}
      <div className="grid gap-6 lg:grid-cols-5 items-stretch">
        {/* PoolCard column (3 of 5 columns) */}
        <div className="lg:col-span-3 flex flex-col">
          {/* Section Header */}
          <div className="flex items-center gap-2 mb-4 px-1 shrink-0">
            <div className="h-4.5 w-4.5 rounded-full bg-surface-container-high/50" />
            <div className="h-5 w-28 bg-surface-container-high/70 rounded-lg" />
          </div>

          <div className="card p-6 rounded-2xl bg-surface-container/40 border border-outline-variant/10 space-y-5 flex-1">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-11 w-11 rounded-xl bg-surface-container-high/60" />
                <div className="space-y-2">
                  <div className="h-5 w-36 bg-surface-container-high/80 rounded-lg" />
                  <div className="h-3 w-28 bg-surface-container-high/40 rounded-full" />
                </div>
              </div>
              <div className="h-6 w-16 bg-surface-container-high/40 rounded-full" />
            </div>

            {/* 6 Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[0, 1, 2, 3, 4, 5].map((idx) => (
                <div key={idx} className="space-y-1.5">
                  <div className="h-2.5 w-18 bg-surface-container-high/40 rounded-full" />
                  <div className="h-6 w-24 bg-surface-container-high/70 rounded-lg" />
                </div>
              ))}
            </div>

            {/* Countdown / Threshold status box */}
            <div className="rounded-xl bg-surface-container/80 px-4 py-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="h-3 w-16 bg-surface-container-high/40 rounded-full" />
                <div className="h-4 w-32 bg-surface-container-high/60 rounded-md" />
              </div>
              <div className="pt-2 border-t border-outline-variant/10">
                <div className="h-3 w-40 bg-surface-container-high/30 rounded-full" />
              </div>
            </div>

            {/* Prize Tiers */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="h-3 w-20 bg-surface-container-high/40 rounded-full" />
                <div className="h-3 w-24 bg-surface-container-high/40 rounded-full" />
              </div>
              <div className="flex flex-wrap gap-2.5">
                {[0, 1, 2].map((idx) => (
                  <div
                    key={idx}
                    className="flex-1 min-w-[110px] min-h-[72px] rounded-lg bg-surface-container/60 p-2 space-y-2 border border-surface-container-high/40 flex flex-col justify-between"
                  >
                    <div className="h-3.5 w-12 bg-surface-container-high/50 rounded mx-auto" />
                    <div className="h-3 w-16 bg-surface-container-high/70 rounded mx-auto" />
                    <div className="h-2 w-14 bg-surface-container-high/30 rounded mx-auto" />
                  </div>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="space-y-2.5 pt-1">
              <div className="flex gap-3">
                <div className="h-11 flex-1 bg-surface-container-high/60 rounded-xl" />
                <div className="h-11 flex-1 bg-surface-container-high/30 rounded-xl" />
              </div>
              <div className="h-3 w-44 bg-surface-container-high/30 rounded-full mx-auto" />
            </div>
          </div>
        </div>

        {/* ActivityFeed column (2 of 5 columns) */}
        <div className="lg:col-span-2 flex flex-col">
          {/* Section Header */}
          <div className="flex items-center gap-2 mb-4 px-1 shrink-0">
            <div className="h-4.5 w-4.5 rounded-full bg-surface-container-high/50" />
            <div className="h-5 w-32 bg-surface-container-high/70 rounded-lg" />
          </div>

          <div className="card p-6 rounded-2xl bg-surface-container/40 border border-outline-variant/10 flex-1 flex flex-col space-y-4">
            <div className="space-y-3 flex-1">
              {[0, 1, 2, 3, 4].map((j) => (
                <div
                  key={j}
                  className="p-3 rounded-xl bg-surface-container-lowest/40 border border-outline-variant/5 flex items-center justify-between"
                >
                  <div className="space-y-1.5">
                    <div className="h-3 w-28 bg-surface-container-high/60 rounded-full" />
                    <div className="h-2.5 w-16 bg-surface-container-high/30 rounded-full" />
                  </div>
                  <div className="h-4 w-12 bg-surface-container-high/50 rounded-md" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
