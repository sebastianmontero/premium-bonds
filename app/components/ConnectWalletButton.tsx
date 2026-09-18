"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useUserTokenBalance } from "@/app/hooks/useUserTokenBalance";
import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/app/components/common/CopyButton";

export function ConnectWalletButton() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const { formattedBalance, isLoading: isBalanceLoading } =
    useUserTokenBalance();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("Wallet");
  const tCommon = useTranslations("Common");

  const address = wallet?.account.address.toString();
  const truncated = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  if (status === "connected" && truncated) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2.5 rounded-xl bg-surface-container-high px-3.5 py-2 text-sm font-medium text-on-surface ghost-border transition hover:bg-surface-container-highest cursor-pointer"
        >
          {/* Balance pill on sm+ screens */}
          <span className="hidden sm:inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary border-e border-outline-variant/30 pe-2.5">
            {isBalanceLoading ? (
              <span className="h-3.5 w-12 animate-pulse rounded bg-surface-container-highest inline-block" />
            ) : (
              `$${formattedBalance} USDC`
            )}
          </span>

          <span className="flex items-center gap-1.5 font-mono text-xs text-on-surface">
            <span className="h-2 w-2 rounded-full bg-tertiary animate-glow" />
            {truncated}
          </span>
        </button>

        {isOpen && (
          <div className="absolute end-0 top-full z-50 mt-2 w-64 rounded-xl glass shadow-ambient p-2.5">
            {/* Available Balance Row */}
            <div className="px-3 py-2 rounded-lg bg-surface-container/60 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                {t("availableBalance")}
              </p>
              <p className="font-mono text-base font-bold text-on-surface mt-0.5">
                ${formattedBalance}{" "}
                <span className="text-xs font-normal text-on-surface-variant">
                  USDC
                </span>
              </p>
            </div>

            {/* Address Row with Copy */}
            <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs font-mono text-on-surface-variant bg-surface-container-low rounded-lg">
              <span className="truncate">{address}</span>
              <CopyButton
                text={address ?? ""}
                ariaLabel={tCommon("explorer.copyAddress")}
                title={tCommon("explorer.copyAddress")}
                className="shrink-0 p-1 hover:text-primary transition-colors cursor-pointer"
                iconClassName="w-3.5 h-3.5"
              />
            </div>

            <div className="my-1.5 h-px bg-outline-variant/20" />
            <button
              onClick={() => {
                disconnect();
                setIsOpen(false);
              }}
              className="w-full rounded-lg px-3 py-2 text-start text-sm text-error hover:bg-surface-container-highest transition cursor-pointer"
            >
              {t("disconnect")}
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={status === "connecting"}
        className="btn-gradient rounded-xl px-5 py-2.5 text-sm cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
      >
        {status === "connecting" ? t("connecting") : t("connectWallet")}
      </button>

      {isOpen && connectors.length > 0 && (
        <div className="absolute end-0 top-full z-50 mt-2 w-64 rounded-xl glass shadow-ambient p-2">
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            {t("selectWallet")}
          </p>
          {connectors.map((connector) => (
            <button
              key={connector.id}
              onClick={async () => {
                await connect(connector.id);
                setIsOpen(false);
              }}
              className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-sm text-on-surface hover:bg-surface-container-highest transition cursor-pointer"
            >
              <span>{connector.name}</span>
              <span className="h-2 w-2 rounded-full bg-outline-variant" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
