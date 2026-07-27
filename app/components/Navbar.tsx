"use client";

import { ConnectWalletButton } from "./ConnectWalletButton";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useState, useEffect } from "react";
import { Link } from "@/i18n/routing";
import { useWalletConnection } from "@solana/react-hooks";
import { useTranslations } from "next-intl";

export function Navbar() {
  const { status } = useWalletConnection();
  const [scrolled, setScrolled] = useState(false);
  const t = useTranslations("Navbar");

  const navLinks = [
    { label: t("features"), href: "#features" },
    { label: t("howItWorks"), href: "#how-it-works" },
    { label: t("prizes"), href: "#prizes" },
  ];

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <nav
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled ? "glass shadow-ambient" : "bg-transparent"
      }`}
    >
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        {/* Logo */}
        <Link href="/" className="flex items-center gap-2.5 group">
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

        {/* Links */}
        <div className="hidden items-center gap-8 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm font-medium text-on-surface-variant transition-colors hover:text-on-surface"
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* CTA & Language Switcher */}
        <div className="flex items-center gap-3 md:gap-4">
          <LanguageSwitcher />
          {status === "connected" && (
            <Link
              href="/dashboard"
              className="btn-ghost rounded-xl px-4 py-2.5 text-sm font-medium transition cursor-pointer"
            >
              {t("dashboard")}
            </Link>
          )}
          <ConnectWalletButton />
        </div>
      </div>
    </nav>
  );
}
