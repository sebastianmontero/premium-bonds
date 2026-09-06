import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatCurrencyAmount,
  formatTokenAmount,
  formatLiveYieldMetric,
  getLiveYieldFormatter,
  DEFAULT_LIVE_YIELD_PRECISION,
  USDC_DECIMALS,
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
});
