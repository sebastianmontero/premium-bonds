"use client";

import { useState, useCallback } from "react";
import { LiveYieldTicker } from "./LiveYieldTicker";
import { formatTokenAmount } from "@/app/lib/formatters";
import type { PoolInfo } from "@/app/types";
import {
  parseTransactionError,
  ParsedTransactionError,
  getExplorerUrl,
  truncateSignature,
} from "@/app/lib/errors";
import { SolanaErrorAlert } from "@/app/components/SolanaErrorAlert";
import { useTranslations } from "next-intl";

interface DepositModalProps {
  pool: PoolInfo;
  walletBalance: number; // base units
  onClose: () => void;
  onDepositSuccess: (tickets: number, cost: number, signature?: string) => void;
  onDeposit?: (tickets: number) => Promise<string>;
}

export function DepositModal({
  pool,
  walletBalance,
  onClose,
  onDepositSuccess,
  onDeposit,
}: DepositModalProps) {
  const t = useTranslations("Modals");
  const [inputValue, setInputValue] = useState("");
  const [activeInput, setActiveInput] = useState<"token" | "ticket">("token");
  const [txStage, setTxStage] = useState<
    "signing" | "broadcasting" | "confirming" | "success" | null
  >(null);
  const [parsedError, setParsedError] = useState<ParsedTransactionError | null>(
    null
  );
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const bondPriceHuman = pool.bondPrice / 10 ** pool.tokenDecimals;

  // Derive both values from the single source of truth
  let tokenDisplay = "";
  let ticketDisplay = "";
  let parsedTickets = 0;

  if (activeInput === "token") {
    tokenDisplay = inputValue;
    const val = parseFloat(inputValue);
    if (!isNaN(val) && val > 0) {
      parsedTickets = Math.floor(val / bondPriceHuman);
      ticketDisplay = String(parsedTickets);
    }
  } else {
    ticketDisplay = inputValue;
    const val = parseInt(inputValue, 10);
    if (!isNaN(val) && val > 0) {
      parsedTickets = val;
      tokenDisplay = String(val * bondPriceHuman);
    }
  }

  const totalCostBase = parsedTickets * pool.bondPrice;
  const canDeposit =
    parsedTickets > 0 && totalCostBase <= walletBalance && txStage === null;

  const handleDeposit = useCallback(async () => {
    setTxStage("signing");
    setParsedError(null);
    setTxSignature(null);
    let capturedSig: string | undefined;
    try {
      if (onDeposit) {
        const sig = await onDeposit(parsedTickets);
        if (sig) {
          capturedSig = sig;
          setTxSignature(sig);
        }
        setTxStage("broadcasting");
        await new Promise((resolve) => setTimeout(resolve, 800));
        setTxStage("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setTxStage("success");
        await new Promise((resolve) => setTimeout(resolve, 1200));
      } else {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        setTxStage("broadcasting");
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setTxStage("confirming");
        await new Promise((resolve) => setTimeout(resolve, 1500));
        setTxStage("success");
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
      onDepositSuccess(parsedTickets, totalCostBase, capturedSig);
      onClose();
    } catch (err) {
      const parsed = parseTransactionError(err);
      if (parsed.isCancellation) {
        console.warn("Deposit transaction cancelled by user.");
      } else {
        console.error("Deposit transaction failed:", err);
      }
      setParsedError(parsed);
      setTxStage(null);
    }
  }, [parsedTickets, totalCostBase, onDepositSuccess, onClose, onDeposit]);

  return (
    <div
      className="modal-backdrop"
      onClick={() => txStage === null && onClose()}
    >
      <div
        className="w-full max-w-md rounded-2xl glass-strong p-6 space-y-5 shadow-ambient mx-4 relative overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {txStage !== null ? (
          <div className="py-8 flex flex-col items-center justify-center space-y-6 text-center">
            {/* Pulsing/spinning loader container */}
            <div className="relative flex items-center justify-center h-24 w-24">
              {/* Outer pulsing ring */}
              <div
                className={`absolute inset-0 rounded-full border-2 border-primary/20 ${txStage !== "success" ? "animate-ping opacity-75" : ""}`}
              />

              {/* Inner gradient glowing circle */}
              <div className="absolute h-16 w-16 rounded-full bg-gradient-to-br from-primary/10 to-secondary/10 flex items-center justify-center border border-primary/20 shadow-inner">
                {txStage === "signing" && (
                  <span className="text-2xl animate-bounce">🪙</span>
                )}
                {txStage === "broadcasting" && (
                  <span className="text-2xl animate-pulse">📡</span>
                )}
                {txStage === "confirming" && (
                  <span className="text-2xl animate-spin duration-3000">
                    ⛓️
                  </span>
                )}
                {txStage === "success" && (
                  <span className="text-3xl text-tertiary">🎉</span>
                )}
              </div>
            </div>

            {/* Stage titles and descriptions */}
            <div className="space-y-2">
              <h3 className="font-display text-xl font-bold text-on-surface">
                {txStage === "signing" && "Awaiting Wallet Signature"}
                {txStage === "broadcasting" && "Broadcasting Transaction"}
                {txStage === "confirming" && "Confirming on Solana"}
                {txStage === "success" && "Transaction Successful!"}
              </h3>
              <p className="text-xs text-on-surface-variant max-w-xs px-4">
                {txStage === "signing" &&
                  "Please approve the transaction prompt in your wallet extension."}
                {txStage === "broadcasting" &&
                  "Submitting transaction to the Solana network cluster..."}
                {txStage === "confirming" &&
                  "Waiting for transaction to reach confirmed status..."}
                {txStage === "success" &&
                  `Successfully purchased ${parsedTickets} bonds for ${formatTokenAmount(totalCostBase, pool.tokenDecimals)} ${pool.tokenSymbol}!`}
              </p>
              {txStage === "success" && txSignature && (
                <div className="pt-2">
                  <a
                    href={getExplorerUrl(txSignature, "devnet", "solscan")}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-mono text-primary hover:underline bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/20"
                  >
                    View on Solscan: {truncateSignature(txSignature)} ↗
                  </a>
                </div>
              )}
            </div>

            {/* Stepper indicators */}
            <div className="flex items-center gap-2 pt-2">
              <StepDot
                active={txStage === "signing"}
                completed={txStage !== "signing"}
              />
              <StepLine active={txStage !== "signing"} />
              <StepDot
                active={txStage === "broadcasting"}
                completed={txStage !== "signing" && txStage !== "broadcasting"}
              />
              <StepLine
                active={txStage === "confirming" || txStage === "success"}
              />
              <StepDot
                active={txStage === "confirming"}
                completed={txStage === "success"}
              />
            </div>
          </div>
        ) : (
          <>
            {/* ── Header ─────────────────────────────────────────────────── */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary/20 to-secondary/20">
                  <span className="font-display text-base font-bold text-primary">
                    {pool.tokenSymbol.charAt(0)}
                  </span>
                </div>
                <div>
                  <h2 className="font-display text-lg font-bold text-on-surface">
                    {t("depositHeader", { symbol: pool.tokenSymbol })}
                  </h2>
                  <p className="text-xs text-on-surface-variant">
                    {t("poolName", { symbol: pool.tokenSymbol })}
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="rounded-lg p-2 text-on-surface-variant hover:bg-surface-container-highest transition cursor-pointer"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Error Alert */}
            {parsedError && (
              <SolanaErrorAlert
                error={parsedError}
                onDismiss={() => setParsedError(null)}
                onRetry={canDeposit ? handleDeposit : undefined}
              />
            )}

            {/* ── Current Prize Pot ───────────────────────────────────────── */}
            <div className="rounded-xl bg-surface-container/60 px-4 py-3 flex items-center justify-between">
              <span className="text-xs font-medium text-on-surface-variant">
                {t("currentPrizePot")}
              </span>
              <LiveYieldTicker
                pool={pool}
                precision={4}
                showBadge={false}
                valueClassName="font-display text-lg font-bold text-gradient"
              />
            </div>

            {/* ── Dual Input ──────────────────────────────────────────────── */}
            <div className="space-y-3">
              {/* Token amount */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-medium text-on-surface-variant">
                    {t("amountLabel", { symbol: pool.tokenSymbol })}
                  </label>
                  <button
                    onClick={() => {
                      const maxTokens =
                        walletBalance / 10 ** pool.tokenDecimals;
                      setActiveInput("token");
                      setInputValue(
                        String(
                          Math.floor(maxTokens / bondPriceHuman) *
                            bondPriceHuman
                        )
                      );
                    }}
                    className="text-[10px] font-semibold text-primary hover:underline cursor-pointer"
                  >
                    {t("max")}:{" "}
                    {formatTokenAmount(walletBalance, pool.tokenDecimals)}
                  </button>
                </div>
                <input
                  type="number"
                  value={tokenDisplay}
                  onChange={(e) => {
                    setActiveInput("token");
                    setInputValue(e.target.value);
                  }}
                  placeholder="0.00"
                  min="0"
                  step={bondPriceHuman}
                  className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition"
                />
              </div>

              {/* Swap indicator */}
              <div className="flex items-center justify-center">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-container-highest border border-outline-variant/20">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="text-on-surface-variant"
                  >
                    <path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
                  </svg>
                </div>
              </div>

              {/* Ticket amount */}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-on-surface-variant">
                  {t("ticketsLabel")}
                </label>
                <input
                  type="number"
                  value={ticketDisplay}
                  onChange={(e) => {
                    setActiveInput("ticket");
                    setInputValue(e.target.value);
                  }}
                  placeholder="0"
                  min="0"
                  step="1"
                  className="w-full rounded-xl bg-surface-container px-4 py-3 font-mono text-lg text-on-surface placeholder:text-on-surface-variant/40 ghost-border ghost-border-focus outline-none transition"
                />
              </div>
            </div>

            {/* ── Summary ────────────────────────────────────────────────── */}
            {parsedTickets > 0 && (
              <div className="space-y-2 rounded-xl bg-surface-container/40 px-4 py-3 text-xs">
                <div className="flex justify-between text-on-surface-variant">
                  <span>{t("ticketsReceived")}</span>
                  <span className="font-semibold text-on-surface">
                    {parsedTickets}
                  </span>
                </div>
                <div className="flex justify-between text-on-surface-variant">
                  <span>{t("bondPriceLabel")}</span>
                  <span className="font-mono text-on-surface">
                    {t("oneTicket", {
                      price: formatTokenAmount(
                        pool.bondPrice,
                        pool.tokenDecimals
                      ),
                      symbol: pool.tokenSymbol,
                    })}
                  </span>
                </div>
                <div className="flex justify-between text-on-surface-variant">
                  <span>{t("totalCostLabel")}</span>
                  <span className="font-mono font-semibold text-on-surface">
                    {formatTokenAmount(totalCostBase, pool.tokenDecimals)}{" "}
                    {pool.tokenSymbol}
                  </span>
                </div>
                <div className="flex justify-between text-on-surface-variant">
                  <span>{t("networkFeeLabel")}</span>
                  <span className="font-mono text-on-surface">
                    ~0.00005 SOL
                  </span>
                </div>
              </div>
            )}

            {/* ── CTA ────────────────────────────────────────────────────── */}
            <button
              onClick={handleDeposit}
              disabled={!canDeposit}
              className="w-full btn-gradient rounded-xl py-3.5 text-sm cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {totalCostBase > walletBalance
                ? t("insufficientBalance")
                : parsedTickets > 0
                  ? t("confirmDepositAmount", {
                      amount: formatTokenAmount(
                        totalCostBase,
                        pool.tokenDecimals
                      ),
                      symbol: pool.tokenSymbol,
                    })
                  : t("enterAmount")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function StepDot({
  active,
  completed,
}: {
  active: boolean;
  completed: boolean;
}) {
  return (
    <div
      className={`h-2.5 w-2.5 rounded-full transition-all duration-300 ${
        completed
          ? "bg-tertiary"
          : active
            ? "bg-primary scale-125 shadow-[0_0_8px_rgba(135,173,255,0.6)]"
            : "bg-surface-bright"
      }`}
    />
  );
}

function StepLine({ active }: { active: boolean }) {
  return (
    <div
      className={`h-0.5 w-6 transition-all duration-500 ${
        active ? "bg-primary/50" : "bg-surface-bright"
      }`}
    />
  );
}
