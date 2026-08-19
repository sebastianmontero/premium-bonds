// ─── Formatters & Display Helpers ─────────────────────────────────────────────

export const USDC_DECIMALS = 6;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const DEFAULT_LIVE_YIELD_PRECISION = 6;
export const SECONDS_PER_YEAR = 365.25 * 86400; // 31,557,600
export const DEFAULT_APY = 0.08;

export const BPS_DENOMINATOR = 10_000;
export const DEFAULT_TIER_PAYOUT_THRESHOLD_USD = 10.0;

const liveYieldFormatterCache = new Map<number, Intl.NumberFormat>();

/**
 * Returns a cached Intl.NumberFormat instance with explicit 'en-US' locale.
 * Reused across all live ticker components to avoid GC churn in 60/120 FPS loops.
 */
export function getLiveYieldFormatter(
  precision: number = DEFAULT_LIVE_YIELD_PRECISION
): Intl.NumberFormat {
  let fmt = liveYieldFormatterCache.get(precision);
  if (!fmt) {
    fmt = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: precision,
      maximumFractionDigits: precision,
    });
    liveYieldFormatterCache.set(precision, fmt);
  }
  return fmt;
}

/**
 * Returns token-aware threshold UI amount for estimated tier payout display.
 */
export function getPoolPayoutThresholdUi(tokenSymbol: string = "USDC"): number {
  switch (tokenSymbol.toUpperCase()) {
    case "SOL":
      return 0.05;
    case "WBTC":
      return 0.0005;
    case "USDC":
    default:
      return DEFAULT_TIER_PAYOUT_THRESHOLD_USD;
  }
}

export interface TierPayoutBreakdown {
  payoutPerWinnerUi: number;
  totalTierShareUi: number;
  isAboveThreshold: boolean;
}

/**
 * Pure domain calculation for prize tier payouts.
 * In the smart contract (state/pool.rs), tier.basisPoints is awarded to each individual winner.
 */
export function calculateTierPayout(
  potUi: number,
  tier: { basisPoints: number; numWinners: number },
  threshold: number = DEFAULT_TIER_PAYOUT_THRESHOLD_USD
): TierPayoutBreakdown {
  if (
    !Number.isFinite(potUi) ||
    potUi <= 0 ||
    !tier ||
    !Number.isFinite(tier.basisPoints) ||
    tier.basisPoints <= 0
  ) {
    return {
      payoutPerWinnerUi: 0,
      totalTierShareUi: 0,
      isAboveThreshold: false,
    };
  }

  const sanitizedBps = Math.min(tier.basisPoints, BPS_DENOMINATOR);
  const payoutPerWinnerUi = (potUi * sanitizedBps) / BPS_DENOMINATOR;
  const winnersCount = Math.max(1, tier.numWinners || 1);
  const totalTierShareUi = payoutPerWinnerUi * winnersCount;
  const isAboveThreshold = potUi >= threshold;

  return {
    payoutPerWinnerUi: Number.isFinite(payoutPerWinnerUi)
      ? payoutPerWinnerUi
      : 0,
    totalTierShareUi: Number.isFinite(totalTierShareUi) ? totalTierShareUi : 0,
    isAboveThreshold,
  };
}

/**
 * Format tier payout amount with token-aware symbol handling and 60 FPS cached formatting.
 */
export function formatTierPayoutAmount(
  amount: number,
  tokenSymbol: string = "USDC",
  precision: number = DEFAULT_LIVE_YIELD_PRECISION
): string {
  const formatter = getLiveYieldFormatter(precision);
  const formatted = formatter.format(amount);
  if (tokenSymbol.toUpperCase() === "USDC") {
    return `$${formatted}`;
  }
  return `${formatted} ${tokenSymbol}`;
}

/**
 * Resolves localized tier label consistently across PoolCard and PrizeTiersModal.
 */
export function getLocalizedTierLabel(
  tierIndex: number,
  totalTiersCount: number,
  t: (key: string, values?: Record<string, string | number | Date>) => string
): string {
  switch (tierIndex) {
    case 0:
      return t("grand");
    case 1:
      return t("runnerUp");
    default:
      if (totalTiersCount <= 3) {
        return t("consolation");
      }
      return t("tierN", { tier: tierIndex + 1 });
  }
}

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

/**
 * Get the user's local IANA timezone identifier (e.g. "America/Denver", "Europe/London").
 * Defaults to "UTC" if Intl is unavailable or fails.
 */
export function getUserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Safely parse an ISO date string, date-only string ("YYYY-MM-DD"), timestamp, or Date object.
 * Date-only strings ("YYYY-MM-DD") are parsed as local midnight to prevent unwanted timezone shifts.
 */
export function parseDate(isoDateOrTimestamp: string | number | Date): Date {
  if (isoDateOrTimestamp instanceof Date) return isoDateOrTimestamp;
  if (typeof isoDateOrTimestamp === "number")
    return new Date(isoDateOrTimestamp);

  if (typeof isoDateOrTimestamp === "string") {
    const trimmed = isoDateOrTimestamp.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return new Date(`${trimmed}T00:00:00`);
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }

  return new Date();
}

export interface FormatLocalDateOptions extends Intl.DateTimeFormatOptions {
  includeTimeIfPresent?: boolean;
}

/**
 * Safely formats any date input (ISO string, timestamp, or Date) in the user's local timezone.
 * Abstracts timezone resolution, parsing, and formatting logic across the application.
 */
export function formatLocalDate<T extends object = Intl.DateTimeFormatOptions>(
  isoDateOrTimestamp: string | number | Date | null | undefined,
  options?: FormatLocalDateOptions,
  formatFn?: (date: Date, options: T) => string
): string {
  if (isoDateOrTimestamp === null || isoDateOrTimestamp === undefined) {
    return "";
  }

  try {
    const date = parseDate(isoDateOrTimestamp);
    const userTimeZone = getUserTimeZone();

    let hasTime = false;
    if (typeof isoDateOrTimestamp === "string") {
      hasTime =
        isoDateOrTimestamp.includes("T") &&
        !isoDateOrTimestamp.endsWith("T00:00:00");
    } else if (
      typeof isoDateOrTimestamp === "number" ||
      isoDateOrTimestamp instanceof Date
    ) {
      hasTime = true;
    }

    const { includeTimeIfPresent = true, ...dateTimeOpts } = options || {};

    const finalOpts: Intl.DateTimeFormatOptions = {
      ...dateTimeOpts,
      ...(includeTimeIfPresent &&
      hasTime &&
      !dateTimeOpts.hour &&
      !dateTimeOpts.dateStyle
        ? { hour: "2-digit", minute: "2-digit" }
        : {}),
      timeZone: userTimeZone,
    };

    if (formatFn) {
      return formatFn(date, finalOpts as unknown as T);
    }

    return new Intl.DateTimeFormat("en-US", finalOpts).format(date);
  } catch {
    return String(isoDateOrTimestamp);
  }
}
