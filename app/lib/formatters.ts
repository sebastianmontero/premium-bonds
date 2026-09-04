import type {
  PoolInfo,
  YieldBreakdown,
  YieldThresholdProgress,
  PoolThresholdBreakdown,
} from "../types";

export const USDC_DECIMALS = 6;
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
export const DEFAULT_LIVE_YIELD_PRECISION = 6;
export const SECONDS_PER_YEAR = 365.25 * 86400; // 31,557,600
export const BPS_DENOMINATOR = 10_000;
export const DEFAULT_APY_BPS = 850; // 8.50% Huma Credit Vaults target
export const DEFAULT_APY = DEFAULT_APY_BPS / BPS_DENOMINATOR; // 0.085
export const DEFAULT_TIER_PAYOUT_THRESHOLD_USD = 10.0;

/** Converts basis points to a decimal rate (e.g. 250 -> 0.025) */
export function bpsToRate(bps: number): number {
  return (Number.isFinite(bps) ? bps : 0) / BPS_DENOMINATOR;
}

/** Converts a decimal rate to basis points (e.g. 0.085 -> 850) */
export function rateToBps(rate: number): number {
  return Math.round((Number.isFinite(rate) ? rate : 0) * BPS_DENOMINATOR);
}

/** Pure calculation for Net APY after deducting protocol reserve fees */
export function calculateNetApy(
  grossApy: number,
  feeBasisPoints: number = 0
): number {
  const safeGrossApy = Number.isFinite(grossApy) && grossApy > 0 ? grossApy : 0;
  const feeRate = bpsToRate(feeBasisPoints);
  return safeGrossApy * Math.max(0, 1 - feeRate);
}

/** Formats basis points to human-readable percentage (e.g. 250 -> "2.50%") */
export function formatBasisPoints(
  bps: number,
  fractionDigits: number = 2
): string {
  const percent = (Number.isFinite(bps) ? bps : 0) / 100;
  return `${percent.toFixed(fractionDigits)}%`;
}

/** Formats APY decimal to human-readable string (e.g. 0.085 -> "8.50% APY") */
export function formatApy(apy: number, fractionDigits: number = 2): string {
  const percent = (Number.isFinite(apy) ? apy : 0) * 100;
  return `${percent.toFixed(fractionDigits)}% APY`;
}

/**
 * Pure domain selector to extract structured, formatted yield breakdown metrics from PoolInfo.
 */
export function resolvePoolYieldBreakdown(
  pool: PoolInfo,
  decimals: number = USDC_DECIMALS
): YieldBreakdown {
  const grossYieldBase = pool.grossYield ?? 0;
  const feeBasisPoints = pool.feeBasisPoints ?? 0;
  const protocolFeeBase =
    pool.protocolFeeAmount ??
    Math.round((grossYieldBase * feeBasisPoints) / BPS_DENOMINATOR);
  const netYieldBase =
    pool.estimatedPrizePot ?? Math.max(0, grossYieldBase - protocolFeeBase);
  const underlyingApy = pool.underlyingApy ?? DEFAULT_APY;
  const netApy = calculateNetApy(underlyingApy, feeBasisPoints);

  return {
    grossYieldBase,
    protocolFeeBase,
    netYieldBase,
    grossYieldUi: grossYieldBase / 10 ** decimals,
    protocolFeeUi: protocolFeeBase / 10 ** decimals,
    netYieldUi: netYieldBase / 10 ** decimals,
    feeBasisPoints,
    feePercentFormatted: formatBasisPoints(feeBasisPoints),
    underlyingApy,
    underlyingApyFormatted: formatApy(underlyingApy),
    netApy,
    netApyFormatted: formatApy(netApy),
  };
}

/**
 * Pure evaluation for Minimum Yield Threshold execution status.
 */
export function calculateYieldThresholdProgress(
  grossYieldBase: number = 0,
  minYieldThresholdBase: number = 0,
  decimals: number = USDC_DECIMALS
): YieldThresholdProgress {
  const currentBase = Math.max(0, grossYieldBase || 0);
  const targetBase = Math.max(0, minYieldThresholdBase || 0);
  const isConfigured = targetBase > 0;
  const isMet = !isConfigured || currentBase >= targetBase;
  const progressPercent = isConfigured
    ? Math.min(100, Math.max(0, (currentBase / targetBase) * 100))
    : 100;

  return {
    isMet,
    isConfigured,
    progressPercent,
    currentBase,
    targetBase,
    currentUi: currentBase / 10 ** decimals,
    targetUi: targetBase / 10 ** decimals,
  };
}

