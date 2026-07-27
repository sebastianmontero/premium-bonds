// ─── Formatters & Display Helpers ─────────────────────────────────────────────

export const USDC_DECIMALS = 6;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Convert a human-readable USDC amount to on-chain base units. */
export function usdc(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

/** Unix timestamp in seconds, offset from now by the given hours. */
export function hoursFromNow(hours: number): number {
  return Math.floor(Date.now() / 1000) + hours * 3600;
}

/** Format base-unit amount to human-readable string with commas. */
export function formatTokenAmount(
  amount: number,
  decimals: number = USDC_DECIMALS,
  minFractionDigits: number = 2,
  maxFractionDigits?: number
): string {
  const finalMax =
    maxFractionDigits ??
    (minFractionDigits < 2
      ? minFractionDigits
      : Math.max(minFractionDigits, 6));

  return (amount / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: finalMax,
  });
}

/** Map tier index to a human label. */
export function tierLabel(tierIndex: number): string {
  switch (tierIndex) {
    case 0:
      return "Grand Prize";
    case 1:
      return "Runner-up";
    default:
      return "Consolation";
  }
}

/** Map tier index to a Tailwind color class. */
export function tierColor(tierIndex: number): string {
  switch (tierIndex) {
    case 0:
      return "text-amber-400";
    case 1:
      return "text-secondary";
    default:
      return "text-tertiary";
  }
}

/** Map tier index to a badge background class. */
export function tierBadgeClass(tierIndex: number): string {
  switch (tierIndex) {
    case 0:
      return "inline-flex items-center gap-1 border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-300 rounded-full shadow-[0_0_12px_rgba(245,158,11,0.15)]";
    case 1:
      return "inline-flex items-center gap-1 border border-secondary/30 bg-secondary/10 px-2.5 py-0.5 text-xs font-semibold text-secondary rounded-full";
    default:
      return "inline-flex items-center gap-1 border border-outline-variant/30 bg-surface-variant px-2.5 py-0.5 text-xs font-medium text-on-surface-variant rounded-full";
  }
}
