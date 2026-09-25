import type {
  PoolInfo,
  YieldBreakdown,
  YieldThresholdProgress,
  PoolThresholdBreakdown,
} from "../types";

export const USDC_DECIMALS = 6;
export const USDC_MINT =
  process.env.NEXT_PUBLIC_USDC_MINT ||
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
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
  const config = getTokenFormattingConfig(tokenSymbol);
  const formatted = getLiveYieldFormatter(precision).format(safeAmount);
  if (config.isFiatPrefix) {
    return `${prefix}$${formatted}`;
  }
  return `${prefix}${formatted} ${config.symbol}`;
}

export interface TokenFormattingConfig {
  readonly symbol: string;
  readonly defaultDecimals: number;
  readonly displayDecimals: number;
  readonly isFiatPrefix: boolean;
  readonly dustThresholdUi: number;
  readonly defaultPayoutThresholdUi: number;
}

export const TOKEN_FORMATTING_CONFIGS: Record<string, TokenFormattingConfig> = {
  USDC: {
    symbol: "USDC",
    defaultDecimals: 6,
    displayDecimals: 2,
    isFiatPrefix: true,
    dustThresholdUi: 0.01,
    defaultPayoutThresholdUi: 10.0,
  },
  SOL: {
    symbol: "SOL",
    defaultDecimals: 9,
    displayDecimals: 4,
    isFiatPrefix: false,
    dustThresholdUi: 0.0001,
    defaultPayoutThresholdUi: 0.05,
  },
  WBTC: {
    symbol: "WBTC",
    defaultDecimals: 8,
    displayDecimals: 6,
    isFiatPrefix: false,
    dustThresholdUi: 0.00001,
    defaultPayoutThresholdUi: 0.0005,
  },
};

export function getTokenFormattingConfig(
  symbol: string = "USDC"
): TokenFormattingConfig {
  const upper = (symbol || "USDC").toUpperCase();
  return (
    TOKEN_FORMATTING_CONFIGS[upper] ?? {
      symbol: upper,
      defaultDecimals: 6,
      displayDecimals: 2,
      isFiatPrefix: false,
      dustThresholdUi: 0.01,
      defaultPayoutThresholdUi: 10.0,
    }
  );
}

export function toSafeBigInt(amount: bigint | number | string): bigint {
  if (typeof amount === "bigint") return amount;
  if (typeof amount === "number") {
    if (!Number.isFinite(amount)) return 0n;
    return BigInt(Math.trunc(amount));
  }
  try {
    const clean = amount.trim().replace(/,/g, "");
    if (!clean) return 0n;
    const isNeg = clean.startsWith("-");
    const digitsOnly = clean.replace(/^[+-]/, "");
    const integerPart = digitsOnly.split(".")[0];
    if (!integerPart) return 0n;
    const val = BigInt(integerPart);
    return isNeg ? -val : val;
  } catch {
    return 0n;
  }
}

const numberFormatCache = new Map<string, Intl.NumberFormat>();

export function getCachedNumberFormatter(
  minFractionDigits: number,
  maxFractionDigits: number,
  locale: string = "en-US"
): Intl.NumberFormat {
  const key = `${locale}:${minFractionDigits}:${maxFractionDigits}`;
  let fmt = numberFormatCache.get(key);
  if (!fmt) {
    fmt = new Intl.NumberFormat(locale, {
      minimumFractionDigits: minFractionDigits,
      maximumFractionDigits: maxFractionDigits,
    });
    numberFormatCache.set(key, fmt);
  }
  return fmt;
}

/**
 * Internal BigInt formatting kernel shared by formatCurrency and formatBalanceAmount.
 * Ensures numerical precision safety, negative modulo safety, and strict rounding/truncation.
 */