/**
 * Pure domain selector to extract structured yield threshold progress metrics from PoolInfo.
 * Computes both gross (on-chain) and net (distributable) target progress deterministically.
 */
export function resolvePoolThresholdBreakdown(
  pool: PoolInfo,
  decimals: number = pool.tokenDecimals ?? USDC_DECIMALS
): PoolThresholdBreakdown {
  const currentGrossBase = Math.max(0, pool.grossYield ?? 0);
  const targetGrossBase = Math.max(0, pool.minYieldThreshold ?? 0);
  const feeBasisPoints = pool.feeBasisPoints ?? 0;
  const feeRate = bpsToRate(feeBasisPoints);
  const netFactor = Math.max(0, 1 - feeRate);

  const currentNetBase =
    pool.estimatedPrizePot ?? Math.round(currentGrossBase * netFactor);
  const targetNetBase = Math.round(targetGrossBase * netFactor);

  const divisor = 10 ** decimals;
  const isConfigured = targetGrossBase > 0;
  const isMet = !isConfigured || currentGrossBase >= targetGrossBase;
  const progressPercent = isConfigured
    ? Math.min(100, Math.max(0, (currentGrossBase / targetGrossBase) * 100))
    : 100;

  return {
    isConfigured,
    isMet,
    progressPercent,
    gross: {
      currentBase: currentGrossBase,
      targetBase: targetGrossBase,
      currentUi: currentGrossBase / divisor,
      targetUi: targetGrossBase / divisor,
    },
    net: {
      currentBase: currentNetBase,
      targetBase: targetNetBase,
      currentUi: currentNetBase / divisor,
      targetUi: targetNetBase / divisor,
    },
    feeBasisPoints,
    feePercentFormatted: formatBasisPoints(feeBasisPoints),
    tokenSymbol: pool.tokenSymbol ?? "USDC",
  };
}

export interface LiveYieldCalculationParams {
  baseUi: number;
  tvlUi: number;
  apy: number;
  feeBasisPoints?: number;
  lastSyncedAt?: number;
  nowInSeconds: number;
  isFrozenForDraw?: boolean;
  enabled?: boolean;
}

/**
 * Pure, deterministic live yield calculation engine.
 * Reused by hooks, ticker loops, and unit tests without duplication.
 */
export function calculateLiveYield({
  baseUi,
  tvlUi,
  apy,
  feeBasisPoints = 0,
  lastSyncedAt,
  nowInSeconds,
  isFrozenForDraw = false,
  enabled = true,
}: LiveYieldCalculationParams): number {
  if (
    isFrozenForDraw ||
    !enabled ||
    tvlUi <= 0 ||
    apy <= 0 ||
    !lastSyncedAt ||
    lastSyncedAt <= 0
  ) {
    return baseUi;
  }
  // Guard against clock drift or negative elapsed time
  const elapsed = Math.max(0, nowInSeconds - lastSyncedAt);
  const netApy = calculateNetApy(apy, feeBasisPoints);
  const netYieldAccrued = (tvlUi * netApy * elapsed) / SECONDS_PER_YEAR;
  const currentVal = baseUi + netYieldAccrued;
  return Number.isFinite(currentVal) ? currentVal : baseUi;
}

export interface LiveYieldBreakdown {
  grossYieldUi: number;
  protocolFeeUi: number;
  netYieldUi: number;
  underlyingApy: number;
  feeBasisPoints: number;
}

/**
 * Pure, deterministic live yield breakdown engine.
 * Guarantees mathematical consistency: Gross = Net + ProtocolFee at all timestamps.
 */
export function calculateLiveYieldBreakdown(
  pool: PoolInfo,
  nowInSeconds: number,
  decimals: number = pool.tokenDecimals ?? USDC_DECIMALS
): LiveYieldBreakdown {
  const breakdown = resolvePoolYieldBreakdown(pool, decimals);
  const tvlUi = (pool.totalDepositedPrincipal ?? 0) / 10 ** decimals;
  const apy = pool.underlyingApy ?? DEFAULT_APY;
  const feeBasisPoints = pool.feeBasisPoints ?? 0;
  const lastSyncedAt = pool.lastSyncedAt;
  const isFrozenForDraw = pool.isFrozenForDraw ?? false;

  const grossYieldUi = calculateLiveYield({
    baseUi: breakdown.grossYieldUi,
    tvlUi,
    apy,
    feeBasisPoints: 0,
    lastSyncedAt,
    nowInSeconds,
    isFrozenForDraw,
  });

  const netYieldUi = calculateLiveYield({
    baseUi: breakdown.netYieldUi,
    tvlUi,
    apy,
    feeBasisPoints,
    lastSyncedAt,
    nowInSeconds,
    isFrozenForDraw,
  });

  const protocolFeeUi = Math.max(0, grossYieldUi - netYieldUi);

  return {
    grossYieldUi,
    protocolFeeUi,
    netYieldUi,
    underlyingApy: breakdown.underlyingApy,
    feeBasisPoints: breakdown.feeBasisPoints,
  };
}

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
 * Canonical token-aware 60 FPS live currency formatter with optional prefix sign (+, -, ~).
 */
