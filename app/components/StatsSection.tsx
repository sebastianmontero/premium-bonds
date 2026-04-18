export function StatsSection() {
  return (
    <section id="prizes" className="relative px-6 py-24">
      <div className="mx-auto grid max-w-5xl gap-6 md:grid-cols-2">
        {/* Total Value Locked */}
        <div className="glass-strong rounded-2xl p-8 space-y-3 animate-float" style={{ animationDelay: "0s" }}>
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              Total Value Locked
            </p>
          </div>
          <p className="font-display text-4xl font-bold tracking-tight text-on-surface sm:text-5xl">
            $12,450,230
          </p>
          <p className="text-sm text-on-surface-variant">
            Across all active pools
          </p>
        </div>

        {/* Current Prize Pool */}
        <div className="glass-strong rounded-2xl p-8 space-y-3 animate-float" style={{ animationDelay: "1s" }}>
          <div className="flex items-center gap-2">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-secondary">
              <circle cx="12" cy="8" r="7"/>
              <polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>
            </svg>
            <p className="text-xs font-semibold uppercase tracking-widest text-on-surface-variant">
              Current Prize Pool
            </p>
          </div>
          <p className="font-display text-4xl font-bold tracking-tight text-gradient sm:text-5xl">
            $45,000
          </p>
          <div className="flex items-center gap-3 pt-1">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-secondary-container/30 px-3 py-1 text-xs font-semibold text-secondary animate-yield-pulse">
              <span className="h-1.5 w-1.5 rounded-full bg-secondary" />
              Live
            </span>
            <span className="text-sm text-on-surface-variant">
              Next draw in <span className="font-semibold text-on-surface">2d 14h 36m</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
