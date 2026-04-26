import type { Metadata } from "next";
import { DashboardSidebar } from "@/app/components/dashboard/DashboardSidebar";
import { ConnectWalletButton } from "@/app/components/ConnectWalletButton";

export const metadata: Metadata = {
  title: "Dashboard — YieldBonds",
  description:
    "Manage your YieldBonds portfolio, track prize pools, and claim winnings.",
};

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <DashboardSidebar />

      {/* ── Main content area (offset by sidebar on desktop) ─────────── */}
      <div className="lg:pl-60">
        {/* ── Top Bar ────────────────────────────────────────────────── */}
        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-outline-variant/10 bg-surface/80 backdrop-blur-xl px-6 py-4">
          <div>
            <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
              Dashboard
            </h1>
            <p className="text-xs text-on-surface-variant">
              Your portfolio at a glance
            </p>
          </div>
          <ConnectWalletButton />
        </header>

        {/* ── Page content ──────────────────────────────────────────── */}
        <main className="px-6 py-6 pb-24 lg:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
