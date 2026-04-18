"use client";

import { useWalletConnection } from "@solana/react-hooks";
import { useState, useRef, useEffect } from "react";

export function ConnectWalletButton() {
  const { connectors, connect, disconnect, wallet, status } =
    useWalletConnection();
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
          className="flex items-center gap-2 rounded-xl bg-surface-container-high px-4 py-2.5 text-sm font-medium text-on-surface ghost-border transition hover:bg-surface-container-highest cursor-pointer"
        >
          <span className="h-2 w-2 rounded-full bg-tertiary animate-glow" />
          {truncated}
        </button>

        {isOpen && (
          <div className="absolute right-0 top-full z-50 mt-2 w-56 rounded-xl glass shadow-ambient p-2">
            <div className="px-3 py-2 text-xs text-on-surface-variant font-mono break-all">
              {address}
            </div>
            <div className="my-1 h-px bg-outline-variant/20" />
            <button
              onClick={() => {
                disconnect();
                setIsOpen(false);
              }}
              className="w-full rounded-lg px-3 py-2 text-left text-sm text-error hover:bg-surface-container-highest transition cursor-pointer"
            >
              Disconnect
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
        {status === "connecting" ? "Connecting…" : "Connect Wallet"}
      </button>

      {isOpen && connectors.length > 0 && (
        <div className="absolute right-0 top-full z-50 mt-2 w-64 rounded-xl glass shadow-ambient p-2">
          <p className="px-3 py-2 text-xs font-medium uppercase tracking-wider text-on-surface-variant">
            Select Wallet
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
