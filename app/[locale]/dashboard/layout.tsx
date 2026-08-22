import { setRequestLocale } from "next-intl/server";
import { DashboardSidebar } from "@/app/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/app/components/dashboard/DashboardHeader";
import { ProtocolSyncCoordinator } from "@/app/components/dashboard/ProtocolSyncCoordinator";

export default async function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <div className="min-h-screen bg-surface text-on-surface relative overflow-hidden bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(135,173,255,0.12),rgba(255,255,255,0))]">
      {/* Headless protocol synchronization coordinator */}
      <ProtocolSyncCoordinator />

      {/* Zero-cost hardware-accelerated ambient glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0 bg-[radial-gradient(circle_500px_at_0%_0%,rgba(135,173,255,0.06),transparent),radial-gradient(circle_600px_at_100%_100%,rgba(193,160,254,0.05),transparent)] transform-gpu"
      />

      <div className="relative z-10">
        <DashboardSidebar />

        {/* Main content area (offset by sidebar on desktop) */}
        <div className="lg:ps-60">
          {/* Top Bar */}
          <DashboardHeader />

          {/* Page content */}
          <main className="px-6 py-6 pb-24 lg:pb-6">{children}</main>
        </div>
      </div>
    </div>
  );
}
