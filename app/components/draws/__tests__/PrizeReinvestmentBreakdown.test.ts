import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PrizeReinvestmentBreakdown } from "../PrizeReinvestmentBreakdown";
import enMessages from "../../../../messages/en.json";

function renderWithIntl(ui: React.ReactNode) {
  return renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement<any>(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages, timeZone: "UTC" },
      ui
    )
  );
}

describe("PrizeReinvestmentBreakdown Component Suite", () => {
  const mockBreakdown = {
    bondsBought: 3,
    usedPriorDust: 3_827_161,
    dustAccumulated: 0,
    totalAvailable: 16_172_839,
    remainingDust: 1_172_839,
  };

  it("should render all 5 line items including intermediate subtotal in standard 2-decimal format by default", () => {
    const html = renderWithIntl(
      React.createElement(PrizeReinvestmentBreakdown, {
        amountWon: 12_345_678,
        breakdown: mockBreakdown,
        config: {
          tokenDecimals: 6,
          tokenSymbol: "USDC",
          bondPrice: 5_000_000,
        },
        isProcessed: true,
      })
    );

    // 1. Gross Winnings: 12.345678 -> $12.34
    assert.ok(
      html.includes("Gross Prize Winnings"),
      "Should render Gross Prize Winnings label"
    );
    assert.ok(
      html.includes("$12.34"),
      "Should render gross winnings truncated to $12.34"
    );

    // 2. Prior Dust: 3.827161 -> +$3.82
    assert.ok(
      html.includes("Prior Balance Applied"),
      "Should render Prior Balance Applied label"
    );
    assert.ok(
      html.includes("+$3.82"),
      "Should render prior dust applied as +$3.82"
    );

    // 3. Total Available for Reinvestment (Intermediate Subtotal): 16.172839 -> $16.17
    assert.ok(
      html.includes("Total Available for Reinvestment"),
      "Should render intermediate subtotal label"
    );
    assert.ok(
      html.includes("$16.17"),
      "Should render total available as $16.17"
    );

    // 4. Reinvested in Bonds: 3 bonds * 5 USDC = -$15.00
    assert.ok(
      html.includes("Reinvested in Active Bonds"),
      "Should render Reinvested in Active Bonds"
    );
    assert.ok(
      html.includes("-$15.00"),
      "Should render reinvested bonds cost as -$15.00"
    );
    assert.ok(html.includes("+3 Bonds"), "Should render +3 Bonds badge");

    // 5. Net Dust Remainder: 1.172839 -> +$1.17
    assert.ok(
      html.includes("Net Dust Remainder"),
      "Should render Net Dust Remainder label"
    );
    assert.ok(
      html.includes("+$1.17"),
      "Should render net dust remainder as +$1.17"
    );

    // Footnote & Toggle
    assert.ok(
      html.includes("Amounts rounded to 2 decimals for readability"),
      "Should render accounting rounding note"
    );
    assert.ok(
      html.includes("Show exact on-chain units (6 decimals)"),
      "Should render toggle button with exact precision tooltip/label"
    );
    assert.ok(
      html.includes('aria-pressed="false"'),
      "Toggle button must declare aria-pressed='false' in standard mode"
    );

    // Suppressed tooltips on table rows
    assert.ok(
      !html.includes("cursor-help"),
      "Should NOT render individual whack-a-mole tooltips on line items"
    );
  });

  it("should render all 5 line items in exact on-chain precision when defaultShowExactPrecision is true", () => {
    const html = renderWithIntl(
      React.createElement(PrizeReinvestmentBreakdown, {
        amountWon: 12_345_678,
        breakdown: mockBreakdown,
        config: {
          tokenDecimals: 6,
          tokenSymbol: "USDC",
          bondPrice: 5_000_000,
        },
        isProcessed: true,
        defaultShowExactPrecision: true,
      })
    );

    // Toggle button aria-pressed state
    assert.ok(
      html.includes('aria-pressed="true"'),
      "Toggle button must declare aria-pressed='true' in exact precision mode"
    );
    assert.ok(
      html.includes("Show standard display"),
      "Should render toggle button label to revert to standard display"
    );

    // Screen reader live region
    assert.ok(
      html.includes("Displaying exact on-chain precision with 6 decimals"),
      "Screen reader live region must announce exact on-chain precision mode"
    );

    // 1. Gross Winnings: 12.345678 -> $12.345678
    assert.ok(
      html.includes("$12.345678"),
      "Should render gross winnings in exact 6 decimals $12.345678"
    );

    // 2. Prior Dust: 3.827161 -> +$3.827161
    assert.ok(
      html.includes("+$3.827161"),
      "Should render prior dust applied in exact 6 decimals +$3.827161"
    );

    // 3. Total Available for Reinvestment: 16.172839 -> $16.172839
    assert.ok(
      html.includes("$16.172839"),
      "Should render total available in exact 6 decimals $16.172839"
    );

    // 4. Reinvested in Bonds: 3 bonds * 5 USDC = -$15.000000
    assert.ok(
      html.includes("-$15.000000"),
      "Should render reinvested bond cost in exact 6 decimals -$15.000000"
    );

    // 5. Net Dust Remainder: 1.172839 -> +$1.172839
    assert.ok(
      html.includes("+$1.172839"),
      "Should render net dust remainder in exact 6 decimals +$1.172839"
    );

    // Suppressed tooltips on table rows in exact mode as well
    assert.ok(
      !html.includes("cursor-help"),
      "Should NOT render individual tooltips in exact precision mode"
    );

    // Bonus ticket description formatting with exact precision
    assert.ok(
      html.includes("$3.827161"),
      "Bonus ticket description must format prior dust with exact precision"
    );
    assert.ok(
      html.includes("$12.345678"),
      "Bonus ticket description must format winnings with exact precision"
    );
  });

  it("should render bonus ticket banner when usedPriorDust > 0", () => {
    const html = renderWithIntl(
      React.createElement(PrizeReinvestmentBreakdown, {
        amountWon: 12_345_678,
        breakdown: mockBreakdown,
        config: {
          tokenDecimals: 6,
          tokenSymbol: "USDC",
          bondPrice: 5_000_000,
        },
        isProcessed: true,
      })
    );

    assert.ok(
      html.includes("Bonus Bond Unlocked via Balance Aggregation"),
      "Should render bonus ticket banner title"
    );
  });

  it("should omit prior dust row when usedPriorDust is 0", () => {
    const zeroDustBreakdown = {
      bondsBought: 2,
      usedPriorDust: 0,
      dustAccumulated: 2_345_678,
      totalAvailable: 12_345_678,
      remainingDust: 2_345_678,
    };

    const html = renderWithIntl(
      React.createElement(PrizeReinvestmentBreakdown, {
        amountWon: 12_345_678,
        breakdown: zeroDustBreakdown,
        config: {
          tokenDecimals: 6,
          tokenSymbol: "USDC",
          bondPrice: 5_000_000,
        },
        isProcessed: true,
      })
    );

    assert.ok(
      !html.includes("Prior Balance Applied"),
      "Should omit Prior Balance Applied row when usedPriorDust is 0"
    );
    assert.ok(
      !html.includes("Bonus Bond Unlocked"),
      "Should omit bonus ticket banner when usedPriorDust is 0"
    );
  });

  it("should render voided state safely with principal intact notice", () => {
    const html = renderWithIntl(
      React.createElement(PrizeReinvestmentBreakdown, {
        amountWon: 10_000_000,
        breakdown: mockBreakdown,
        config: {
          tokenDecimals: 6,
          tokenSymbol: "USDC",
          bondPrice: 5_000_000,
        },
        isVoided: true,
      })
    );

    assert.ok(
      html.includes("Prize Allocation Revoked"),
      "Should show revoked title"
    );
    assert.ok(
      html.includes("Yield Returned to Reserves"),
      "Should show yield returned to reserves"
    );
    assert.ok(
      html.includes("100% Principal Intact"),
      "Should show principal intact notice"
    );
  });
});
