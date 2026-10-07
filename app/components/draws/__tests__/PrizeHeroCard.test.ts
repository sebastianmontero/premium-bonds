import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PrizeHeroCard } from "../PrizeHeroCard";
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

describe("PrizeHeroCard Component Suite", () => {
  it("should render short ticket #677 and large ticket #1,234,567 properly formatted", () => {
    const htmlShort = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 2,
        amountWon: 260_000,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        winningTicket: 677,
        isProcessed: true,
      })
    );

    assert.ok(
      htmlShort.includes("$0.26"),
      "Should render formatted amount $0.26"
    );
    assert.ok(htmlShort.includes("#677"), "Should render #677");
    assert.ok(!htmlShort.includes("##677"), "Should NOT render ##677");

    const htmlLarge = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 10_000_000_000,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        winningTicket: 1234567,
        isProcessed: true,
      })
    );

    assert.ok(
      htmlLarge.includes("$10,000.00"),
      "Should render formatted amount $10,000.00"
    );
    assert.ok(
      htmlLarge.includes("#1,234,567"),
      "Should render formatted large ticket #1,234,567"
    );
  });

  it("should render ticket index 0 as #0 and not as fallback dash", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 1,
        amountWon: 1_000_000,
        winningTicket: 0,
        isProcessed: true,
      })
    );

    assert.ok(html.includes("#0"), "Ticket 0 must render as #0");
    assert.ok(!html.includes("##0"), "Must not have double hash");
  });

  it("should render dash '—' and omit copy button when winningTicket is null or undefined", () => {
    const htmlNull = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 5_000_000,
        winningTicket: null,
        isProcessed: true,
      })
    );

    assert.ok(
      htmlNull.includes("—"),
      "Should render dash fallback for null ticket"
    );
    assert.ok(
      !htmlNull.includes('aria-label="Copy Winning Bond'),
      "Should omit copy button for null ticket"
    );

    const htmlUndefined = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 5_000_000,
        winningTicket: undefined,
        isProcessed: true,
      })
    );

    assert.ok(
      htmlUndefined.includes("—"),
      "Should render dash fallback for undefined ticket"
    );
  });

  it("should render voided line-through styling and revocation label when isVoided is true", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 5_000_000,
        winningTicket: 4599,
        isProcessed: false,
        isVoided: true,
      })
    );

    assert.ok(
      html.includes("line-through"),
      "Should contain line-through class for voided prize"
    );
    assert.ok(
      html.includes("Prizes Revoked"),
      "Should show Prizes Revoked status badge label"
    );
  });

  it("should render timelocked status badge when actively timelocked", () => {
    const mockTimelockState = {
      isTimelocked: true,
      remainingSeconds: 150,
      unlockTimestamp: 1800000150,
      timelockExpiresAt: 1800000150,
      formattedRemaining: "2m 30s",
      formattedUnlockTime: "12:30 PM",
      progressPercent: 50,
      isExpired: false,
    };

    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 1,
        amountWon: 3_920_000,
        winningTicket: 4599,
        isProcessed: false,
        isVoided: false,
        timelockState: mockTimelockState,
      })
    );

    assert.ok(html.includes("Timelocked"), "Should render timelocked badge");
  });

  it("should render processing status badge when not processed and not timelocked", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 1,
        amountWon: 3_920_000,
        winningTicket: 4599,
        isProcessed: false,
        isVoided: false,
      })
    );

    assert.ok(
      html.includes("Processing"),
      "Should render Processing status badge"
    );
  });

  it("should render Reinvested status badge when isProcessed is true", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 1,
        amountWon: 3_920_000,
        winningTicket: 4599,
        isProcessed: true,
      })
    );

    assert.ok(
      html.includes("Reinvested"),
      "Should render Reinvested status badge"
    );
  });

  it("should render outer container query wrapper and responsive layout classes", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 3_920_000,
        winningTicket: 4599,
        isProcessed: true,
        className: "custom-prize-card-class",
      })
    );

    // Outer @container boundary wrapper
    assert.ok(
      html.includes("@container w-full shrink-0 custom-prize-card-class"),
      "Outer wrapper must declare @container w-full shrink-0 and pass className"
    );

    // Card body responsive classes
    assert.ok(
      html.includes(
        "@2xl:space-y-0 @2xl:flex @2xl:items-center @2xl:justify-between @2xl:gap-4"
      ),
      "Card body must include @2xl single-row flex transition classes"
    );

    // Left financial & status cluster
    assert.ok(
      html.includes("@2xl:justify-start @2xl:gap-3 @2xl:shrink-0"),
      "Left financial cluster must include @2xl alignment and gap classes"
    );

    // Right winning ticket cluster
    assert.ok(
      html.includes(
        "@2xl:justify-end @2xl:gap-3 @2xl:py-1.5 @2xl:px-3 @2xl:shrink-0"
      ),
      "Right winning ticket cluster must include @2xl pill styling classes"
    );
  });

  it("should apply visible focus styling on winning ticket copy button for keyboard navigation", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 3_920_000,
        winningTicket: 4599,
        isProcessed: true,
      })
    );

    assert.ok(
      html.includes("focus-visible:ring-2") &&
        html.includes("focus-visible:ring-primary"),
      "Copy button must have focus-visible ring classes for WCAG 2.4.7 focus indicator"
    );
  });

  it("should render interactive tooltip trigger button with dotted underline for amounts with fractional dust (BigInt)", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 1,
        amountWon: 12_345_678n,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        winningTicket: 4599,
        isProcessed: true,
      })
    );

    assert.ok(
      html.includes("$12.34"),
      "Should render truncated 2-decimal display amount $12.34"
    );
    assert.ok(
      html.includes("<button"),
      "Should render interactive button trigger for dust tooltip"
    );
    assert.ok(
      html.includes("border-dotted"),
      "Should render dotted underline visual indicator for progressive disclosure"
    );
    assert.ok(
      html.includes("cursor-help"),
      "Should have cursor-help on tooltip trigger"
    );
    assert.ok(
      html.includes('aria-label="$12.34"'),
      "Should provide clean aria-label on trigger"
    );
  });

  it("should suppress tooltip trigger and render plain span for exact whole bond amounts (BigInt)", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 0,
        amountWon: 5_000_000n,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        winningTicket: 100,
        isProcessed: true,
      })
    );

    assert.ok(html.includes("$5.00"), "Should render exact $5.00");
    assert.ok(
      !html.includes("border-dotted"),
      "Should NOT render dotted underline for exact whole amount"
    );
    assert.ok(
      !html.includes("cursor-help"),
      "Should NOT have cursor-help for exact whole amount"
    );
    assert.ok(
      !html.includes('aria-label="$5.00"'),
      "Should NOT render interactive amount button trigger"
    );
  });

  it("should suppress tooltip and render line-through plain text when isVoided is true even with dust", () => {
    const html = renderWithIntl(
      React.createElement(PrizeHeroCard, {
        tierIndex: 1,
        amountWon: 12_345_678n,
        tokenSymbol: "USDC",
        tokenDecimals: 6,
        winningTicket: 4599,
        isProcessed: false,
        isVoided: true,
      })
    );

    assert.ok(html.includes("$12.34"), "Should render display amount $12.34");
    assert.ok(
      html.includes("line-through"),
      "Should have line-through styling for voided prize"
    );
    assert.ok(
      !html.includes("border-dotted"),
      "Should NOT render dotted underline when isVoided is true"
    );
    assert.ok(
      !html.includes("cursor-help"),
      "Should NOT have cursor-help when isVoided is true"
    );
    assert.ok(
      !html.includes('aria-label="$12.34"'),
      "Should NOT render interactive amount button trigger when isVoided is true"
    );
  });
});
