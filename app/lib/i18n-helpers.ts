import type { ActivityEntry } from "@/app/types";
import { formatCurrency, USDC_DECIMALS } from "./formatters";

export type ActivityTranslationKey =
  | "descriptions.deposit"
  | "descriptions.withdraw"
  | "descriptions.autoReinvest"
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

/**
 * Fallback regex parser for legacy/unstructured activity description strings.
 */
export function fallbackRegexFormat(
  description: string,
  t: ActivityTranslationFn
): string {
  if (!description) return "";

  // 1. Deposited {amount} → +{bonds} tickets
  const depMatch = description.match(
    /Deposited\s+([$\d,.]+)(?:\s+USDC)?\s+→\s+\+(\d+)\s+tickets?/i
  );
  if (depMatch) {
    return t("descriptions.deposit", {
      amount: depMatch[1],
      bonds: Number(depMatch[2]),
    });
  }

  // 2. Sold {bonds} bonds ({amount}) · Pending settle
  const withMatch = description.match(
    /Sold\s+(\d+)\s+bonds?\s+\(([$\d,.]+)(?:\s+USDC)?\)\s+·\s+Pending settle/i
  );
  if (withMatch) {
    return t("descriptions.withdraw", {
      amount: withMatch[2],
      bonds: Number(withMatch[1]),
    });
  }

  // 3. Draw #{cycleId} reinvested: +{bonds} tickets from {amount}
  const reinvMatch = description.match(
    /Draw\s+#(\d+)\s+reinvested:\s+\+(\d+)\s+tickets?\s+from\s+([$\d,.]+)(?:\s+USDC)?/i
  );
  if (reinvMatch) {
    return t("descriptions.autoReinvest", {
      cycleId: Number(reinvMatch[1]),
      bonds: Number(reinvMatch[2]),
      amount: reinvMatch[3],
    });
  }

  // 4. Claimed accumulated winnings of {amount} · Pending settle
  const winMatch = description.match(
    /Claimed\s+accumulated\s+winnings\s+of\s+([$\d,.]+)(?:\s+USDC)?\s+·\s+Pending settle/i
  );
  if (winMatch) {
    return t("descriptions.win", { amount: winMatch[1] });
  }

  // 5. Claimed settled bond principal of {amount} to wallet
  const claimBpMatch = description.match(
    /Claimed\s+settled\s+bond\s+principal\s+of\s+([$\d,.]+)(?:\s+USDC)?\s+to\s+wallet/i
  );
  if (claimBpMatch) {
    return t("descriptions.claimedBondPrincipal", { amount: claimBpMatch[1] });
  }

  // 6. Claimed settled fees of {amount} to wallet
  const claimFeesMatch = description.match(
    /Claimed\s+settled\s+fees\s+of\s+([$\d,.]+)(?:\s+USDC)?\s+to\s+wallet/i
  );
  if (claimFeesMatch) {
    return t("descriptions.claimedFees", { amount: claimFeesMatch[1] });
  }

  // 7. Claimed settled prize winnings of {amount} to wallet
  const claimPwMatch = description.match(
    /Claimed\s+settled\s+prize\s+winnings\s+of\s+([$\d,.]+)(?:\s+USDC)?\s+to\s+wallet/i
  );
  if (claimPwMatch) {
    return t("descriptions.claimedPrizeWinnings", { amount: claimPwMatch[1] });
  }

  // 8. Claimed settled redemption of {amount} to wallet
  const claimRedMatch = description.match(
    /Claimed\s+settled\s+redemption\s+of\s+([$\d,.]+)(?:\s+USDC)?\s+to\s+wallet/i
  );
  if (claimRedMatch) {
    return t("descriptions.claimedRedemption", { amount: claimRedMatch[1] });
  }

  return description;
}

/**
 * Type-safe activity description renderer backed by next-intl ICU plural templates.
 * Prioritizes structured `metadata` when present, falling back to regex parsing for raw strings.
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
      case "auto-reinvest":
        return t("descriptions.autoReinvest", {
          amount: amountStr,
          bonds,
          cycleId,
        });
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
        return fallbackRegexFormat(entry.description, t);
    }
  }

  // Fall back to regex parsing of legacy/unstructured description
  return fallbackRegexFormat(entry.description, t);
}

/**
 * @deprecated Use renderLocalizedActivityDescription() with useTranslations("Activity").
 * Formats activity feed descriptions dynamically based on the active locale.
 */
export function formatLocalizedActivityDescription(
  description: string,
  locale: string
): string {
  if (locale !== "es" || !description) {
    return description;
  }

  let result = description;

  // Verb & phrase replacements
  result = result.replace(/\bDeposited\b/gi, "Depositó");
  result = result.replace(/\bSold\b/gi, "Vendió");
  result = result.replace(/\bWon\b/gi, "Ganó");
  result = result.replace(/\bAuto-reinvested\b/gi, "Auto-reinvertido");
  result = result.replace(
    /\bClaimed accumulated winnings of\b/gi,
    "Reclamó ganancias acumuladas de"
  );
  result = result.replace(
    /\bClaimed accumulated dust winnings of\b/gi,
    "Reclamó ganancias restantes acumuladas de"
  );
  result = result.replace(
    /\bClaimed settled redemption of\b/gi,
    "Reclamó redención liquidada de"
  );
  result = result.replace(
    /\bClaimed settled bond principal of\b/gi,
    "Reclamó capital de bonos liquidado de"
  );
  result = result.replace(
    /\bClaimed settled fees of\b/gi,
    "Reclamó comisiones liquidadas de"
  );
  result = result.replace(
    /\bClaimed settled prize winnings of\b/gi,
    "Reclamó ganancias de premios liquidadas de"
  );
  result = result.replace(/\bClaimed settled\b/gi, "Reclamó liquidación de");
  result = result.replace(/\bbond principal\b/gi, "capital de bonos");
  result = result.replace(/\bprize winnings\b/gi, "ganancias de premios");
  result = result.replace(/\bfees\b/gi, "comisiones");
  result = result.replace(
    /\breinvestment finalized\b/gi,
    "reinversión finalizada"
  );
  result = result.replace(/\bbatch reinvest\b/gi, "reinversión por lote");
  result = result.replace(/\bpartial reinvestment\b/gi, "reinversión parcial");

  // Prepositions & nouns
  result = result.replace(/\bto wallet\b/gi, "a la billetera");
  result = result.replace(/\bPending settle\b/gi, "Pendiente de liquidación");
  result = result.replace(/\bfrom\b/gi, "de");
  result = result.replace(/\bwinnings\b/gi, "ganancias");
  result = result.replace(/\bprior dust\b/gi, "saldo restante anterior");
  result = result.replace(/\baccumulated dust\b/gi, "saldo restante acumulado");
  result = result.replace(/\btickets\b/gi, "bonos");
  result = result.replace(/\bticket\b/gi, "bono");
  result = result.replace(/\bbonds\b/gi, "bonos");
  result = result.replace(/\bbond\b/gi, "bono");
  result = result.replace(/\bDraw #/gi, "Sorteo #");
  result = result.replace(/\bdust\b/gi, "saldo restante");
  result = result.replace(/\bConsolation\b/gi, "Consolación");
  result = result.replace(/\bRunner-up\b/gi, "Segundo Lugar");
  result = result.replace(/\bJackpot\b/gi, "Gran Premio");

  return result;
}
