"use client";

import { ConnectWalletButton } from "./ConnectWalletButton";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useState, useEffect } from "react";
import { Link } from "@/i18n/routing";
import { useWalletConnection } from "@solana/react-hooks";
import { useTranslations } from "next-intl";
import { useModalDismissal } from "@/app/hooks/useModalDismissal";

export function Navbar() {
  const { status } = useWalletConnection();
  const [scrolled, setScrolled] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const t = useTranslations("Navbar");
  const tLang = useTranslations("Language");

  const navLinks = [
    { label: t("features"), href: "/#features" },
    { label: t("howItWorks"), href: "/#how-it-works" },
    { label: t("prizes"), href: "/#prizes" },
    { label: t("docs"), href: "/docs" },
  ];

  useModalDismissal({
    isOpen: drawerOpen,
    onClose: () => setDrawerOpen(false),
  });

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
        scrolled || drawerOpen ? "glass shadow-ambient" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 px-safe sm:px-6 py-3.5 sm:py-4">
        {/* Logo */}
        <Link
          href="/"
          onClick={() => setDrawerOpen(false)}
          className="flex items-center gap-2.5 group shrink-0"
        >
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-secondary">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="white"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="font-display text-lg font-bold tracking-tight text-on-surface">
            {t("brandName")}
          </span>
        </Link>

        {/* Desktop Links */}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* CTA & Language Switcher */}
        <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
          <div className="hidden sm:block">
            <LanguageSwitcher />
          </div>
          {status === "connected" && (
            <Link
              href="/dashboard"
              className="hidden md:inline-flex btn-ghost rounded-xl px-4 py-2.5 text-sm font-medium transition cursor-pointer"
            >
              {t("dashboard")}
            </Link>
          )}
          <ConnectWalletButton />

          {/* Mobile Hamburger Button */}
          <button
            type="button"
            onClick={() => setDrawerOpen((prev) => !prev)}
            aria-expanded={drawerOpen}
            aria-controls="mobile-nav-drawer"
            aria-label={
              drawerOpen ? "Close navigation menu" : "Open navigation menu"
            }
            className="md:hidden rounded-xl p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/10 transition cursor-pointer min-h-[44px] min-w-[44px] flex items-center justify-center"
          >
            {drawerOpen ? (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            ) : (
              <svg
                className="w-6 h-6"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Slide-Down Drawer */}
      {drawerOpen && (
        <div
          id="mobile-nav-drawer"
          className="md:hidden border-t border-surface-bright/10 bg-[#0c0d18]/95 backdrop-blur-xl px-4 px-safe pt-3 pb-safe-lg shadow-2xl animate-slide-up max-h-[calc(100dvh-4rem)] overflow-y-auto space-y-4"
        >
          <div className="flex flex-col space-y-1">
            {status === "connected" && (
              <Link
                href="/dashboard"
                onClick={() => setDrawerOpen(false)}
                className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm font-semibold text-primary bg-primary/10 border border-primary/20 transition min-h-[44px]"
              >
                <span>📊</span>
                <span>{t("dashboard")}</span>
              </Link>
            )}
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setDrawerOpen(false)}
                className="flex items-center rounded-xl px-4 py-3 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/10 transition min-h-[44px]"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <div className="pt-2 border-t border-surface-bright/10 flex items-center justify-between">
            <span className="text-xs text-on-surface-variant font-medium">
              {tLang("selectLanguage")}
            </span>
            <LanguageSwitcher />
          </div>
        </div>
      )}
    </nav>
  );
}