export function formatBaseUnitsToString(
  absRaw: bigint,
  decimals: number,
  minFractionDigits: number,
  maxFractionDigits: number,
  roundingMode: "round" | "trunc" = "round"
): string {
  const minDigits = Math.max(0, minFractionDigits);
  const maxDigits = Math.max(minDigits, maxFractionDigits);

  if (decimals === 0) {
    const wholeStr = absRaw.toLocaleString("en-US");
    if (minDigits > 0) {
      return `${wholeStr}.${"0".repeat(minDigits)}`;
    }
    return wholeStr;
  }

  if (decimals >= maxDigits) {
    const scaleDiff = decimals - maxDigits;
    let scaled: bigint;
    if (roundingMode === "round" && scaleDiff > 0) {
      const half = 10n ** BigInt(scaleDiff) / 2n;
      scaled = (absRaw + half) / 10n ** BigInt(scaleDiff);
    } else if (scaleDiff > 0) {
      scaled = absRaw / 10n ** BigInt(scaleDiff);
    } else {
      scaled = absRaw;
    }

    const divisor = 10n ** BigInt(maxDigits);
    const wholePart = maxDigits > 0 ? scaled / divisor : scaled;
    let fracPart =
      maxDigits > 0
        ? (scaled % divisor).toString().padStart(maxDigits, "0")
        : "";

    if (maxDigits > minDigits) {
      // Trim trailing zeros down to at least minDigits
      fracPart = fracPart.replace(/0+$/, "");
      if (fracPart.length < minDigits) {
        fracPart = fracPart.padEnd(minDigits, "0");
      }
    }

    const wholeStr = wholePart.toLocaleString("en-US");
    return fracPart.length > 0 ? `${wholeStr}.${fracPart}` : wholeStr;
  } else {
    // decimals < maxDigits
    const divisor = 10n ** BigInt(decimals);
    const wholePart = absRaw / divisor;
    let fracPart =
      decimals > 0 ? (absRaw % divisor).toString().padStart(decimals, "0") : "";

    if (fracPart.length < minDigits) {
      fracPart = fracPart.padEnd(minDigits, "0");
    }

    const wholeStr = wholePart.toLocaleString("en-US");
    return fracPart.length > 0 ? `${wholeStr}.${fracPart}` : wholeStr;
  }
}

export type SupportedTokenSymbol = "USDC" | "SOL" | "WBTC";
export type CurrencyDisplayStyle = "standard" | "withSymbol" | "numericOnly";

export interface CurrencyTokenInfo {
  tokenSymbol?: string;
  tokenDecimals?: number;
}

export interface FormatCurrencyOptions {
  /** Token symbol (defaults to "USDC") */
  tokenSymbol?: SupportedTokenSymbol | (string & {});
  /** Decimals for base-to-UI conversion. If omitted, looked up from TOKEN_FORMATTING_CONFIGS (defaults to 6 for USDC) */
  decimals?: number;
  /** Minimum fraction digits (defaults to config.displayDecimals, e.g. 2 for USDC, 4 for SOL) */
  minFractionDigits?: number;
  /** Maximum fraction digits (defaults to Math.max(minFractionDigits, config.displayDecimals)) */
  maxFractionDigits?: number;
  /** Display style:
   * - "standard": "$1,234.56" for USD, "1,234.56 SOL" for non-USD
   * - "withSymbol": "$1,234.56 USDC" for USD, "1,234.56 SOL" for non-USD
   * - "numericOnly": "1,234.56" (no currency symbol or ticker)
   */
  style?: CurrencyDisplayStyle;
  /** Optional decoration sign (+ for deltas, ~ for estimates). Negative signs are handled intrinsically ("-$5.00" or "~-$5.00"). */
  prefix?: "+" | "~" | (string & {});
  /** Rounding mode: "round" (half-up) or "trunc" (strict floor truncation for balances to satisfy INV-FORMAT-002) */
  roundingMode?: "round" | "trunc";
  /** Fallback string when amount is null, undefined, or NaN (defaults to "—") */
  fallback?: string;
}

export function formatCurrency(
  amountBase: bigint | number | string | null | undefined,
  pool: CurrencyTokenInfo | null | undefined,
  overrides?: Omit<FormatCurrencyOptions, "tokenSymbol" | "decimals">
): string;

export function formatCurrency(
  amountBase: bigint | number | string | null | undefined,
  options?: FormatCurrencyOptions
): string;

