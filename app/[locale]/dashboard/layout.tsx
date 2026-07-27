import { setRequestLocale } from "next-intl/server";
import { DashboardSidebar } from "@/app/components/dashboard/DashboardSidebar";
import { DashboardHeader } from "@/app/components/dashboard/DashboardHeader";

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
    <div className="min-h-screen bg-surface text-on-surface">
      <DashboardSidebar />

      {/* Main content area (offset by sidebar on desktop) */}
      <div className="lg:ps-60">
        {/* Top Bar */}
        <DashboardHeader />

        {/* Page content */}
        <main className="px-6 py-6 pb-24 lg:pb-6">{children}</main>
      </div>
    </div>
  );
}
