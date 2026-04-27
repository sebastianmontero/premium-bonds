"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
];

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* ── Desktop Sidebar ─────────────────────────────────────────────── */}
      <aside className="fixed left-0 top-0 z-40 hidden h-screen w-60 flex-col gap-6 border-r border-outline-variant/10 bg-surface-container-lowest px-4 py-6 lg:flex">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 px-2 group">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-on-surface">
            YieldBonds
          </span>
        </Link>

        {/* Nav */}
        <nav className="flex flex-1 flex-col gap-1">

          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${isActive ? "nav-item-active" : ""}`}
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom help */}
        <div className="glass rounded-xl p-4 space-y-2">
          <p className="text-xs font-semibold text-on-surface">Need help?</p>
          <p className="text-xs text-on-surface-variant leading-relaxed">
            Read the docs or join our Discord community.
          </p>
          <a
            href="#"
            className="inline-block text-xs font-semibold text-primary hover:underline"
          >
            View Docs →
          </a>
        </div>
      </aside>

      {/* ── Mobile Bottom Tab Bar ───────────────────────────────────────── */}
      <nav className="fixed bottom-0 left-0 right-0 z-50 flex items-center justify-around border-t border-outline-variant/10 bg-surface-container-lowest px-2 py-2 lg:hidden">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 rounded-lg px-3 py-1.5 text-[10px] font-medium transition ${
                isActive
                  ? "text-primary"
                  : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {item.icon}
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
