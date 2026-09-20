import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrencyAmount,
  formatTokenAmount,
  formatBalanceAmount,
  toSafeBigInt,
  getTokenFormattingConfig,
  formatLiveYieldMetric,
  getLiveYieldFormatter,
  DEFAULT_LIVE_YIELD_PRECISION,
  USDC_DECIMALS,
  formatTicketNumber,
  sanitizeTicketNumber,
  getLocalizedTierLabel,
  getLocalizedTierParts,
  getTierTheme,
  DEFAULT_TIER_THEME,
  TIER_THEMES,
  type TierTranslationFn,
} from "../formatters";

describe("Currency & Token Formatters Unit Tests", () => {
  describe("Historical Prize Payouts (2-decimal precision)", () => {
    it("should format fractional prize amounts to exact cents with dollar prefix", () => {
      // 49.50 USDC = 49_500_000 base units (after 1% protocol fee on 50 USDC)
      const formatted = formatCurrencyAmount(
        49_500_000,
        "USDC",
        USDC_DECIMALS,
        2,
        2
      );
      assert.strictEqual(formatted, "$49.50");
    });

    it("should format whole dollar amounts with 2 decimal places when (2, 2) is requested", () => {
      const formatted = formatCurrencyAmount(
        50_000_000,
        "USDC",
        USDC_DECIMALS,
        2,
        2
      );
      assert.strictEqual(formatted, "$50.00");
    });

    it("should clamp division fractions in average prize pots to 2 decimals", () => {
      // 33.333333 USDC from recurring pot division (e.g. 100 / 3)
      const formatted = formatTokenAmount(33_333_333, USDC_DECIMALS, 2, 2);
      assert.strictEqual(formatted, "33.33");
    });

    it("should format zero base units cleanly with 2 decimals", () => {
      const formatted = formatCurrencyAmount(0, "USDC", USDC_DECIMALS, 2, 2);
      assert.strictEqual(formatted, "$0.00");
    });

    it("should insert comma thousands separators for large prize totals", () => {
      // 1,250,450.50 USDC
      const formatted = formatCurrencyAmount(
        1_250_450_500_000,
        "USDC",
        USDC_DECIMALS,
        2,
        2
      );
      assert.strictEqual(formatted, "$1,250,450.50");
    });
  });

  describe("TVL & Integer Formatting (0-decimal precision)", () => {
    it("should format TVL with 0 decimal places when min/max are 0", () => {
      // 100,000 USDC
      const formatted = formatCurrencyAmount(
        100_000_000_000,
        "USDC",
        USDC_DECIMALS,
        0,
        0
      );
      assert.strictEqual(formatted, "$100,000");
    });

    it("should format zero TVL as $0", () => {
      const formatted = formatCurrencyAmount(0, "USDC", USDC_DECIMALS, 0, 0);
      assert.strictEqual(formatted, "$0");
    });
  });

  describe("Non-USD Tokens", () => {
    it("should format non-USD token amounts with symbol suffix instead of dollar prefix", () => {
      // 0.05 SOL with 9 decimals = 50_000_000 base units
      const formatted = formatCurrencyAmount(50_000_000, "SOL", 9, 2, 2);
      assert.strictEqual(formatted, "0.05 SOL");
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
  });

  describe("Spendable Balance Non-Overstatement Invariant (INV-FORMAT-002)", () => {
    describe("Floor Truncation vs Over-reporting", () => {
      it("should floor 9.996 USDC to 9.99 instead of rounding up to 10.00", () => {
        const result = formatBalanceAmount(9_996_000, {
          decimals: 6,
          tokenSymbol: "USDC",
        });
        assert.strictEqual(result.display, "9.99");
        assert.strictEqual(result.displayWithCurrency, "$9.99 USDC");
        assert.strictEqual(result.isBelowThreshold, false);
      });

      it("should floor 9.999999 USDC to 9.99 instead of 10.00", () => {
        const result = formatBalanceAmount(9_999_999, 6, "USDC");
        assert.strictEqual(result.display, "9.99");
        assert.strictEqual(result.displayWithCurrency, "$9.99 USDC");
      });

      it("should floor 0.999999 USDC to 0.99 instead of 1.00", () => {
        const result = formatBalanceAmount(999_999, 6, "USDC");
        assert.strictEqual(result.display, "0.99");
        assert.strictEqual(result.displayWithCurrency, "$0.99 USDC");
      });
    });

    describe("Sub-Threshold Dust & Boundary Handling", () => {
      it("should format zero base units as 0.00 without sub-threshold indicator", () => {
        const result = formatBalanceAmount(0, 6, "USDC");
        assert.strictEqual(result.display, "0.00");
        assert.strictEqual(result.displayWithCurrency, "$0.00 USDC");
        assert.strictEqual(result.isZero, true);
        assert.strictEqual(result.isBelowThreshold, false);
      });

      it("should format 1 base unit (0.000001 USDC) as < 0.01", () => {
        const result = formatBalanceAmount(1, 6, "USDC");
        assert.strictEqual(result.display, "< 0.01");
        assert.strictEqual(result.displayWithCurrency, "< $0.01 USDC");
        assert.strictEqual(result.isZero, false);
        assert.strictEqual(result.isBelowThreshold, true);
        assert.strictEqual(result.isSubCent, true);
      });

      it("should format 4,000 base units (0.004 USDC) as < 0.01", () => {
        const result = formatBalanceAmount(4_000, 6, "USDC");
        assert.strictEqual(result.display, "< 0.01");
        assert.strictEqual(result.displayWithCurrency, "< $0.01 USDC");
        assert.strictEqual(result.isBelowThreshold, true);
      });

      it("should format 9,999 base units (0.009999 USDC) as < 0.01", () => {
        const result = formatBalanceAmount(9_999, 6, "USDC");
        assert.strictEqual(result.display, "< 0.01");
        assert.strictEqual(result.displayWithCurrency, "< $0.01 USDC");
        assert.strictEqual(result.isBelowThreshold, true);
      });

      it("should format 10,000 base units (0.010000 USDC) exactly as 0.01", () => {
        const result = formatBalanceAmount(10_000, 6, "USDC");
        assert.strictEqual(result.display, "0.01");
        assert.strictEqual(result.displayWithCurrency, "$0.01 USDC");
        assert.strictEqual(result.isBelowThreshold, false);
      });
    });

    describe("Full Precision Strings (Pure BigInt, Zero Precision Loss)", () => {
      it("should format full precision string without scientific notation", () => {
        const result = formatBalanceAmount(9_996_000, 6, "USDC");
        assert.strictEqual(result.full, "9.996000");
        assert.strictEqual(result.fullWithCurrency, "9.996000 USDC");
      });

      it("should format full precision for large numbers with commas", () => {
        const result = formatBalanceAmount(1_250_450_500_000n, 6, "USDC");
        assert.strictEqual(result.full, "1,250,450.500000");
        assert.strictEqual(result.display, "1,250,450.50");
        assert.strictEqual(result.displayWithCurrency, "$1,250,450.50 USDC");
      });
    });

    describe("Extreme Numbers & BigInt Safety (> 2^53 - 1)", () => {
      it("should safely format u64::MAX without overflow or NaN", () => {
        const u64Max = 18_446_744_073_709_551_615n;
        const result = formatBalanceAmount(u64Max, 6, "USDC");
        assert.strictEqual(result.isZero, false);
        assert.strictEqual(result.display.length > 0, true);
        assert.strictEqual(result.full.length > 0, true);
      });
    });

    describe("Non-USDC Tokens (SOL & WBTC)", () => {
      it("should format SOL balances with 4 display decimals and SOL threshold", () => {
        // 50_000_000 lamports = 0.05 SOL
        const solResult = formatBalanceAmount(50_000_000n, {
          decimals: 9,
          tokenSymbol: "SOL",
        });
        assert.strictEqual(solResult.display, "0.0500");
        assert.strictEqual(solResult.displayWithCurrency, "0.0500 SOL");

        // 99_999 lamports = 0.000099999 SOL (< 0.0001 SOL)
        const dustResult = formatBalanceAmount(99_999n, {
          decimals: 9,
          tokenSymbol: "SOL",
        });
        assert.strictEqual(dustResult.display, "< 0.0001");
        assert.strictEqual(dustResult.displayWithCurrency, "< 0.0001 SOL");
        assert.strictEqual(dustResult.isBelowThreshold, true);

        // 100_000 lamports = 0.000100000 SOL (>= threshold)
        const exactResult = formatBalanceAmount(100_000n, {
          decimals: 9,
          tokenSymbol: "SOL",
        });
        assert.strictEqual(exactResult.display, "0.0001");
        assert.strictEqual(exactResult.displayWithCurrency, "0.0001 SOL");
        assert.strictEqual(exactResult.isBelowThreshold, false);
      });

      it("should format WBTC balances with 6 display decimals", () => {
        const wbtcResult = formatBalanceAmount(123_456_789n, {
          decimals: 8,
          tokenSymbol: "WBTC",
        });
        assert.strictEqual(wbtcResult.display, "1.234567");
        assert.strictEqual(wbtcResult.displayWithCurrency, "1.234567 WBTC");
      });
    });

    describe("Tokens with Low Decimals (decimals < displayDecimals)", () => {
      it("should handle 0-decimal token with displayDecimals: 2 without error", () => {
        const result = formatBalanceAmount(5n, {
          decimals: 0,
          displayDecimals: 2,
          tokenSymbol: "POINTS",
        });
        assert.strictEqual(result.display, "5.00");
      });
    });

    describe("Negative Balance Clamping & Sign Formatting", () => {
      it("should clamp negative balance to zero in formatBalanceAmount", () => {
        const result = formatBalanceAmount(-50_000_000, 6, "USDC");
        assert.strictEqual(result.display, "0.00");
        assert.strictEqual(result.isZero, true);
      });

      it("should format negative amounts with leading minus before currency in formatCurrencyAmount", () => {
        assert.strictEqual(
          formatCurrencyAmount(-50_000_000, "USDC", USDC_DECIMALS, 2, 2),
          "-$50.00"
        );
        assert.strictEqual(
          formatCurrencyAmount(-50_000_000, "SOL", 9, 2, 2),
          "-0.05 SOL"
        );
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
  });
});
