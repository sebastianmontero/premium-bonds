"use client";

import React from "react";

export function DashboardLoadingSkeleton() {
  return (
    <div
      className="space-y-6 animate-pulse"
      aria-busy="true"
      aria-label="Loading pool state"
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
        {/* PoolCard skeleton: takes 3 of 5 columns (~420px) */}
        <div className="lg:col-span-3 card p-6 rounded-2xl bg-surface-container/40 border border-outline-variant/10 min-h-[420px] flex flex-col justify-between space-y-6">
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

          <div className="grid grid-cols-2 gap-4 py-4 border-y border-outline-variant/10">
            <div className="space-y-2">
              <div className="h-3 w-20 bg-surface-container-high/40 rounded-full" />
              <div className="h-6 w-28 bg-surface-container-high/70 rounded-lg" />
            </div>
            <div className="space-y-2">
              <div className="h-3 w-24 bg-surface-container-high/40 rounded-full" />
              <div className="h-6 w-28 bg-surface-container-high/70 rounded-lg" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="h-3 w-24 bg-surface-container-high/40 rounded-full" />
            <div className="h-8 w-full bg-surface-container-high/30 rounded-xl" />
          </div>

          <div className="flex gap-3 pt-2">
            <div className="h-11 flex-1 bg-surface-container-high/60 rounded-xl" />
            <div className="h-11 flex-1 bg-surface-container-high/30 rounded-xl" />
          </div>
        </div>

        {/* ActivityFeed skeleton: takes 2 of 5 columns */}
        <div className="lg:col-span-2 card p-6 rounded-2xl bg-surface-container/40 border border-outline-variant/10 min-h-[420px] flex flex-col space-y-4">
          <div className="h-5 w-32 bg-surface-container-high/70 rounded-lg" />
          <div className="space-y-3 pt-2 flex-1">
            {[0, 1, 2, 3].map((j) => (
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
  );
}
