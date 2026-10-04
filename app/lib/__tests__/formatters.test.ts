import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrency,
  formatUiCurrency,
  createCurrencyFormatter,
  formatBaseUnitsToString,
  formatTokenAmount,
  formatTokenBalance,
  formatBalanceAmount,
  toSafeBigInt,
  getTokenFormattingConfig,
  formatLiveYieldMetric,
  getLiveYieldFormatter,
  formatTierPayoutAmount,
  DEFAULT_LIVE_YIELD_PRECISION,
  USDC_DECIMALS,
  formatTicketNumber,
  sanitizeTicketNumber,
  getLocalizedTierLabel,
  getLocalizedTierParts,
  getTierTheme,
  DEFAULT_TIER_THEME,
  TIER_THEMES,
  tierColor,
  type TierTranslationFn,
  truncateMiddle,
  truncateAddress,
  truncateSignature,
  truncateHash,
} from "../formatters";

describe("Currency & Token Formatters Unit Tests", () => {
  describe("formatCurrency Core Abstraction", () => {
    it("should format fractional USDC amounts to exact cents with dollar prefix (floor truncation by default)", () => {
      // 49.50 USDC = 49_500_000 base units (after 1% protocol fee on 50 USDC)
      const formatted = formatCurrency(49_500_000, {
        tokenSymbol: "USDC",
        decimals: USDC_DECIMALS,
        minFractionDigits: 2,
        maxFractionDigits: 2,
      });
      assert.strictEqual(formatted, "$49.50");
    });

    it("should format whole dollar amounts with 2 decimal places by default for USDC", () => {
      const formatted = formatCurrency(50_000_000n);
      assert.strictEqual(formatted, "$50.00");
    });

    it("should support direct PoolInfo / CurrencyTokenInfo object via overload", () => {
      const pool = {
        tokenSymbol: "USDC",
        tokenDecimals: 6,
      };
      assert.strictEqual(formatCurrency(1_000_000n, pool), "$1.00");
      assert.strictEqual(
        formatCurrency(100_000_000_000n, pool, {
          minFractionDigits: 0,
          maxFractionDigits: 0,
        }),
        "$100,000"
      );
    });

    it("should format zero base units cleanly with 2 decimals", () => {
      assert.strictEqual(formatCurrency(0), "$0.00");
      assert.strictEqual(formatCurrency(0n), "$0.00");
      assert.strictEqual(formatCurrency("0"), "$0.00");
    });

    it("should insert comma thousands separators for large prize totals", () => {
      // 1,250,450.50 USDC
      const formatted = formatCurrency(1_250_450_500_000n, {
        tokenSymbol: "USDC",
        decimals: USDC_DECIMALS,
      });
      assert.strictEqual(formatted, "$1,250,450.50");
    });

    it("should format TVL with 0 decimal places when requested", () => {
      // 100,000 USDC
      const formatted = formatCurrency(100_000_000_000n, {
        minFractionDigits: 0,
        maxFractionDigits: 0,
      });
      assert.strictEqual(formatted, "$100,000");
    });

    it("should format zero TVL as $0 with 0 decimals", () => {
      const formatted = formatCurrency(0n, {
        minFractionDigits: 0,
        maxFractionDigits: 0,
      });
      assert.strictEqual(formatted, "$0");
    });

    it("should support display styles: standard, withSymbol, numericOnly", () => {
      const amount = 1_250_000_000n; // 1,250 USDC
      assert.strictEqual(
        formatCurrency(amount, { style: "standard" }),
        "$1,250.00"
      );
      assert.strictEqual(
        formatCurrency(amount, { style: "withSymbol" }),
        "$1,250.00 USDC"
      );
      assert.strictEqual(
        formatCurrency(amount, { style: "numericOnly" }),
        "1,250.00"
      );
    });

    it("should format non-USD token amounts with symbol suffix", () => {
      // 0.05 SOL with 9 decimals = 50_000_000 base units
      const formatted = formatCurrency(50_000_000n, {
        tokenSymbol: "SOL",
        decimals: 9,
        minFractionDigits: 2,
        maxFractionDigits: 2,
      });
      assert.strictEqual(formatted, "0.05 SOL");
    });

    it("should format SOL with default 4 display decimals", () => {
      const formatted = formatCurrency(54_321_000n, {
        tokenSymbol: "SOL",
        decimals: 9,
      });
      assert.strictEqual(formatted, "0.0543 SOL");
    });

    it("should position negative signs intrinsically before currency symbol", () => {
      assert.strictEqual(formatCurrency(-5_000_000n), "-$5.00");
      assert.strictEqual(
        formatCurrency(-50_000_000n, {
          tokenSymbol: "SOL",
          decimals: 9,
          minFractionDigits: 2,
        }),
        "-0.05 SOL"
      );
    });

    it("should guarantee negative modulo safety without corrupting string", () => {
      const formatted = formatCurrency(-5_000_001n);
      assert.strictEqual(formatted, "-$5.00");
      const unrounded = formatCurrency(-5_000_001n, {
        minFractionDigits: 6,
        maxFractionDigits: 6,
      });
      assert.strictEqual(unrounded, "-$5.000001");
    });

    it("should handle prefix interactions (+, ~) correctly with positive and negative amounts", () => {
      assert.strictEqual(formatCurrency(5_000_000n, { prefix: "+" }), "+$5.00");
      assert.strictEqual(
        formatCurrency(-5_000_000n, { prefix: "+" }),
        "-$5.00"
      );
      assert.strictEqual(formatCurrency(5_000_000n, { prefix: "~" }), "~$5.00");
      assert.strictEqual(
        formatCurrency(-5_000_000n, { prefix: "~" }),
        "~-$5.00"
      );
    });

    it("should respect floor truncation by default and round mode when specified", () => {
      // 9.999999 USDC with default trunc -> $9.99
      assert.strictEqual(formatCurrency(9_999_999n), "$9.99");
      assert.strictEqual(
        formatCurrency(9_999_999n, {
          roundingMode: "trunc",
        }),
        "$9.99"
      );
      // 9.999999 USDC with round -> $10.00
      assert.strictEqual(
        formatCurrency(9_999_999n, {
          roundingMode: "round",
        }),
        "$10.00"
      );
    });

    it("should handle null, undefined, NaN and custom fallbacks gracefully", () => {
      assert.strictEqual(formatCurrency(null), "—");
      assert.strictEqual(formatCurrency(undefined), "—");
      assert.strictEqual(formatCurrency(NaN), "—");
      assert.strictEqual(formatCurrency(""), "—");
      assert.strictEqual(formatCurrency(null, { fallback: "N/A" }), "N/A");
      assert.strictEqual(formatCurrency(undefined, { fallback: "--" }), "--");
    });

    it("should safely format u64::MAX without overflow or NaN", () => {
      const u64Max = 18_446_744_073_709_551_615n;
      const formatted = formatCurrency(u64Max);
      assert.ok(formatted.startsWith("$18,446,744,073,709.55"));
    });
  });

  describe("createCurrencyFormatter (Bound Helper)", () => {
    it("should produce a bound formatter for a pool", () => {
      const pool = { tokenSymbol: "USDC", tokenDecimals: 6 };
      const fmt = createCurrencyFormatter(pool);
      assert.strictEqual(fmt(5_000_000n), "$5.00");
      assert.strictEqual(
        fmt(100_000_000_000n, { minFractionDigits: 0, maxFractionDigits: 0 }),
        "$100,000"
      );
      assert.strictEqual(fmt(null), "—");
    });

    it("should work without a pool argument", () => {
      const fmt = createCurrencyFormatter();
      assert.strictEqual(fmt(1_000_000n), "$1.00");
      assert.strictEqual(fmt(null), "—");
    });
  });

  describe("formatUiCurrency (Decimal Float Formatter)", () => {
    it("should format decimal float values for USD and non-USD tokens", () => {
      assert.strictEqual(formatUiCurrency(1250.5), "$1,250.50");
      assert.strictEqual(
        formatUiCurrency(0.005, {
          tokenSymbol: "SOL",
          prefix: "~",
          maxFractionDigits: 5,
        }),
        "~0.005 SOL"
      );
      assert.strictEqual(
        formatUiCurrency(100, {
          tokenSymbol: "USDC",
          style: "withSymbol",
        }),
        "$100.00 USDC"
      );
      assert.strictEqual(
        formatUiCurrency(-25.5, {
          tokenSymbol: "USDC",
          prefix: "~",
        }),
        "~-$25.50"
      );
    });

    it("should handle null, undefined, NaN for formatUiCurrency", () => {
      assert.strictEqual(formatUiCurrency(null), "—");
      assert.strictEqual(formatUiCurrency(undefined), "—");
      assert.strictEqual(formatUiCurrency(NaN), "—");
      assert.strictEqual(formatUiCurrency(null, { fallback: "Free" }), "Free");
    });

    it("should guarantee float safety without IEEE-754 floor bugs", () => {
      assert.strictEqual(
        formatUiCurrency(1.005, { roundingMode: "trunc" }),
        "$1.00"
      );
      assert.strictEqual(
        formatUiCurrency(29.999, { roundingMode: "trunc" }),
        "$29.99"
      );
      assert.strictEqual(
        formatUiCurrency(0.9999999999999999, { roundingMode: "trunc" }),
        "$1.00"
      );
    });

    it("should support ceiling rounding mode for fees", () => {
      assert.strictEqual(
        formatUiCurrency(0.00001, {
          tokenSymbol: "SOL",
          maxFractionDigits: 4,
          roundingMode: "ceil",
        }),
        "0.0001 SOL"
      );
      assert.strictEqual(
        formatUiCurrency(0.0054321, {
          tokenSymbol: "SOL",
          maxFractionDigits: 4,
          roundingMode: "ceil",
        }),
        "0.0055 SOL"
      );
    });
  });

  describe("formatBaseUnitsToString (Shared Kernel 3-Mode Rounding)", () => {
    it("should format BigInt base units with exact rounding and precision", () => {
      assert.strictEqual(
        formatBaseUnitsToString(49_500_000n, 6, 2, 2, "round"),
        "49.50"
      );
      assert.strictEqual(
        formatBaseUnitsToString(9_999_999n, 6, 2, 2, "trunc"),
        "9.99"
      );
      assert.strictEqual(
        formatBaseUnitsToString(100_000_000_000n, 6, 0, 0, "round"),
        "100,000"
      );
      assert.strictEqual(formatBaseUnitsToString(0n, 6, 2, 2, "round"), "0.00");
    });

    it("should support ceiling rounding mode (ceil)", () => {
      // 1 micro-unit with 2 display decimals ceil-rounds to 0.01
      assert.strictEqual(formatBaseUnitsToString(1n, 6, 2, 2, "ceil"), "0.01");
      // Exact boundary: 10_000n with 6 decimals and 2 display decimals is 0.01
      assert.strictEqual(
        formatBaseUnitsToString(10_000n, 6, 2, 2, "ceil"),
        "0.01"
      );
      // 10_001n with 6 decimals and 2 display decimals ceil-rounds to 0.02
      assert.strictEqual(
        formatBaseUnitsToString(10_001n, 6, 2, 2, "ceil"),
        "0.02"
      );
    });
  });

  describe("formatTokenAmount Legacy Helper", () => {
    it("should clamp division fractions in average prize pots to 2 decimals using truncation", () => {
      // 33.333333 USDC from recurring pot division (e.g. 100 / 3)
      const formatted = formatTokenAmount(33_333_333, USDC_DECIMALS, 2, 2);
      assert.strictEqual(formatted, "33.33");
    });

    it("should strictly floor-truncate amounts without half-up rounding (INV-FORMAT-002)", () => {
      // 9.996 USDC must truncate to 9.99 (not round up to 10.00)
      assert.strictEqual(
        formatTokenAmount(9_996_000, USDC_DECIMALS, 2, 2),
        "9.99"
      );
      assert.strictEqual(
        formatTokenAmount(9_999_999, USDC_DECIMALS, 2, 2),
        "9.99"
      );
      assert.strictEqual(
        formatTokenAmount(999_999, USDC_DECIMALS, 2, 2),
        "0.99"
      );
    });

    it("should handle null, undefined, NaN, and string inputs gracefully", () => {
      assert.strictEqual(formatTokenAmount(null, 6), "0.00");
      assert.strictEqual(formatTokenAmount(undefined, 6), "0.00");
      assert.strictEqual(formatTokenAmount(NaN, 6), "0.00");
      assert.strictEqual(formatTokenAmount("50000000", 6), "50.00");
    });
  });

  describe("Live Ticker Precision Invariant (INV-FORMAT-001)", () => {
    it("should maintain 6 decimal places for dynamic live yield tickers", () => {
      assert.strictEqual(DEFAULT_LIVE_YIELD_PRECISION, 6);

      const liveFormatted = formatLiveYieldMetric(
        1250.003412,
        "USDC",
        "",
        DEFAULT_LIVE_YIELD_PRECISION
      );
      assert.strictEqual(liveFormatted, "$1,250.003412");
    });

    it("should format sub-cent live ticking fractions with 6 decimals", () => {
      const liveFormatted = formatLiveYieldMetric(
        0.000412,
        "USDC",
        "+",
        DEFAULT_LIVE_YIELD_PRECISION
      );
      assert.strictEqual(liveFormatted, "+$0.000412");
    });

    it("should format cached live yield formatter at 60 FPS without precision degradation", () => {
      const formatter = getLiveYieldFormatter(6);
      assert.strictEqual(formatter.format(49.5), "49.500000");
      assert.strictEqual(formatter.format(0.000001), "0.000001");
    });
  });

  describe("Tier Payout Amount Formatting (formatTierPayoutAmount)", () => {
    it("should format USDC payout amount with 6 decimals by default", () => {
      assert.strictEqual(
        formatTierPayoutAmount(1250.003412, "USDC"),
        "$1,250.003412"
      );
      assert.strictEqual(formatTierPayoutAmount(10, "USDC"), "$10.000000");
      assert.strictEqual(formatTierPayoutAmount(0.000027, "USDC"), "$0.000027");
    });

    it("should format non-USD token payout amount with 6 decimals and symbol suffix", () => {
      assert.strictEqual(
        formatTierPayoutAmount(12.345678, "SOL"),
        "12.345678 SOL"
      );
      assert.strictEqual(formatTierPayoutAmount(0.05, "SOL"), "0.050000 SOL");
    });

    it("should respect explicit custom precision parameters", () => {
      assert.strictEqual(
        formatTierPayoutAmount(1250.003412, "USDC", 2),
        "$1,250.00"
      );
      assert.strictEqual(
        formatTierPayoutAmount(1250.003412, "USDC", 4),
        "$1,250.0034"
      );
      assert.strictEqual(
        formatTierPayoutAmount(12.345678, "SOL", 2),
        "12.35 SOL"
      );
      assert.strictEqual(
        formatTierPayoutAmount(12.345678, "SOL", 4),
        "12.3457 SOL"
      );
    });
  });

  describe("Winning Bond & Ticket Number Formatters", () => {
    it("should sanitize ticket strings by stripping non-numeric characters", () => {
      assert.strictEqual(sanitizeTicketNumber("12345"), "12345");
      assert.strictEqual(sanitizeTicketNumber("#12345"), "12345");
      assert.strictEqual(sanitizeTicketNumber("Bond #987,654"), "987654");
      assert.strictEqual(sanitizeTicketNumber(42), "42");
      assert.strictEqual(sanitizeTicketNumber(undefined), "");
      assert.strictEqual(
        sanitizeTicketNumber(null as unknown as undefined),
        ""
      );
    });

    it("should format ticket numbers with canonical '#' prefix and en-US thousands separators", () => {
      assert.strictEqual(formatTicketNumber("987654"), "#987,654");
      assert.strictEqual(formatTicketNumber(12345), "#12,345");
      assert.strictEqual(formatTicketNumber(0), "#0");
      assert.strictEqual(formatTicketNumber("0"), "#0");
      assert.strictEqual(formatTicketNumber(""), "N/A");
      assert.strictEqual(formatTicketNumber(undefined), "N/A");
      assert.strictEqual(
        formatTicketNumber(null as unknown as undefined),
        "N/A"
      );
    });
  });

  describe("getLocalizedTierLabel & getLocalizedTierParts Unit Tests", () => {
    const mockTierTranslator: TierTranslationFn = (key, values) => {
      if (key === "grand") return "Grand Prize";
      if (key === "tierWithTitle")
        return `Tier ${values?.tier} · ${values?.title}`;
      if (key === "tierN") return `Tier ${values?.tier}`;
      return key;
    };

    it("should decompose tier parts correctly with getLocalizedTierParts", () => {
      // Tier 0 (Grand Prize)
      const tier0Parts = getLocalizedTierParts(0, mockTierTranslator);
      assert.deepStrictEqual(tier0Parts, {
        rank: "Tier 1",
        title: "Grand Prize",
        compound: "Tier 1 · Grand Prize",
      });

      // Tier 1..4
      const tier1Parts = getLocalizedTierParts(1, mockTierTranslator);
      assert.deepStrictEqual(tier1Parts, {
        rank: "Tier 2",
        compound: "Tier 2",
      });

      // Invalid/negative
      assert.deepStrictEqual(getLocalizedTierParts(-1, mockTierTranslator), {
        rank: "",
        compound: "",
      });
      assert.deepStrictEqual(getLocalizedTierParts(NaN, mockTierTranslator), {
        rank: "",
        compound: "",
      });
    });

    it("should return Grand Prize variants for index 0 based on format option", () => {
      assert.strictEqual(
        getLocalizedTierLabel(0, mockTierTranslator, { format: "rank" }),
        "Tier 1"
      );
      assert.strictEqual(
        getLocalizedTierLabel(0, mockTierTranslator, { format: "tierOnly" }),
        "Tier 1"
      );
      assert.strictEqual(
        getLocalizedTierLabel(0, mockTierTranslator, { format: "title" }),
        "Grand Prize"
      );
      assert.strictEqual(
        getLocalizedTierLabel(0, mockTierTranslator, { format: "short" }),
        "Grand Prize"
      );
      assert.strictEqual(
        getLocalizedTierLabel(0, mockTierTranslator, { format: "full" }),
        "Tier 1 · Grand Prize"
      );
      // Default should be full
      assert.strictEqual(
        getLocalizedTierLabel(0, mockTierTranslator),
        "Tier 1 · Grand Prize"
      );
    });

    it("should return uniform Tier K labels for indices 1..9 regardless of format option", () => {
      for (let i = 1; i < 10; i++) {
        const expected = `Tier ${i + 1}`;
        assert.strictEqual(
          getLocalizedTierLabel(i, mockTierTranslator, { format: "rank" }),
          expected
        );
        assert.strictEqual(
          getLocalizedTierLabel(i, mockTierTranslator, { format: "tierOnly" }),
          expected
        );
        assert.strictEqual(
          getLocalizedTierLabel(i, mockTierTranslator, { format: "title" }),
          expected
        );
        assert.strictEqual(
          getLocalizedTierLabel(i, mockTierTranslator, { format: "short" }),
          expected
        );
        assert.strictEqual(
          getLocalizedTierLabel(i, mockTierTranslator, { format: "full" }),
          expected
        );
        assert.strictEqual(
          getLocalizedTierLabel(i, mockTierTranslator),
          expected
        );
      }
    });

    it("should return empty string for negative or non-finite tier indices", () => {
      assert.strictEqual(getLocalizedTierLabel(-1, mockTierTranslator), "");
      assert.strictEqual(getLocalizedTierLabel(-100, mockTierTranslator), "");
      assert.strictEqual(getLocalizedTierLabel(NaN, mockTierTranslator), "");
      assert.strictEqual(
        getLocalizedTierLabel(Infinity, mockTierTranslator),
        ""
      );
      assert.strictEqual(
        getLocalizedTierLabel(-Infinity, mockTierTranslator),
        ""
      );
    });
  });

  describe("Tier Themes (getTierTheme)", () => {
    it("should return specific themes for tiers 0, 1, and 2", () => {
      assert.strictEqual(getTierTheme(0).icon, "🏆");
      assert.strictEqual(getTierTheme(1).icon, "🥈");
      assert.strictEqual(getTierTheme(2).icon, "🥉");
      assert.strictEqual(getTierTheme(0).barClass, "bg-amber-400");
      assert.strictEqual(getTierTheme(1).barClass, "bg-secondary");
      assert.strictEqual(getTierTheme(2).barClass, "bg-tertiary");
      assert.deepStrictEqual(getTierTheme(0), TIER_THEMES[0]);
      assert.deepStrictEqual(getTierTheme(1), TIER_THEMES[1]);
      assert.deepStrictEqual(getTierTheme(2), TIER_THEMES[2]);
    });

    it("should fallback gracefully for tier 3+ or unknown tiers", () => {
      const theme3 = getTierTheme(3);
      assert.strictEqual(theme3.icon, "🏅");
      assert.strictEqual(theme3.barClass, "bg-primary/70");
      assert.deepStrictEqual(theme3, DEFAULT_TIER_THEME);

      const theme99 = getTierTheme(99);
      assert.deepStrictEqual(theme99, DEFAULT_TIER_THEME);
    });

    it("should handle negative, NaN, and non-finite tier indices gracefully", () => {
      assert.deepStrictEqual(getTierTheme(-1), DEFAULT_TIER_THEME);
      assert.deepStrictEqual(getTierTheme(-100), DEFAULT_TIER_THEME);
      assert.deepStrictEqual(getTierTheme(NaN), DEFAULT_TIER_THEME);
      assert.deepStrictEqual(getTierTheme(Infinity), DEFAULT_TIER_THEME);
      assert.deepStrictEqual(getTierTheme(-Infinity), DEFAULT_TIER_THEME);
    });

    it("should delegate tierColor directly to getTierTheme textClass", () => {
      assert.strictEqual(tierColor(0), "text-amber-400");
      assert.strictEqual(tierColor(1), "text-secondary");
      assert.strictEqual(tierColor(2), "text-tertiary");
      assert.strictEqual(tierColor(3), "text-on-surface-variant");
      assert.strictEqual(tierColor(99), "text-on-surface-variant");
      assert.strictEqual(tierColor(-1), "text-on-surface-variant");
      assert.strictEqual(tierColor(NaN), "text-on-surface-variant");
    });
  });

  describe("Spendable Balance Non-Overstatement Invariant (INV-FORMAT-002) & formatTokenBalance", () => {
    describe("Floor Truncation vs Over-reporting", () => {
      it("should floor 9.996 USDC to 9.99 instead of rounding up to 10.00", () => {
        const result = formatTokenBalance(9_996_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "9.99");
        assert.strictEqual(result.formatted, "$9.99");
        assert.strictEqual(result.full, "9.996000");
        assert.strictEqual(result.fullWithSymbol, "9.996000 USDC");
        assert.strictEqual(result.isBelowThreshold, false);

        // formatBalanceAmount alias parity check
        const aliasResult = formatBalanceAmount(9_996_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.deepStrictEqual(aliasResult, result);
      });

      it("should floor 9.999999 USDC to 9.99 instead of 10.00", () => {
        const result = formatTokenBalance(9_999_999, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "9.99");
        assert.strictEqual(result.formatted, "$9.99");
        assert.strictEqual(result.full, "9.999999");
        assert.strictEqual(result.fullWithSymbol, "9.999999 USDC");
      });

      it("should floor 0.999999 USDC to 0.99 instead of 1.00", () => {
        const result = formatTokenBalance(999_999, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "0.99");
        assert.strictEqual(result.formatted, "$0.99");
      });
    });

    describe("Sub-Threshold Dust & Boundary Handling", () => {
      it("should format zero base units as $0.00 without sub-threshold indicator", () => {
        const result = formatTokenBalance(0, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "0.00");
        assert.strictEqual(result.formatted, "$0.00");
        assert.strictEqual(result.isZero, true);
        assert.strictEqual(result.isBelowThreshold, false);
      });

      it("should format 1 base unit (0.000001 USDC) as < $0.01", () => {
        const result = formatTokenBalance(1, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "< 0.01");
        assert.strictEqual(result.formatted, "< $0.01");
        assert.strictEqual(result.isZero, false);
        assert.strictEqual(result.isBelowThreshold, true);
      });

      it("should format 4,000 base units (0.004 USDC) as < $0.01", () => {
        const result = formatTokenBalance(4_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "< 0.01");
        assert.strictEqual(result.formatted, "< $0.01");
        assert.strictEqual(result.isBelowThreshold, true);
      });

      it("should format 9,999 base units (0.009999 USDC) as < $0.01", () => {
        const result = formatTokenBalance(9_999, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "< 0.01");
        assert.strictEqual(result.formatted, "< $0.01");
        assert.strictEqual(result.isBelowThreshold, true);
      });

      it("should format 10,000 base units (0.010000 USDC) exactly as $0.01", () => {
        const result = formatTokenBalance(10_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "0.01");
        assert.strictEqual(result.formatted, "$0.01");
        assert.strictEqual(result.isBelowThreshold, false);
      });

      it("should format sub-cent dust with prefix ordering (+< $0.01, ~< $0.01)", () => {
        assert.strictEqual(formatCurrency(1n, { prefix: "+" }), "+< $0.01");
        assert.strictEqual(formatCurrency(1n, { prefix: "~" }), "~< $0.01");
      });

      it("should clamp negative sub-cent values to -$0.00 or ~-$0.00", () => {
        assert.strictEqual(formatCurrency(-1n), "-$0.00");
        assert.strictEqual(formatCurrency(-1n, { prefix: "~" }), "~-$0.00");
      });
    });

    describe("Full Precision Strings (Pure BigInt, Zero Precision Loss)", () => {
      it("should format full precision string without scientific notation", () => {
        const result = formatTokenBalance(9_996_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.full, "9.996000");
        assert.strictEqual(result.fullWithSymbol, "9.996000 USDC");
      });

      it("should format full precision for large numbers with commas", () => {
        const result = formatTokenBalance(1_250_450_500_000n, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.full, "1,250,450.500000");
        assert.strictEqual(result.numeric, "1,250,450.50");
        assert.strictEqual(result.formatted, "$1,250,450.50");
      });
    });

    describe("Extreme Numbers & BigInt Safety (> 2^53 - 1)", () => {
      it("should safely format u64::MAX without overflow or NaN", () => {
        const u64Max = 18_446_744_073_709_551_615n;
        const result = formatTokenBalance(u64Max, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.isZero, false);
        assert.strictEqual(result.numeric.length > 0, true);
        assert.strictEqual(result.full.length > 0, true);
      });
    });

    describe("Non-USDC Tokens (SOL & WBTC)", () => {
      it("should format SOL balances with 4 display decimals and SOL threshold", () => {
        // 50_000_000 lamports = 0.05 SOL
        const solResult = formatTokenBalance(50_000_000n, {
          decimals: 9,
          tokenSymbol: "SOL",
        });
        assert.strictEqual(solResult.numeric, "0.0500");
        assert.strictEqual(solResult.formatted, "0.0500 SOL");

        // 99_999 lamports = 0.000099999 SOL (< 0.0001 SOL)
        const dustResult = formatTokenBalance(99_999n, {
          decimals: 9,
          tokenSymbol: "SOL",
        });
        assert.strictEqual(dustResult.numeric, "< 0.0001");
        assert.strictEqual(dustResult.formatted, "< 0.0001 SOL");
        assert.strictEqual(dustResult.isBelowThreshold, true);

        // 100_000 lamports = 0.000100000 SOL (>= threshold)
        const exactResult = formatTokenBalance(100_000n, {
          decimals: 9,
          tokenSymbol: "SOL",
        });
        assert.strictEqual(exactResult.numeric, "0.0001");
        assert.strictEqual(exactResult.formatted, "0.0001 SOL");
        assert.strictEqual(exactResult.isBelowThreshold, false);
      });

      it("should format WBTC balances with 6 display decimals", () => {
        const wbtcResult = formatTokenBalance(123_456_789n, {
          decimals: 8,
          tokenSymbol: "WBTC",
        });
        assert.strictEqual(wbtcResult.numeric, "1.234567");
        assert.strictEqual(wbtcResult.formatted, "1.234567 WBTC");
      });
    });

    describe("Tokens with Low Decimals (decimals < displayDecimals)", () => {
      it("should handle 0-decimal token with displayDecimals: 2 without error", () => {
        const result = formatTokenBalance(5n, {
          decimals: 0,
          minFractionDigits: 2,
          maxFractionDigits: 2,
          tokenSymbol: "POINTS",
        });
        assert.strictEqual(result.numeric, "5.00");
      });
    });

    describe("Negative Balance Formatting", () => {
      it("should format negative balances cleanly with sign", () => {
        const result = formatTokenBalance(-50_000_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.numeric, "50.00");
        assert.strictEqual(result.formatted, "-$50.00");
        assert.strictEqual(result.isZero, false);
      });
    });

    describe("Sanitized String & Value Parsing (toSafeBigInt)", () => {
      it("should parse commas in numeric strings", () => {
        assert.strictEqual(toSafeBigInt("1,000,000"), 1000000n);
      });

      it("should parse integer part of decimal string", () => {
        assert.strictEqual(toSafeBigInt("123.45"), 123n);
      });

      it("should safely return 0n for invalid inputs", () => {
        assert.strictEqual(toSafeBigInt("invalid"), 0n);
        assert.strictEqual(toSafeBigInt(""), 0n);
        assert.strictEqual(toSafeBigInt(NaN), 0n);
        assert.strictEqual(toSafeBigInt(Infinity), 0n);
        assert.strictEqual(toSafeBigInt(-Infinity), 0n);
      });

      it("should parse number correctly", () => {
        assert.strictEqual(toSafeBigInt(5000), 5000n);
        assert.strictEqual(toSafeBigInt(-500), -500n);
      });
    });

    describe("Centralized Token Configuration (getTokenFormattingConfig)", () => {
      it("should return config for known tokens", () => {
        const usdc = getTokenFormattingConfig("USDC");
        assert.strictEqual(usdc.symbol, "USDC");
        assert.strictEqual(usdc.isFiatPrefix, true);
        assert.strictEqual(usdc.displayDecimals, 2);

        const sol = getTokenFormattingConfig("SOL");
        assert.strictEqual(sol.symbol, "SOL");
        assert.strictEqual(sol.isFiatPrefix, false);
        assert.strictEqual(sol.displayDecimals, 4);
      });

      it("should fallback gracefully for unknown tokens", () => {
        const unknown = getTokenFormattingConfig("BONK");
        assert.strictEqual(unknown.symbol, "BONK");
        assert.strictEqual(unknown.isFiatPrefix, false);
        assert.strictEqual(unknown.displayDecimals, 2);
      });
    });
    describe("BigInt-First Aggregation Superadditive Invariant (INV-FORMAT-003)", () => {
      it("should demonstrate superadditivity when summing on-chain base units before formatting", () => {
        // Individual dust amounts: 4,000 base units (0.004 USDC) each
        const prize1 = 4_000n;
        const prize2 = 4_000n;
        const prize3 = 4_000n;

        // Formatted individually, each displays as sub-threshold dust
        assert.strictEqual(formatCurrency(prize1), "< $0.01");
        assert.strictEqual(formatCurrency(prize2), "< $0.01");
        assert.strictEqual(formatCurrency(prize3), "< $0.01");

        // When aggregated as BigInt base units on-chain before display formatting:
        // Sum = 12,000 base units = 0.012 USDC -> strictly formats as $0.01
        const aggregateBase = prize1 + prize2 + prize3;
        assert.strictEqual(aggregateBase, 12_000n);
        assert.strictEqual(formatCurrency(aggregateBase), "$0.01");
      });

      it("should preserve micro-unit precision in multi-entry portfolio aggregation", () => {
        const balances = [
          9_996_000n, // $9.996 (displays $9.99)
          5_005_000n, // $5.005 (displays $5.00)
          2_002_000n, // $2.002 (displays $2.00)
        ];

        // Sum of formatted parts would truncate: $9.99 + $5.00 + $2.00 = $16.99
        // True on-chain aggregate: 9_996_000 + 5_005_000 + 2_002_000 = 17_003_000 ($17.003) -> displays $17.00
        const totalBase = balances.reduce((acc, b) => acc + b, 0n);
        assert.strictEqual(totalBase, 17_003_000n);
        assert.strictEqual(formatCurrency(totalBase), "$17.00");
      });
    });
  });

  describe("String Truncation Utilities (truncateMiddle, truncateAddress, truncateSignature, truncateHash)", () => {
    describe("truncateMiddle", () => {
      it("should return empty string for null, undefined, and empty string", () => {
        assert.strictEqual(truncateMiddle(null), "");
        assert.strictEqual(truncateMiddle(undefined), "");
        assert.strictEqual(truncateMiddle(""), "");
      });

      it("should return original string if length is less than or equal to startChars + endChars", () => {
        assert.strictEqual(
          truncateMiddle("12345678", { startChars: 4, endChars: 4 }),
          "12345678"
        );
        assert.strictEqual(
          truncateMiddle("short", { startChars: 3, endChars: 3 }),
          "short"
        );
      });

      it("should truncate string with default options (4 start, 4 end, Unicode ellipsis)", () => {
        assert.strictEqual(
          truncateMiddle("abcdefghijklmnopqrstuvwxyz"),
          "abcd…wxyz"
        );
      });

      it("should support custom startChars, endChars, and custom ellipsis", () => {
        assert.strictEqual(
          truncateMiddle("abcdefghijklmnopqrstuvwxyz", {
            startChars: 2,
            endChars: 3,
            ellipsis: "...",
          }),
          "ab...xyz"
        );
      });
    });

    describe("truncateAddress", () => {
      it("should format Solana base58 addresses with 4 prefix, ellipsis, 4 suffix", () => {
        const address = "DyXsdqK5pvyG2mQnN3Q8gYv9v2x4kL7dYtYHd";
        assert.strictEqual(truncateAddress(address), "DyXs…tYHd");
      });

      it("should handle null and undefined safely", () => {
        assert.strictEqual(truncateAddress(null), "");
        assert.strictEqual(truncateAddress(undefined), "");
      });
    });

    describe("truncateSignature", () => {
      it("should format Solana 88-char transaction signatures with 4 prefix, ellipsis, 4 suffix", () => {
        const sig =
          "4Ux42E2h3R7x5Y8k9L2m1n0pQ7v9w8x6y5z4a3b2c1d0e9f8g7h6i5j4k3l2m1n0o9p8q7r6s5t4u3v2w1x0B4Ugf";
        assert.strictEqual(truncateSignature(sig), "4Ux4…4Ugf");
      });

      it("should handle null, undefined, and short signatures safely", () => {
        assert.strictEqual(truncateSignature(null), "");
        assert.strictEqual(truncateSignature(undefined), "");
        assert.strictEqual(truncateSignature("short"), "short");
      });
    });

    describe("truncateHash", () => {
      it("should format 64-char VRF hash with 8 prefix, ellipsis, 6 suffix", () => {
        const hash =
          "97e82d0d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5aca0fcb5";
        assert.strictEqual(truncateHash(hash), "97e82d0d…a0fcb5");
      });

      it("should handle null, undefined, and short hashes safely", () => {
        assert.strictEqual(truncateHash(null), "");
        assert.strictEqual(truncateHash(undefined), "");
        assert.strictEqual(truncateHash("12345678901234"), "12345678901234");
      });
    });
  });
});