export function formatCurrency(
  amountBase: bigint | number | string | null | undefined,
  poolOrOptions?: CurrencyTokenInfo | FormatCurrencyOptions | null,
  overrides?: Omit<FormatCurrencyOptions, "tokenSymbol" | "decimals">
): string {
  let options: FormatCurrencyOptions = {};
  if (poolOrOptions) {
    if ("tokenDecimals" in poolOrOptions || overrides !== undefined) {
      const pool = poolOrOptions as CurrencyTokenInfo;
      options = {
        tokenSymbol: pool.tokenSymbol,
        decimals: pool.tokenDecimals,
        ...overrides,
      };
    } else {
      options = poolOrOptions as FormatCurrencyOptions;
    }
  } else if (overrides) {
    options = { ...overrides };
  }

  const fallback = options.fallback ?? "—";

  if (amountBase === null || amountBase === undefined) {
    return fallback;
  }
  if (typeof amountBase === "number" && Number.isNaN(amountBase)) {
    return fallback;
  }
  if (typeof amountBase === "string" && amountBase.trim() === "") {
    return fallback;
  }

  if (process.env.NODE_ENV === "development") {
    if (typeof amountBase === "number" && !Number.isInteger(amountBase)) {
      console.warn(
        `[formatCurrency] Received float number "${amountBase}" as base units. Base units should be integers or BigInt. Use formatUiCurrency if the value is already in UI decimal units.`
      );
    }
  }

  const config = getTokenFormattingConfig(options.tokenSymbol);
  const decimals = options.decimals ?? config.defaultDecimals;
  const minDigits = options.minFractionDigits ?? config.displayDecimals;
  const maxDigits =
    options.maxFractionDigits ?? Math.max(minDigits, config.displayDecimals);
  const style = options.style ?? "standard";
  const prefix = options.prefix ?? "";
  const roundingMode = options.roundingMode ?? "round";

  const raw = toSafeBigInt(amountBase);
  const isNegative = raw < 0n;
  const absRaw = isNegative ? -raw : raw;

  const numericStr = formatBaseUnitsToString(
    absRaw,
    decimals,
    minDigits,
    maxDigits,
    roundingMode
  );

  let prefixPart = "";
  if (isNegative) {
    prefixPart = prefix === "~" ? "~-" : "-";
  } else if (prefix) {
    prefixPart = prefix;
  }

  if (style === "numericOnly") {
    return `${prefixPart}${numericStr}`;
  }

  if (config.isFiatPrefix) {
    if (style === "withSymbol") {
      return `${prefixPart}$${numericStr} ${config.symbol}`;
    }
    return `${prefixPart}$${numericStr}`;
  }

  return `${prefixPart}${numericStr} ${config.symbol}`;
}

export function createCurrencyFormatter(pool?: CurrencyTokenInfo) {
  return (
    amount: bigint | number | string | null | undefined,
    overrides?: Omit<FormatCurrencyOptions, "tokenSymbol" | "decimals">
  ) =>
    pool
      ? formatCurrency(amount, pool, overrides)
      : formatCurrency(amount, overrides);
}

export interface FormatUiCurrencyOptions {
  tokenSymbol?: SupportedTokenSymbol | (string & {});
  minFractionDigits?: number;
  maxFractionDigits?: number;
  style?: CurrencyDisplayStyle;
  prefix?: "+" | "~" | (string & {});
  fallback?: string;
}

export function formatUiCurrency(
  amountUi: number | null | undefined,
  options?: FormatUiCurrencyOptions
): string {
  if (
    amountUi === null ||
    amountUi === undefined ||
    !Number.isFinite(amountUi)
  ) {
    return options?.fallback ?? "—";
  }
  const config = getTokenFormattingConfig(options?.tokenSymbol);
  const minDigits =
    options?.minFractionDigits ??
    (options?.maxFractionDigits !== undefined ? 0 : config.displayDecimals);
  const maxDigits =
    options?.maxFractionDigits ?? Math.max(minDigits, config.displayDecimals);
  const style = options?.style ?? "standard";
  const prefix = options?.prefix ?? "";

  const isNegative = amountUi < 0;
  const absVal = Math.abs(amountUi);
  const fmt = getCachedNumberFormatter(minDigits, maxDigits);
  const numericStr = fmt.format(absVal);

  let prefixPart = "";
  if (isNegative) {
    prefixPart = prefix === "~" ? "~-" : "-";
  } else if (prefix) {
    prefixPart = prefix;
  }

  if (style === "numericOnly") {
    return `${prefixPart}${numericStr}`;
  }
  if (config.isFiatPrefix) {
    if (style === "withSymbol") {
      return `${prefixPart}$${numericStr} ${config.symbol}`;
    }
    return `${prefixPart}$${numericStr}`;
  }
  return `${prefixPart}${numericStr} ${config.symbol}`;
}

export interface FormatBalanceOptions {
  decimals?: number;
  tokenSymbol?: string;
  displayDecimals?: number;
  roundingMode?: "trunc" | "round";
}

export interface FormattedBalanceResult {
  /** Truncated display string (e.g. "9.99" or "< 0.01") */
  display: string;
  /** Formatted with currency prefix/suffix (e.g. "$9.99 USDC" or "< $0.01 USDC" or "0.0543 SOL") */
  displayWithCurrency: string;
  /** Full precision string without scientific notation (e.g. "9.996000") */
  full: string;
  /** Full precision string with symbol (e.g. "9.996000 USDC") */
  fullWithCurrency: string;
  /** Whether the balance is non-zero but below the minimum display threshold */
  isBelowThreshold: boolean;
  /** Backwards-compatible alias for USD */
  isSubCent: boolean;
  /** Whether the balance is strictly zero */
  isZero: boolean;
  /** Raw base units as BigInt */
  rawBaseUnits: bigint;
}

