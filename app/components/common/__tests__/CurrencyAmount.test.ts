import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { CurrencyAmount } from "../CurrencyAmount";
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

describe("CurrencyAmount Component Suite", () => {
  it("should render plain span and suppress tooltips for exact whole amounts ($5.00)", () => {
    const html = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: 5_000_000n,
        options: { tokenSymbol: "USDC", decimals: 6 },
        showTooltip: true,
      })
    );

    assert.ok(html.includes("$5.00"), "Should render $5.00");
    assert.ok(
      html.includes("tabular-nums"),
      "Should have tabular-nums styling"
    );
    assert.ok(
      !html.includes("<button"),
      "Should NOT render interactive button trigger"
    );
    assert.ok(
      !html.includes("border-dotted"),
      "Should NOT render dotted underline"
    );
  });

  it("should render plain span and suppress tooltips for exact cent amounts ($5.25)", () => {
    const html = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: 5_250_000n,
        options: { tokenSymbol: "USDC", decimals: 6 },
        showTooltip: true,
      })
    );

    assert.ok(html.includes("$5.25"), "Should render $5.25");
    assert.ok(
      !html.includes("<button"),
      "Should NOT render interactive button trigger"
    );
    assert.ok(
      !html.includes("border-dotted"),
      "Should NOT render dotted underline"
    );
  });

  it("should render interactive tooltip trigger with dotted underline for amounts with fractional dust ($12.345678 -> $12.34)", () => {
    const html = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: 12_345_678n,
        options: { tokenSymbol: "USDC", decimals: 6 },
        showTooltip: true,
      })
    );

    assert.ok(
      html.includes("$12.34"),
      "Should render truncated display amount $12.34"
    );
    assert.ok(
      html.includes("<button"),
      "Should render interactive button trigger"
    );
    assert.ok(
      html.includes("border-dotted"),
      "Should render dotted underline for dust"
    );
    assert.ok(
      html.includes('aria-label="$12.34"'),
      "Should set clean aria-label on trigger"
    );
  });

  it("should render interactive tooltip with dotted underline for sub-cent dust (< $0.01)", () => {
    const html = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: 4_500n,
        options: { tokenSymbol: "USDC", decimals: 6 },
        showTooltip: true,
      })
    );

    assert.ok(
      html.includes("&lt; $0.01"),
      "Should render sub-cent indicator in static HTML"
    );
    assert.ok(
      html.includes("<button"),
      "Should render interactive button trigger"
    );
    assert.ok(
      html.includes("border-dotted"),
      "Should render dotted underline for dust"
    );
    assert.ok(
      html.includes('aria-label="&lt; $0.01"'),
      "Should set clean aria-label on trigger"
    );
  });

  it("should render plain non-interactive span when showTooltip is explicitly false (WCAG 4.1.2 table row compliance)", () => {
    const html = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: 12_345_678n,
        options: { tokenSymbol: "USDC", decimals: 6 },
        showTooltip: false,
      })
    );

    assert.ok(
      html.includes("$12.34"),
      "Should render truncated display amount $12.34"
    );
    assert.ok(
      !html.includes("<button"),
      "Should NOT render button when showTooltip is false"
    );
    assert.ok(
      !html.includes("border-dotted"),
      "Should NOT render dotted underline"
    );
    assert.ok(!html.includes("tabIndex"), "Should NOT have tabIndex");
    assert.ok(html.includes("tabular-nums"), "Should have tabular-nums font");
  });

  it("should render fallback cleanly without tooltip when amount is null, undefined, or 0", () => {
    const htmlNull = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: null,
        showTooltip: true,
      })
    );
    assert.ok(htmlNull.includes("—"), "Should render fallback dash");
    assert.ok(!htmlNull.includes("<button"), "Should NOT render button");

    const htmlZero = renderWithIntl(
      React.createElement(CurrencyAmount, {
        amount: 0n,
        showTooltip: true,
      })
    );
    assert.ok(htmlZero.includes("$0.00"), "Should render $0.00");
    assert.ok(!htmlZero.includes("<button"), "Should NOT render button for 0");
  });
});
