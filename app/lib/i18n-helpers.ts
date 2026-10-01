import type { ActivityEntry } from "@/app/types";
import { formatCurrency, USDC_DECIMALS } from "./formatters";
import {
  classifyReinvestScenario,
  type ReinvestScenario,
} from "./activity-helpers";

export type ActivityTranslationKey =
  | "descriptions.deposit"
  | "descriptions.withdraw"
  | "descriptions.autoReinvest"
  | "descriptions.autoReinvestWithClaimable"
  | "descriptions.autoReinvestDustOnly"
  | "descriptions.autoReinvestWithUsedDust"
  | "descriptions.autoReinvestWithUsedDustAndRemaining"
  | "descriptions.autoReinvestPureDustCompound"
  | "descriptions.win"
  | "descriptions.claimedBondPrincipal"
  | "descriptions.claimedFees"
  | "descriptions.claimedPrizeWinnings"
  | "descriptions.claimedRedemption"
  | "descriptions.generic";

export type ActivityTranslationFn = (
  key: ActivityTranslationKey | (string & {}),
  values?: Record<string, string | number>
) => string;

const REINVEST_TRANSLATION_KEYS: Record<
  ReinvestScenario,
  ActivityTranslationKey
> = {
  dust_only: "descriptions.autoReinvestDustOnly",
  pure_dust_compound: "descriptions.autoReinvestPureDustCompound",
  compounded_with_remaining:
    "descriptions.autoReinvestWithUsedDustAndRemaining",
  compounded_exact: "descriptions.autoReinvestWithUsedDust",
  leftover_dust: "descriptions.autoReinvestWithClaimable",
  pure_reinvestment: "descriptions.autoReinvest",
};

/**
 * Type-safe activity description renderer backed by next-intl ICU plural templates.
 * Prioritizes structured `metadata` when present, falling back to entry.description for raw strings.
 */
export function renderLocalizedActivityDescription(
  entry: ActivityEntry,
  t: ActivityTranslationFn,
  formatAmount: (base: number) => string = (b) =>
    formatCurrency(b, { decimals: USDC_DECIMALS })
): string {
  // If structured metadata is available, render via ICU templates
  if (entry.metadata) {
    const amountVal = entry.metadata.amountUsdc ?? entry.amount ?? 0;
    const amountStr = formatAmount(amountVal);
    const bonds = entry.metadata.bonds ?? 0;
    const cycleId = entry.metadata.cycleId ?? 0;

    switch (entry.type) {
      case "deposit":
        return t("descriptions.deposit", { amount: amountStr, bonds });
      case "withdraw":
        return t("descriptions.withdraw", { amount: amountStr, bonds });
      case "auto-reinvest": {
        const scenario = classifyReinvestScenario({
          bonds: entry.metadata.bonds,
          amountUsdc: entry.metadata.amountUsdc ?? entry.amount,
          claimableUsdc: entry.metadata.claimableUsdc,
          usedPriorDustUsdc: entry.metadata.usedPriorDustUsdc,
        });

        const claimableVal = entry.metadata.claimableUsdc;
        const usedDustVal = entry.metadata.usedPriorDustUsdc;
        const claimableStr =
          claimableVal != null && claimableVal > 0
            ? formatAmount(claimableVal)
            : undefined;
        const usedDustStr =
          usedDustVal != null && usedDustVal > 0
            ? formatAmount(usedDustVal)
            : undefined;

        const key = REINVEST_TRANSLATION_KEYS[scenario];
        return t(key, {
          amount: amountStr,
          bonds,
          cycleId,
          usedDust: usedDustStr!,
          remaining: claimableStr!,
          claimable: claimableStr!,
        });
      }
      case "win":
        return t("descriptions.win", { amount: amountStr });
      case "claim-redemption": {
        const rType = entry.metadata.redemptionType;
        if (rType === "bond_sale") {
          return t("descriptions.claimedBondPrincipal", { amount: amountStr });
        }
        if (rType === "fee_withdrawal") {
          return t("descriptions.claimedFees", { amount: amountStr });
        }
        if (rType === "prize_claim") {
          return t("descriptions.claimedPrizeWinnings", { amount: amountStr });
        }
        return t("descriptions.claimedRedemption", { amount: amountStr });
      }
      default:
        return entry.description;
    }
  }

  // Fall back cleanly to entry.description
  return entry.description;
}
