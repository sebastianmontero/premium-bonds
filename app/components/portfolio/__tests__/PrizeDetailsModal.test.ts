import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { SolanaProvider } from "@solana/react-hooks";
import { createClient } from "@solana/client";
import PrizeDetailsModal from "../PrizeDetailsModal";
import type { PrizeHistoryEntry } from "@/app/types";
import enMessages from "../../../../messages/en.json";

const mockClient = createClient({
  endpoint: "http://127.0.0.1:8899",
});

function renderWithIntl(ui: React.ReactNode) {
  return renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement<any>(
      SolanaProvider,
      { client: mockClient },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      React.createElement<any>(
        NextIntlClientProvider,
        { locale: "en", messages: enMessages, timeZone: "UTC" },
        ui
      )
    )
  );
}

const mockEntry: PrizeHistoryEntry = {
  drawCycleId: 12,
  date: "2026-09-29T12:00:00Z",
  tierIndex: 1,
  amount: 3_920_000,
  winningTicket: "4599",
  status: "reinvested",
  bondsBought: 4,
  usedPriorDust: 80_000,
  dustAccumulated: 0,
  vrfSeed: "97e82d0d1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5aca0fcb5",
  txSignature:
    "4Ux42E2h3R7x5Y8k9L2m1n0pQ7v9w8x6y5z4a3b2c1d0e9f8g7h6i5j4k3l2m1n0o9p8q7r6s5t4u3v2w1x0B4Ugf",
  winnerIndex: 0,
};

describe("PrizeDetailsModal Component Suite", () => {
  it("should render empty string when isOpen is false or entry is null", () => {
    const htmlClosed = renderWithIntl(
      React.createElement(PrizeDetailsModal, {
        isOpen: false,
        entry: mockEntry,
        onClose: () => {},
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        onSimulateCrank: () => {},
      })
    );
    assert.strictEqual(htmlClosed, "");

    const htmlNull = renderWithIntl(
      React.createElement(PrizeDetailsModal, {
        isOpen: true,
        entry: null,
        onClose: () => {},
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        onSimulateCrank: () => {},
      })
    );
    assert.strictEqual(htmlNull, "");
  });

  it("should render Hero Card, Breakdown, Proofs, and pinned footer actions for reinvested entry", () => {
    const html = renderWithIntl(
      React.createElement(PrizeDetailsModal, {
        isOpen: true,
        entry: mockEntry,
        onClose: () => {},
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        onSimulateCrank: () => {},
      })
    );

    // Dialog structure
    assert.ok(html.includes('role="dialog"'), "Should render dialog container");

    // Title & Winning Ticket Ribbon
    assert.ok(
      html.includes("Draw #12 Prize Details — Bond #4,599"),
      "Should render modal title"
    );
    assert.ok(html.includes("#4,599"), "Should render winning ticket ribbon");
    assert.ok(!html.includes("##4,599"), "No double hash bug");

    // Breakdown
    assert.ok(
      html.includes("Auto-Reinvestment Breakdown"),
      "Should render breakdown header"
    );
    assert.ok(
      html.includes("Bonus Bond Unlocked via Balance Aggregation"),
      "Should render bonus ticket banner"
    );

    // Cryptographic proofs
    assert.ok(
      html.includes("On-Chain Cryptographic Proofs"),
      "Should render proofs header"
    );
    assert.ok(
      html.includes("97e82d0d…a0fcb5"),
      "Should render truncated VRF seed"
    );
    assert.ok(
      html.includes("4Ux4…4Ugf"),
      "Should render truncated Tx signature"
    );

    // Footer actions
    assert.ok(html.includes("Share Win"), "Should render Share Win in footer");
    assert.ok(html.includes("Close"), "Should render Close button in footer");
  });

  it("should render crank action button when entry is processing and timelock is unlocked", () => {
    const processingEntry: PrizeHistoryEntry = {
      ...mockEntry,
      status: "processing",
      revealedAt: Math.floor(Date.now() / 1000) - 400, // Timelock passed
    };

    const html = renderWithIntl(
      React.createElement(PrizeDetailsModal, {
        isOpen: true,
        entry: processingEntry,
        onClose: () => {},
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        payoutTimelockSeconds: 300,
        onSimulateCrank: () => {},
      })
    );

    assert.ok(
      html.includes("Run Crank"),
      "Should render Run Crank button in footer"
    );
  });

  it("should suppress Share Win and Crank buttons when prize is voided", () => {
    const voidedEntry: PrizeHistoryEntry = {
      ...mockEntry,
      status: "voided" as unknown as "processing",
    };

    const html = renderWithIntl(
      React.createElement(PrizeDetailsModal, {
        isOpen: true,
        entry: voidedEntry,
        onClose: () => {},
        tokenDecimals: 6,
        tokenSymbol: "USDC",
        onSimulateCrank: () => {},
      })
    );

    assert.ok(
      !html.includes("Share Win"),
      "Should NOT render Share Win for voided prize"
    );
    assert.ok(
      !html.includes("Run Crank"),
      "Should NOT render Run Crank for voided prize"
    );
    assert.ok(
      html.includes("Prize Allocation Revoked"),
      "Should show revoked prize notice"
    );
    assert.ok(
      html.includes("Close"),
      "Should still render Close button in footer"
    );
  });
});
