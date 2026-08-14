"use client";

import { useTranslations } from "next-intl";
import { calculateEstimatedSolFee } from "@/app/lib/solana-fees";

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
        <span className="font-mono text-on-surface">~{networkFeeSol} SOL</span>
      </div>
      {showAccountStorage && (
        <>
          <div className="flex justify-between text-on-surface-variant">
            <span className="flex items-center gap-1">
              {t("storageFeeLabel")}
              <span
                className="cursor-help text-on-surface-variant/70 hover:text-primary transition"
                title={t("storageFeeTooltip")}
              >
                ⓘ
              </span>
            </span>
            <span className="font-mono text-on-surface">
              ~{storageFeeSol.toFixed(5)} SOL
            </span>
          </div>
          <div className="flex justify-between font-semibold text-on-surface pt-1">
            <span>{t("totalSolFeeLabel")}</span>
            <span className="font-mono text-primary">
              ~{totalSolFee.toFixed(6).replace(/0+$/, "")} SOL
            </span>
          </div>
        </>
      )}
    </div>
  );
}
