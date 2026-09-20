"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useUserBalances } from "@/app/hooks/useUserBalances";
import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { CopyButton } from "@/app/components/common/CopyButton";

export function ConnectWalletButton() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const { usdc, sol, isLowSol, isLoading, isFetching, refetch } =
    useUserBalances();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const t = useTranslations("Wallet");
  const tCommon = useTranslations("Common");

  const address = wallet?.account.address.toString();
  const truncated = address
    ? `${address.slice(0, 4)}…${address.slice(-4)}`
    : null;

  const handleClose = useCallback(() => {
    setIsOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        handleClose();
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, handleClose]);

  if (status === "connected" && truncated) {
    return (
      <div className="relative" ref={dropdownRef}>
        <button
          ref={triggerRef}
          onClick={() => setIsOpen((prev) => !prev)}
          aria-expanded={isOpen}
          aria-haspopup="true"
          className="flex items-center gap-2.5 rounded-xl bg-surface-container-high px-3.5 py-2 text-sm font-medium text-on-surface ghost-border transition hover:bg-surface-container-highest cursor-pointer"
        >
          {/* Balance pill on sm+ screens */}
          <span
            className="hidden sm:inline-flex items-center gap-1 font-mono text-xs font-semibold text-primary border-e border-outline-variant/30 pe-2.5 cursor-help"
            title={usdc.formatted.fullWithCurrency}
            aria-label={t("balanceAriaLabel", {
              display: usdc.formatted.displayWithCurrency,
              full: usdc.formatted.fullWithCurrency,
            })}
          >
            {isLoading ? (
              <span className="h-3.5 w-12 animate-pulse rounded bg-surface-container-highest inline-block" />
            ) : (
              usdc.formatted.displayWithCurrency
            )}
          </span>

          <span className="flex items-center gap-1.5 font-mono text-xs text-on-surface">
            <span className="h-2 w-2 rounded-full bg-tertiary animate-glow" />
            {truncated}
          </span>
        </button>

        {isOpen && (
          <div className="absolute end-0 top-full z-50 mt-2 w-72 rounded-xl glass shadow-ambient p-3">
            {/* Header with Refresh Button */}
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-outline-variant/20">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant">
                {t("walletDetails")}
              </span>
              <button
                onClick={() => refetch()}
                disabled={isFetching}
                title={isFetching ? t("refreshing") : t("refreshBalance")}
                aria-label={isFetching ? t("refreshing") : t("refreshBalance")}
                className="h-6 w-6 rounded-md hover:bg-surface-container-highest text-on-surface-variant hover:text-on-surface flex items-center justify-center transition cursor-pointer disabled:opacity-40"
              >
                <svg
                  className={`w-3.5 h-3.5 ${isFetching ? "animate-spin text-primary" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99"
                  />
                </svg>
              </button>
            </div>

            {/* Available USDC Balance Row */}
            <div className="px-3 py-2 rounded-lg bg-surface-container/60 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                {t("availableBalance")}
              </p>
              {isLoading ? (
                <div className="h-5 w-24 animate-pulse rounded bg-surface-container-highest my-1" />
              ) : (
                <>
                  <p
                    className="font-mono text-base font-bold text-on-surface mt-0.5 cursor-help"
                    title={usdc.formatted.fullWithCurrency}
                  >
                    {usdc.formatted.displayWithCurrency}
                  </p>
                  <p className="text-[11px] font-mono text-on-surface-variant/70 mt-0.5">
                    ({usdc.formatted.fullWithCurrency})
                  </p>
                </>
              )}
            </div>

            {/* SOL Balance Row */}
            <div className="px-3 py-2 rounded-lg bg-surface-container/60 mb-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant">
                {t("solBalance")}
              </p>
              {isLoading ? (
                <div className="h-4 w-20 animate-pulse rounded bg-surface-container-highest my-1" />
              ) : (
                <p
                  className="font-mono text-xs font-semibold text-on-surface mt-0.5 cursor-help"
                  title={sol.formatted.fullWithCurrency}
                >
                  {sol.formatted.displayWithCurrency}
                </p>
              )}
            </div>

            {/* Low SOL Warning Banner */}
            {isLowSol && (
              <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-warning/10 border border-warning/20 text-warning text-xs mb-2">
                <svg
                  className="w-3.5 h-3.5 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                  />
                </svg>
                <span className="text-[11px] leading-tight font-medium">
                  {t("lowSolWarning")}
                </span>
              </div>
            )}

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

            <div className="my-2 h-px bg-outline-variant/20" />
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
        ref={triggerRef}
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