export function formatLiveYieldMetric(
  amountUi: number,
  tokenSymbol: string = "USDC",
  prefix: string = "",
  precision: number = DEFAULT_LIVE_YIELD_PRECISION
): string {
  const safeAmount = Number.isFinite(amountUi) ? amountUi : 0;
  const formatted = getLiveYieldFormatter(precision).format(safeAmount);
  if (tokenSymbol.toUpperCase() === "USDC") {
    return `${prefix}$${formatted}`;
  }
  return `${prefix}${formatted} ${tokenSymbol}`;
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
  return formatLiveYieldMetric(amount, tokenSymbol, "", precision);
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
  const numAmount = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(numAmount)) {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[formatTokenAmount] Invalid non-finite amount received: ${amount}. Defaulting to 0.`
      );
    }
  }
  const safeAmount = Number.isFinite(numAmount) ? numAmount : 0;

  const finalMax =
    maxFractionDigits ??
    (minFractionDigits < 2
      ? minFractionDigits
      : Math.max(minFractionDigits, 6));

  return (safeAmount / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: minFractionDigits,
    maximumFractionDigits: finalMax,
  });
}

/**
 * Formats a token base-unit amount into a currency-aware string.
 * - For USDC (case-insensitive): "$5.00" (minFractionDigits=2) or "$100,000" (minFractionDigits=0)
 * - For non-USDC (e.g. SOL): "0.05 SOL" or "1.50 WBTC"
 */
export function formatCurrencyAmount(
  amountBase: number,
  tokenSymbol: string = "USDC",
  decimals: number = USDC_DECIMALS,
  minFractionDigits: number = 2,
  maxFractionDigits?: number
): string {
  const isUsd = (tokenSymbol || "USDC").toUpperCase() === "USDC";
  const formatted = formatTokenAmount(
    amountBase,
    decimals,
    minFractionDigits,
    maxFractionDigits
  );
  return isUsd ? `$${formatted}` : `${formatted} ${tokenSymbol}`;
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

export interface AnnualDrawEntriesResult {
  drawsPerYear: number;
  annualEntries: number;
}

/**
 * Calculates annual draw chances/entries dynamically based on user tickets and pool stake cycle duration.
 *
 * @param totalTickets - The user's active and pending tickets.
 * @param stakeCycleDurationHrs - The pool's cycle duration in hours (defaults to 168h for weekly).
 * @returns AnnualDrawEntriesResult containing computed drawsPerYear and total annualEntries.
 */
export function calculateAnnualDrawEntries(
  totalTickets: number,
  stakeCycleDurationHrs?: number
): AnnualDrawEntriesResult {
  const safeTickets = Math.max(0, Math.floor(totalTickets || 0));
  const safeCycleHrs =
    typeof stakeCycleDurationHrs === "number" &&
    Number.isFinite(stakeCycleDurationHrs) &&
    stakeCycleDurationHrs > 0
      ? stakeCycleDurationHrs
      : 168; // Default 168h = 7d weekly cycle

  const drawsPerYear = Math.max(1, Math.round((365 * 24) / safeCycleHrs));
  const annualEntries = safeTickets * drawsPerYear;

  return { drawsPerYear, annualEntries };
}

export type CycleFrequency = "daily" | "weekly" | "monthly" | "custom";

/**
 * Returns the coarse frequency category for a given cycle duration in hours.
 */
export function getCycleFrequency(durationHrs: number): CycleFrequency {
  if (durationHrs <= 24) return "daily";
  if (durationHrs === 168) return "weekly";
  if (durationHrs >= 672 && durationHrs <= 744) return "monthly";
  return "custom";
}

/**
 * Formats cycle frequency into a localized label using translation keys.
 */
export function formatCycleFrequency(
  durationHrs: number,
  t: (key: string, values?: Record<string, string | number>) => string
): string {
  const freq = getCycleFrequency(durationHrs);
  switch (freq) {
    case "daily":
      return t("freqDaily");
    case "weekly":
      return t("freqWeekly");
    case "monthly":
      return t("freqMonthly");
    case "custom":
    default:
      return t("freqHours", { hours: durationHrs });
  }
}
