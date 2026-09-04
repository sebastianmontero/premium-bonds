import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { getPayoutTimelockState } from "../draw-helpers";
import { StatusBadge } from "@/app/components/common/StatusBadge";
import { TimelockTooltipContent } from "@/app/components/draws/TimelockTooltipContent";

const enMessages = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "messages/en.json"), "utf8")
);
const esMessages = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "messages/es.json"), "utf8")
);

describe("Settlement Timelock & Tooltip Verification Suite", () => {
  it("should calculate timelock state accurately during active window", () => {
    const revealedAt = 1700000000;
    const timelockDuration = 300;
    const now = revealedAt + 120; // 180s remaining

    const state = getPayoutTimelockState(revealedAt, timelockDuration, now);

    assert.strictEqual(state.isTimelocked, true);
    assert.strictEqual(state.remainingSeconds, 180);
    assert.strictEqual(state.formattedRemaining, "03:00");
    assert.strictEqual(state.progressPercent, 40);
    assert.ok(state.formattedUnlockTime.length > 0);
  });

  it("should mark timelock as inactive once window has elapsed", () => {
    const revealedAt = 1700000000;
    const timelockDuration = 300;
    const now = revealedAt + 350; // past 300s

    const state = getPayoutTimelockState(revealedAt, timelockDuration, now);

    assert.strictEqual(state.isTimelocked, false);
    assert.strictEqual(state.remainingSeconds, 0);
    assert.strictEqual(state.formattedRemaining, "00:00");
    assert.strictEqual(state.progressPercent, 100);
  });

  it("should verify en and es localization files contain timelock keys", () => {
    assert.ok(enMessages.Ledger.timelockTooltip);
    assert.ok(enMessages.Ledger.timelockUnlocksAt);
    assert.ok(esMessages.Ledger.timelockTooltip);
    assert.ok(esMessages.Ledger.timelockUnlocksAt);

    assert.ok(enMessages.Ledger.timelockUnlocksAt.includes("{time}"));
    assert.ok(esMessages.Ledger.timelockUnlocksAt.includes("{time}"));
  });

  const Provider = NextIntlClientProvider as unknown as React.ComponentType<{
    locale: string;
    messages: unknown;
    children?: React.ReactNode;
  }>;

  it("should ensure StatusBadge timelocked state does not render native title attribute", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Provider,
        { locale: "en", messages: enMessages },
        React.createElement(StatusBadge, {
          status: "timelocked",
          size: "sm",
        })
      )
    );

    // Verify it renders the badge text
    assert.ok(html.includes("Timelocked"));
    // Verify it does NOT contain a title attribute that triggers browser flicker
    assert.ok(!html.includes("title="));
  });

  it("should render TimelockTooltipContent with localized unlock time in en and es", () => {
    const mockTimelock = {
      isTimelocked: true,
      remainingSeconds: 120,
      progressPercent: 60,
      formattedRemaining: "2m 00s",
      formattedUnlockTime: "12:00:00 PM",
      timelockExpiresAt: 1772500000,
    };

    const htmlEn = renderToStaticMarkup(
      React.createElement(
        Provider,
        { locale: "en", messages: enMessages },
        React.createElement(TimelockTooltipContent, { timelock: mockTimelock })
      )
    );
    assert.ok(htmlEn.includes("2m 00s"));
    assert.ok(htmlEn.includes("Unlocks at 12:00:00 PM"));

    const htmlEs = renderToStaticMarkup(
      React.createElement(
        Provider,
        { locale: "es", messages: esMessages },
        React.createElement(TimelockTooltipContent, { timelock: mockTimelock })
      )
    );
    assert.ok(htmlEs.includes("2m 00s"));
    assert.ok(htmlEs.includes("Se desbloquea a las 12:00:00 PM"));
    assert.ok(htmlEs.includes("whitespace-normal"));
    assert.ok(htmlEs.includes("break-words"));
  });
});
