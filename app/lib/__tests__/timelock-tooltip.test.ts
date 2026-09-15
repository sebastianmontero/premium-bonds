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

    assert.strictEqual(
      state.isTimelocked,
      true,
      "Timelock must be active when now < revealedAt + timelockDuration"
    );
    assert.strictEqual(
      state.remainingSeconds,
      180,
      "Remaining seconds must equal timelock duration minus elapsed time"
    );
    assert.strictEqual(
      state.formattedRemaining,
      "03:00",
      "Formatted remaining time should be MM:SS"
    );
    assert.strictEqual(
      state.progressPercent,
      40,
      "Progress percent should represent elapsed fraction (120/300 = 40%)"
    );
    assert.ok(
      state.formattedUnlockTime.length > 0,
      "Formatted unlock time must be non-empty"
    );
  });

  it("should mark timelock as inactive once window has elapsed", () => {
    const revealedAt = 1700000000;
    const timelockDuration = 300;
    const now = revealedAt + 350; // past 300s

    const state = getPayoutTimelockState(revealedAt, timelockDuration, now);

    assert.strictEqual(
      state.isTimelocked,
      false,
      "Timelock must be inactive when elapsed time exceeds duration"
    );
    assert.strictEqual(
      state.remainingSeconds,
      0,
      "Remaining seconds must clamp to 0"
    );
    assert.strictEqual(
      state.formattedRemaining,
      "00:00",
      "Formatted remaining time must clamp to 00:00"
    );
    assert.strictEqual(
      state.progressPercent,
      100,
      "Progress percent must reach 100% when elapsed"
    );
  });

  it("should verify en and es localization files contain timelock keys", () => {
    assert.ok(
      enMessages.Ledger?.timelockTooltip,
      "en.json Ledger must contain timelockTooltip key"
    );
    assert.ok(
      enMessages.Ledger?.timelockUnlocksAt,
      "en.json Ledger must contain timelockUnlocksAt key"
    );
    assert.ok(
      esMessages.Ledger?.timelockTooltip,
      "es.json Ledger must contain timelockTooltip key"
    );
    assert.ok(
      esMessages.Ledger?.timelockUnlocksAt,
      "es.json Ledger must contain timelockUnlocksAt key"
    );

    assert.ok(
      enMessages.Ledger.timelockUnlocksAt.includes("{time}"),
      "en.json timelockUnlocksAt must contain {time} parameter placeholder"
    );
    assert.ok(
      esMessages.Ledger.timelockUnlocksAt.includes("{time}"),
      "es.json timelockUnlocksAt must contain {time} parameter placeholder"
    );
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
    assert.ok(
      html.includes("Timelocked"),
      "StatusBadge HTML must contain badge text 'Timelocked'"
    );
    // Verify it does NOT contain a title attribute that triggers browser flicker
    assert.ok(
      !html.includes("title="),
      "StatusBadge HTML must not contain browser native title attribute"
    );
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
    assert.ok(
      htmlEn.includes("2m 00s"),
      "EN tooltip HTML must contain formatted remaining time"
    );
    assert.ok(
      htmlEn.includes("Unlocks at 12:00:00 PM"),
      "EN tooltip HTML must contain formatted unlock message"
    );

    const htmlEs = renderToStaticMarkup(
      React.createElement(
        Provider,
        { locale: "es", messages: esMessages },
        React.createElement(TimelockTooltipContent, { timelock: mockTimelock })
      )
    );
    assert.ok(
      htmlEs.includes("2m 00s"),
      "ES tooltip HTML must contain formatted remaining time"
    );
    assert.ok(
      htmlEs.includes("Se desbloquea a las 12:00:00 PM"),
      "ES tooltip HTML must contain formatted unlock message"
    );
    assert.ok(
      htmlEs.includes("whitespace-normal"),
      "ES tooltip HTML must contain responsive text wrap classes"
    );
    assert.ok(
      htmlEs.includes("break-words"),
      "ES tooltip HTML must contain word break classes"
    );
  });
});
