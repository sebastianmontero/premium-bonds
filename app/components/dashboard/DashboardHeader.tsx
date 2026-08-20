"use client";

import { ConnectWalletButton } from "@/app/components/ConnectWalletButton";
import { LanguageSwitcher } from "@/app/components/LanguageSwitcher";
import { getNetworkInfo } from "@/app/lib/network";
import { useTranslations } from "next-intl";

export function DashboardHeader() {
  const t = useTranslations("Dashboard");
  const networkInfo = getNetworkInfo();

  return (
    <header className="sticky top-0 z-30 flex items-center justify-between border-b border-outline-variant/10 bg-surface/80 backdrop-blur-xl px-6 py-4">
      <div className="flex items-center gap-4">
        <div>
          <h1 className="font-display text-xl font-bold tracking-tight text-on-surface">
            {t("headerTitle")}
          </h1>
          <p className="text-xs text-on-surface-variant">
            {t("headerSubtitle")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {/* Protocol Live pill */}
          <span className="pill pill-success animate-yield-pulse hidden sm:inline-flex">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t("protocolLive")}
          </span>

          {/* Network Environment pill */}
          <span
            className={`${networkInfo.pillClassName} font-mono text-[11px] hidden sm:inline-flex`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {t(networkInfo.displayNameKey)}
          </span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <ConnectWalletButton />
      </div>
    </header>
  );
}
