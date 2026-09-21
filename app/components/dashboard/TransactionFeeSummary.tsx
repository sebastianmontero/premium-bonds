"use client";

import { useTranslations } from "next-intl";
import { calculateEstimatedSolFee } from "@/app/lib/solana-fees";
import { formatUiCurrency } from "@/app/lib/formatters";

interface TransactionFeeSummaryProps {
  isFirstDeposit?: boolean;
  showAccountStorage?: boolean;
  customNetworkFeeSol?: number;
  className?: string;
}

export function TransactionFeeSummary({
  isFirstDeposit = false,
  showAccountStorage = isFirstDeposit,
  customNetworkFeeSol,
  className = "",
}: TransactionFeeSummaryProps) {
  const t = useTranslations("Modals");
  const { networkFeeSol, storageFeeSol, totalSolFee } =
    calculateEstimatedSolFee({
      isFirstDeposit: showAccountStorage,
      customNetworkFeeSol,
    });

  return (
    <div
      className={`space-y-1.5 pt-2 border-t border-outline-variant/10 text-xs ${className}`}
    >
      <div className="flex justify-between text-on-surface-variant">
        <span>{t("networkFeeLabel")}</span>
        <span className="font-mono text-on-surface">
          {formatUiCurrency(networkFeeSol, {
            tokenSymbol: "SOL",
            prefix: "~",
            maxFractionDigits: 5,
          })}
        </span>
      </div>
      {showAccountStorage && (
        <>
          <div className="flex justify-between text-on-surface-variant">
            <span className="flex items-center gap-1">
              {t("storageFeeLabel")}
              <span
                className="cursor-help text-on-surface-variant/70 hover:text-primary transition inline-flex items-center"
                title={t("storageFeeTooltip")}
              >
                <svg
                  className="h-3 w-3 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="10" strokeWidth="2" />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M12 16v-4m0-4h.01"
                  />
                </svg>
              </span>
            </span>
            <span className="font-mono text-on-surface">
              {formatUiCurrency(storageFeeSol, {
                tokenSymbol: "SOL",
                prefix: "~",
                maxFractionDigits: 5,
              })}
            </span>
          </div>
          <div className="flex justify-between font-semibold text-on-surface pt-1">
            <span>{t("totalSolFeeLabel")}</span>
            <span className="font-mono text-primary">
              {formatUiCurrency(totalSolFee, {
                tokenSymbol: "SOL",
                prefix: "~",
                maxFractionDigits: 6,
              })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
