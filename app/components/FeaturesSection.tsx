const FEATURES = [
  {
    title: "Zero-Loss Protocol",
    description: "Your principal is never at risk. Withdraw your full deposit at any time.",
    icon: "shield",
    color: "text-tertiary",
    bgColor: "bg-tertiary/10",
  },
  {
    title: "Powered by Kamino",
    description: "Deposits are routed into Kamino Lending for optimal yield generation.",
    icon: "bolt",
    color: "text-primary",
    bgColor: "bg-primary/10",
  },
  {
    title: "Instant Withdrawals",
    description: "Sell your bonds and reclaim your USDC instantly. No lockups or penalties.",
    icon: "clock",
    color: "text-secondary",
    bgColor: "bg-secondary/10",
  },
  {
    title: "On-Chain Transparency",
    description: "Every draw, winner, and payout is recorded on-chain. Fully auditable.",
    icon: "eye",
    color: "text-tertiary",
    bgColor: "bg-tertiary/10",
  },
];

function FeatureIcon({ name, className }: { name: string; className?: string }) {
  const props = { width: 24, height: 24, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className };
  switch (name) {
    case "shield": return <svg {...props}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>;
    case "bolt": return <svg {...props}><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>;
    case "clock": return <svg {...props}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    case "eye": return <svg {...props}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>;
    default: return null;
  }
}

export function FeaturesSection() {
  return (
    <section id="features" className="relative px-6 py-24">
      <div className="mx-auto max-w-2xl text-center space-y-4 mb-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-secondary">Features</p>
        <h2 className="font-display text-3xl font-bold tracking-tight text-on-surface sm:text-4xl">
          Designed for trust and transparency
        </h2>
        <p className="text-base text-on-surface-variant leading-relaxed">
          Every element of the protocol protects your funds while maximizing your chances to win.
        </p>
      </div>

      <div className="mx-auto grid max-w-5xl gap-6 sm:grid-cols-2">
        {FEATURES.map((f) => (
          <div key={f.title} className="group relative rounded-2xl bg-surface-container p-8 space-y-4 transition-all duration-300 hover:-translate-y-1 hover:bg-surface-container-high">
            <div className="absolute inset-x-0 top-0 h-px rounded-t-2xl bg-gradient-to-r from-transparent via-primary/30 to-transparent" />
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${f.bgColor} ${f.color} transition-transform group-hover:scale-110`}>
              <FeatureIcon name={f.icon} />
            </div>
            <h3 className="font-display text-lg font-bold text-on-surface">{f.title}</h3>
            <p className="text-sm leading-relaxed text-on-surface-variant">{f.description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
