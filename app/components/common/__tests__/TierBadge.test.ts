import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { TierBadge, TIER_BADGE_SIZE_CLASSES } from "../TierBadge";
import enMessages from "../../../../messages/en.json";

function renderWithIntl(ui: React.ReactNode) {
  return renderToStaticMarkup(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    React.createElement<any>(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      ui
    )
  );
}

describe("TierBadge Component Invariant & A11y Suite", () => {
  it("should verify TIER_BADGE_SIZE_CLASSES has mappings for xs, sm, and md", () => {
    assert.ok(TIER_BADGE_SIZE_CLASSES.xs.badge.includes("text-[10px]"));
    assert.ok(TIER_BADGE_SIZE_CLASSES.sm.badge.includes("text-xs"));
    assert.ok(TIER_BADGE_SIZE_CLASSES.md.badge.includes("text-sm"));
  });

  it("should render Tier 1 with 🏆 icon, amber styling, title tooltip, and sr-only Grand Prize annotation", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, { tierIndex: 0 })
    );

    assert.ok(html.includes("🏆"), "Tier 1 must render trophy icon");
    assert.ok(html.includes("Tier 1"), "Tier 1 must render 'Tier 1' label");
    assert.ok(
      html.includes('title="Grand Prize"'),
      "Tier 1 rank format must have title tooltip"
    );
    assert.ok(
      html.includes('class="sr-only"'),
      "Tier 1 must include screen reader only annotation"
    );
    assert.ok(
      html.includes("(Grand Prize)"),
      "Tier 1 screen reader text must state Grand Prize"
    );
    assert.ok(
      html.includes("border-amber-500/30"),
      "Tier 1 must have amber border"
    );
  });

  it("should render Tier 2 with 🥈 icon without title or sr-only suffix", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, { tierIndex: 1 })
    );

    assert.ok(html.includes("🥈"), "Tier 2 must render silver medal");
    assert.ok(html.includes("Tier 2"), "Tier 2 must render 'Tier 2' label");
    assert.ok(
      !html.includes("title="),
      "Tier 2 should not have title attribute"
    );
    assert.ok(
      !html.includes("sr-only"),
      "Tier 2 should not have sr-only suffix"
    );
  });

  it("should render Tier 3 with 🥉 icon", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, { tierIndex: 2 })
    );

    assert.ok(html.includes("🥉"), "Tier 3 must render bronze medal");
    assert.ok(html.includes("Tier 3"), "Tier 3 must render 'Tier 3' label");
  });

  it("should render Tier 4+ with 🏅 fallback icon and muted surface style", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, { tierIndex: 3 })
    );

    assert.ok(html.includes("🏅"), "Tier 4+ must render medal icon");
    assert.ok(html.includes("Tier 4"), "Tier 4+ must render 'Tier 4' label");
    assert.ok(
      html.includes("bg-surface-variant"),
      "Tier 4+ must use surface variant background"
    );
  });

  it("should support format='full' compound label for detail views", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, {
        tierIndex: 0,
        format: "full",
        size: "md",
      })
    );

    assert.ok(
      html.includes("Tier 1 · Grand Prize"),
      "Full format must render compound label"
    );
    assert.ok(
      !html.includes("title="),
      "Full format should not have title tooltip because it is already explicit"
    );
    assert.ok(
      !html.includes("sr-only"),
      "Full format should not duplicate sr-only title"
    );
  });

  it("should support format='short' / format='title'", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, {
        tierIndex: 0,
        format: "short",
      })
    );

    assert.ok(
      html.includes("Grand Prize"),
      "Short format must render honorary title for Tier 1"
    );
  });

  it("should hide icon when showIcon is false", () => {
    const html = renderWithIntl(
      React.createElement(TierBadge, {
        tierIndex: 0,
        showIcon: false,
      })
    );

    assert.ok(
      !html.includes("🏆"),
      "Should not render icon when showIcon is false"
    );
    assert.ok(html.includes("Tier 1"), "Should still render text label");
  });

  it("should support dependency-injected custom translation function", () => {
    const customT = (key: string, values?: Record<string, string | number>) => {
      if (key === "grand") return "Premio Mayor";
      if (key === "tierN") return `Nivel ${values?.tier}`;
      return key;
    };

    const html = renderWithIntl(
      React.createElement(TierBadge, {
        tierIndex: 0,
        t: customT,
      })
    );

    assert.ok(
      html.includes("Nivel 1"),
      "Must use injected translation function"
    );
    assert.ok(
      html.includes('title="Premio Mayor"'),
      "Must use injected translation function for title"
    );
  });
});
