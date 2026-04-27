"use client";

import { usePathname } from "next/navigation";
import { ConnectWalletButton } from "@/app/components/ConnectWalletButton";

const PAGE_META: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Your portfolio and protocol overview",
  },
};

export function DashboardHeader() {
  const pathname = usePathname();
  const meta = PAGE_META[pathname] ?? PAGE_META["/dashboard"];

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-outline-variant/10 bg-surface/80 backdrop-blur-xl px-6 py-4">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            {meta.title}
          </h1>
          <p className="text-xs text-on-surface-variant">{meta.subtitle}</p>
        </div>

        {/* Protocol Live pill */}
        <span className="pill pill-success animate-yield-pulse hidden sm:inline-flex">
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          Protocol Live
        </span>
      </div>
      <ConnectWalletButton />
    </header>
  );
}