/**
 * Pure deterministic BigInt division & balance formatting engine.
 * Guarantees INV-FORMAT-002: DisplayAmount <= OnChainAmount.
 */
export function formatBalanceAmount(
  amountBase: bigint | number | string,
  optionsOrDecimals?: FormatBalanceOptions | number,
  legacyTokenSymbol?: string,
  legacyDisplayDecimals?: number
): FormattedBalanceResult {
  const options: FormatBalanceOptions =
    typeof optionsOrDecimals === "object"
      ? optionsOrDecimals
      : {
          decimals: optionsOrDecimals,
          tokenSymbol: legacyTokenSymbol,
          displayDecimals: legacyDisplayDecimals,
        };

  const config = getTokenFormattingConfig(options.tokenSymbol);
  const decimals = options.decimals ?? config.defaultDecimals;
  const displayDecimals = options.displayDecimals ?? config.displayDecimals;
  const roundingMode = options.roundingMode ?? "trunc";

  let raw = toSafeBigInt(amountBase);
  if (raw < 0n) raw = 0n;

  const isZero = raw === 0n;
  const divisor = 10n ** BigInt(decimals);

  // 1. Full precision string (pure BigInt, zero IEEE-754 precision loss)
  const fullWhole = raw / divisor;
  const fullFrac =
    decimals > 0 ? (raw % divisor).toString().padStart(decimals, "0") : "";
  const full =
    decimals > 0
      ? `${fullWhole.toLocaleString("en-US")}.${fullFrac}`
      : fullWhole.toLocaleString("en-US");
  const fullWithCurrency = `${full} ${config.symbol}`;

  // 2. Truncation and Sub-Threshold Evaluation
  let display = "";
  let isBelowThreshold = false;

  if (isZero) {
    display = displayDecimals > 0 ? `0.${"0".repeat(displayDecimals)}` : "0";
  } else if (decimals >= displayDecimals) {
    const scaleDiff = decimals - displayDecimals;
    const thresholdBase = 10n ** BigInt(scaleDiff);

    if (raw < thresholdBase && roundingMode === "trunc") {
      isBelowThreshold = true;
      const subThresholdVal =
        displayDecimals > 0 ? `0.${"0".repeat(displayDecimals - 1)}1` : "1";
      display = `< ${subThresholdVal}`;
    } else {
      display = formatBaseUnitsToString(
        raw,
        decimals,
        displayDecimals,
        displayDecimals,
        roundingMode
      );
    }
  } else {
    // decimals < displayDecimals (e.g. 0-decimal token with displayDecimals=2)
    display = formatBaseUnitsToString(
      raw,
      decimals,
      displayDecimals,
      displayDecimals,
      roundingMode
    );
  }

  // 3. Display with Currency Prefix/Suffix
  let displayWithCurrency = "";
  if (config.isFiatPrefix) {
    if (isBelowThreshold) {
      displayWithCurrency = `< $${display.replace("< ", "")} ${config.symbol}`;
    } else {
      displayWithCurrency = `$${display} ${config.symbol}`;
    }
  } else {
    displayWithCurrency = `${display} ${config.symbol}`;
  }

  return {
    display,
    displayWithCurrency,
    full,
    fullWithCurrency,
    isBelowThreshold,
    isSubCent: isBelowThreshold,
    isZero,
    rawBaseUnits: raw,
  };
}

/**
 * Returns token-aware threshold UI amount for estimated tier payout display.
 */
