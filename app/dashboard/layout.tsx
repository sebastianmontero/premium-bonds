import type { Metadata } from "next";
import { DashboardSidebar } from "@/app/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/app/components/dashboard/DashboardHeader";

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
        <DashboardHeader />

        {/* ── Page content ──────────────────────────────────────────── */}
        <main className="px-6 py-6 pb-24 lg:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
