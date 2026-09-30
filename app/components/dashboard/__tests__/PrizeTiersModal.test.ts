import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { PrizeTiersModal } from "../PrizeTiersModal";
import type { PoolInfo } from "@/app/types";
import enMessages from "../../../../messages/en.json";
import esMessages from "../../../../messages/es.json";

function renderWithIntl(
  ui: React.ReactNode,
  locale: "en" | "es" = "en",
  messages = locale === "es" ? esMessages : enMessages
) {
  return renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement<any>(
      NextIntlClientProvider,
      { locale, messages, timeZone: "UTC" },
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

  it("should render 5 dedicated desktop columns without artificial min-width or overflow-x-auto", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
      })
    );

    // 5 column headers in English
    assert.ok(html.includes("Tier"), "Should include Tier column header");
    assert.ok(html.includes("Share %"), "Should include Share % column header");
    assert.ok(html.includes("Winners"), "Should include Winners column header");
    assert.ok(
      html.includes("Est. per Winner"),
      "Should include Est. per Winner column header"
    );
    assert.ok(
      html.includes("Total Share"),
      "Should include Total Share column header"
    );

    // Verify removal of horizontal scroll and artificial min-w constraints
    assert.ok(
      !html.includes("min-w-[640px]"),
      "min-w-[640px] must be removed to prevent desktop horizontal overflow"
    );
    assert.ok(
      !html.includes("overflow-x-auto"),
      "overflow-x-auto must be removed"
    );

    // Verify table structure with border-separate and table-fixed
    assert.ok(
      html.includes("table-fixed"),
      "table must use table-fixed for strict column budgeting"
    );
    assert.ok(
      html.includes("border-separate"),
      "table must use border-separate for sticky header rendering"
    );

    // Verify container query switch breakpoints
    assert.ok(
      html.includes("@[590px]:block"),
      "Desktop view container query breakpoint must be @[590px]:block"
    );
    assert.ok(
      html.includes("@[590px]:hidden"),
      "Mobile view container query breakpoint must be @[590px]:hidden"
    );
  });

  it("should render localized strings cleanly in Spanish locale", () => {
    const html = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        pool: mockUsdcPool,
      }),
      "es"
    );

    // Spanish column headers
    assert.ok(html.includes("Nivel"), "Should include Nivel column in Spanish");
    assert.ok(
      html.includes("% Asignado"),
      "Should include % Asignado column in Spanish"
    );
    assert.ok(
      html.includes("Ganadores"),
      "Should include Ganadores column in Spanish"
    );
    assert.ok(
      html.includes("Est. por Ganador"),
      "Should include Est. por Ganador column in Spanish"
    );
    assert.ok(
      html.includes("Total del Nivel"),
      "Should include Total del Nivel column in Spanish"
    );

    // Spanish summary footer
    assert.ok(
      html.includes("Total del Sorteo"),
      "Should include Total del Sorteo summary label in Spanish"
    );
    assert.ok(
      html.includes("En todos los niveles"),
      "Should include En todos los niveles in Spanish"
    );
    assert.ok(
      html.includes("ganadores"),
      "Should include ganadores in Spanish"
    );
  });

  it("should handle all pool CTA button states correctly", () => {
    // 1. Active pool -> Enabled Deposit button
    const activeHtml = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        onDeposit: () => {},
        pool: { ...mockUsdcPool, status: "Active", isFrozenForDraw: false },
      })
    );
    assert.ok(
      activeHtml.includes("Deposit"),
      "Active pool should render Deposit button"
    );
    assert.ok(
      !activeHtml.includes("disabled="),
      "Active pool deposit button should be enabled"
    );

    // 2. Frozen for draw pool -> Disabled with Draw in progress
    const frozenHtml = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        onDeposit: () => {},
        pool: { ...mockUsdcPool, isFrozenForDraw: true },
      })
    );
    assert.ok(
      frozenHtml.includes("Draw in progress"),
      "Frozen pool should show Draw in progress label"
    );
    assert.ok(
      frozenHtml.includes("disabled="),
      "Frozen pool deposit button must be disabled"
    );

    // 3. Paused pool -> Disabled with Paused label
    const pausedHtml = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        onDeposit: () => {},
        pool: { ...mockUsdcPool, status: "Paused", isFrozenForDraw: false },
      })
    );
    assert.ok(
      pausedHtml.includes("Paused"),
      "Paused pool should show Paused label"
    );
    assert.ok(
      pausedHtml.includes("disabled="),
      "Paused pool deposit button must be disabled"
    );

    // 4. Closed pool -> Disabled with Closed label
    const closedHtml = renderWithIntl(
      React.createElement(PrizeTiersModal, {
        isOpen: true,
        onClose: () => {},
        onDeposit: () => {},
        pool: { ...mockUsdcPool, status: "Closed", isFrozenForDraw: false },
      })
    );
    assert.ok(
      closedHtml.includes("Closed"),
      "Closed pool should show Closed label"
    );
    assert.ok(
      closedHtml.includes("disabled="),
      "Closed pool deposit button must be disabled"
    );
  });
});