export function getPoolPayoutThresholdUi(tokenSymbol: string = "USDC"): number {
  return getTokenFormattingConfig(tokenSymbol).defaultPayoutThresholdUi;
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

export type TierLabelFormat = "full" | "rank" | "title" | "short" | "tierOnly";

export interface LocalizedTierLabelOptions {
  format?: TierLabelFormat;
}

export interface LocalizedTierParts {
  rank: string;
  title?: string;
  compound: string;
}

export type TierTranslationFn = (
  key: string,
  values?: Record<string, string | number>
) => string;

/**
 * Pure domain decomposition for prize tiers into rank, honorary title, and compound string.
 */
export function getLocalizedTierParts(
  tierIndex: number,
  t: TierTranslationFn
): LocalizedTierParts {
  if (!Number.isFinite(tierIndex) || tierIndex < 0) {
    return { rank: "", compound: "" };
  }
  const tierNum = Math.floor(tierIndex) + 1;
  const rank = t("tierN", { tier: tierNum });

  if (tierIndex === 0) {
    const title = t("grand");
    return {
      rank,
      title,
      compound: t("tierWithTitle", { tier: 1, title }),
    };
  }

  return { rank, compound: rank };
}

/**
 * Resolves localized tier label consistently across PoolCard, PrizeTiersModal, and winner tables.
 * - "rank" (or "tierOnly"): Always "Tier {N}" (e.g. "Tier 1", "Tier 2")
 * - "title" (or "short"): Honorary title if available ("Grand Prize"), otherwise "Tier {N}"
 * - "full": Compound label ("Tier 1 · Grand Prize" or "Tier {N}")
 */
export function getLocalizedTierLabel(
  tierIndex: number,
  t: TierTranslationFn,
  options?: LocalizedTierLabelOptions
): string {
  const parts = getLocalizedTierParts(tierIndex, t);
  const format = options?.format ?? "full";

  switch (format) {
    case "rank":
    case "tierOnly":
      return parts.rank;
    case "title":
    case "short":
      return parts.title ?? parts.rank;
    case "full":
    default:
      return parts.compound;
  }
}

export interface TierThemeConfig {
  icon: string;
  badgeStyles: string;
  textClass: string;
  barClass: string;
}

export const TIER_THEMES: Record<number, TierThemeConfig> = {
  0: {
    icon: "🏆",
    badgeStyles:
      "bg-amber-500/10 border-amber-500/30 text-amber-300 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
    textClass: "text-amber-400",
    barClass: "bg-amber-400",
  },
  1: {
    icon: "🥈",
    badgeStyles: "bg-secondary/10 border-secondary/30 text-secondary",
    textClass: "text-secondary",
    barClass: "bg-secondary",
  },
  2: {
    icon: "🥉",
    badgeStyles: "bg-tertiary/10 border-tertiary/30 text-tertiary",
    textClass: "text-tertiary",
    barClass: "bg-tertiary",
  },
};

export const DEFAULT_TIER_THEME: TierThemeConfig = {
  icon: "🏅",
  badgeStyles:
    "bg-surface-variant border-outline-variant/30 text-on-surface-variant",
  textClass: "text-on-surface-variant",
  barClass: "bg-primary/70",
};

export function getTierTheme(tierIndex: number): TierThemeConfig {
  if (!Number.isFinite(tierIndex) || tierIndex < 0) {
    return DEFAULT_TIER_THEME;
  }
  return TIER_THEMES[tierIndex] ?? DEFAULT_TIER_THEME;
}

/** Convert a human-readable USDC amount to on-chain base units. */
export function usdc(amount: number): number {
  return Math.round(amount * 10 ** USDC_DECIMALS);
}

/** Unix timestamp in seconds, offset from now by the given hours. */
export function hoursFromNow(hours: number): number {
  return Math.floor(Date.now() / 1000) + hours * 3600;
}

export interface FormatTokenOptions {
  decimals?: number;
  minFractionDigits?: number;
  maxFractionDigits?: number;
}

/** Format base-unit amount to human-readable string with commas. */
export function formatTokenAmount(
  amount: number | bigint,
  decimalsOrOptions?: number | FormatTokenOptions,
  minFractionDigits: number = 2,
  maxFractionDigits?: number
): string {
  const options: FormatTokenOptions =
    typeof decimalsOrOptions === "object"
      ? decimalsOrOptions
      : {
          decimals: decimalsOrOptions,
          minFractionDigits,
          maxFractionDigits,
        };

  const decimals = options.decimals ?? USDC_DECIMALS;
  const minFrac = options.minFractionDigits ?? 2;
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
    options.maxFractionDigits ?? (minFrac < 2 ? minFrac : Math.max(minFrac, 6));

  return (safeAmount / 10 ** decimals).toLocaleString("en-US", {
    minimumFractionDigits: minFrac,
    maximumFractionDigits: finalMax,
  });
}

/** Map tier index to a Tailwind color class. */
export function tierColor(tierIndex: number): string {
  return getTierTheme(tierIndex).textClass;
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

/** Sanitizes raw ticket/bond input by stripping non-numeric characters */
export function sanitizeTicketNumber(ticket?: string | number): string {
  if (ticket === undefined || ticket === null) return "";
  return String(ticket).replace(/[^0-9]/g, "");
}

/** Formats a ticket/bond string or number with canonical '#' prefix and en-US thousands separators */
export function formatTicketNumber(ticket?: string | number): string {
  const clean = sanitizeTicketNumber(ticket);
  if (!clean) return "N/A";
  const num = Number(clean);
  if (Number.isFinite(num)) {
    return `#${num.toLocaleString("en-US")}`;
  }
  return `#${clean}`;
}
