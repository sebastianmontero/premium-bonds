import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PrizeTiersModal } from "../PrizeTiersModal";
import type { PoolInfo } from "@/app/types";
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

const mockUsdcPool: PoolInfo = {
  poolId: 1,
  tokenMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  tokenSymbol: "USDC",
  tokenDecimals: 6,
  bondPrice: 10_000_000,
  stakeCycleDurationHrs: 168,
  feeBasisPoints: 100,
  status: "Active",
  totalDepositedPrincipal: 100_000_000_000,
  currentCycleEndAt: 1800000000,
  isFrozenForDraw: false,
  currentDrawCycleId: 5,
  estimatedPrizePot: 10_000_000_000, // 10,000 USDC
  prizeTiers: [
    { basisPoints: 5000, numWinners: 1 }, // Tier 1: 50% = 5,000 USDC
    { basisPoints: 2500, numWinners: 2 }, // Tier 2: 25% each = 2,500 USDC each, 5,000 USDC total
  ],
};

const mockSolPool: PoolInfo = {
  ...mockUsdcPool,
  tokenMint: "So11111111111111111111111111111111111111112",
  tokenSymbol: "SOL",
  tokenDecimals: 9,
  estimatedPrizePot: 10_000_000_000, // 10 SOL
  prizeTiers: [
    { basisPoints: 6000, numWinners: 1 }, // Tier 1: 60% = 6 SOL
    { basisPoints: 2000, numWinners: 2 }, // Tier 2: 20% each = 2 SOL each, 4 SOL total
  ],
};

describe("PrizeTiersModal Component Suite", () => {
  it("should render 6 decimal precision for USDC prize amounts by default", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
      })
    );

    // Tier 1: 50% of $10,000 = $5,000.000000
    assert.ok(
      html.includes("$5,000.000000"),
      "Tier 1 payout per winner must render with 6 decimal places ($5,000.000000)"
    );

    // Tier 2: 25% of $10,000 = $2,500.000000 per winner
    assert.ok(
      html.includes("$2,500.000000"),
      "Tier 2 payout per winner must render with 6 decimal places ($2,500.000000)"
    );

    // Total Pot summary = $10,000.000000
    assert.ok(
      html.includes("$10,000.000000"),
      "Summary pot total must render with 6 decimal places ($10,000.000000)"
    );
  });

  it("should render 6 decimal precision with token suffix for non-USDC tokens (SOL)", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockSolPool,
      })
    );

    // Tier 1: 60% of 10 SOL = 6.000000 SOL
    assert.ok(
      html.includes("6.000000 SOL"),
      "Tier 1 payout per winner must render with 6 decimal places and SOL suffix"
    );

    // Tier 2: 20% of 10 SOL = 2.000000 SOL
    assert.ok(
      html.includes("2.000000 SOL"),
      "Tier 2 payout per winner must render with 6 decimal places and SOL suffix"
    );

    // Total Pot summary = 10.000000 SOL
    assert.ok(
      html.includes("10.000000 SOL"),
      "Summary pot total must render with 6 decimal places and SOL suffix"
    );
  });

  it("should support custom precision prop override", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
        precision: 4,
      })
    );

    assert.ok(
      html.includes("$5,000.0000"),
      "Tier 1 payout must render with 4 decimal places when precision=4"
    );
    assert.ok(
      html.includes("$2,500.0000"),
      "Tier 2 payout must render with 4 decimal places when precision=4"
    );
    assert.ok(
      html.includes("$10,000.0000"),
      "Summary pot total must render with 4 decimal places when precision=4"
    );
  });

  it("should defensively clamp invalid precision props back to default 6 decimals", () => {
    // Test negative precision
    const htmlNegative = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
        precision: -5,
      })
    );
    assert.ok(
      htmlNegative.includes("$5,000.000000"),
      "Negative precision must clamp to default 6 decimals"
    );

    // Test precision > 20
    const htmlExcessive = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
        precision: 99,
      })
    );
    assert.ok(
      htmlExcessive.includes("$5,000.000000"),
      "Excessive precision must clamp to default 6 decimals"
    );
  });

  it("should render empty string when isOpen is false", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: false,
        onClose: () => {},
        pool: mockUsdcPool,
      })
    );
    assert.strictEqual(html, "");
  });

  it("should handle empty prize tiers without crashing", () => {
    const emptyPool: PoolInfo = {
      ...mockUsdcPool,
      prizeTiers: [],
    };
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: emptyPool,
      })
    );
    assert.ok(html.includes('role="dialog"'));
  });

  it("should include tabular-nums and whitespace-nowrap in mobile value containers", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
      })
    );

    assert.ok(
      html.includes("tabular-nums whitespace-nowrap"),
      "Rendered markup must include anti-jitter classes"
    );
  });
});
