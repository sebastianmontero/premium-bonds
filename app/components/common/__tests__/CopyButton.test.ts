import { describe, it } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { CopyButton } from "../CopyButton";
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

describe("CopyButton Component Invariant & A11y Suite", () => {
  it("should render button with default clipboard icon, data attribute, and type='button'", () => {
    const html = renderWithIntl(
      React.createElement(CopyButton, { text: "solana-address-456" })
    );

    assert.ok(html.includes('type="button"'), "Button must have type='button'");
    assert.ok(
      html.includes('data-prevent-row-click="true"'),
      "Button must include data-prevent-row-click attribute"
    );
    assert.ok(html.includes("<svg"), "Button must render SVG icon by default");
    assert.ok(
      html.includes('aria-label="Copy"'),
      "Button must have default aria-label"
    );
    assert.ok(html.includes('title="Copy"'), "Button must have default title");
  });

  it("should include a polite live region for WCAG 2.1 AA screen reader compliance", () => {
    const html = renderWithIntl(
      React.createElement(CopyButton, { text: "ticket-#123" })
    );

    assert.ok(
      html.includes('role="status"'),
      "Live region must have role='status'"
    );
    assert.ok(
      html.includes('aria-live="polite"'),
      "Live region must have aria-live='polite'"
    );
    assert.ok(
      html.includes('class="sr-only"'),
      "Live region must have sr-only class"
    );
  });

  it("should render explicit label when provided", () => {
    const html = renderWithIntl(
      React.createElement(CopyButton, {
        text: "0x12345678",
        label: "Copy VRF Seed",
      })
    );

    assert.ok(
      html.includes("Copy VRF Seed"),
      "Button must display explicit label text"
    );
  });

  it("should omit SVG icon when showIcon is false", () => {
    const html = renderWithIntl(
      React.createElement(CopyButton, {
        text: "derivation-formula",
        showIcon: false,
        label: "Copy Formula",
      })
    );

    assert.ok(
      !html.includes("<svg"),
      "Button must not render SVG when showIcon=false"
    );
    assert.ok(html.includes("Copy Formula"), "Button must render label");
  });

  it("should support render prop children for custom content", () => {
    const html = renderWithIntl(
      React.createElement(
        CopyButton,
        {
          text: "custom-text",
          showIcon: false,
        },
        ({ copied }: { copied: boolean }) =>
          React.createElement(
            "span",
            { className: "custom-badge" },
            copied ? "Done" : "Click"
          )
      )
    );

    assert.ok(
      html.includes('<span class="custom-badge">Click</span>'),
      "Render prop children must be called and rendered"
    );
  });

  it("should disable button when disabled=true or text is empty", () => {
    const htmlDisabled = renderWithIntl(
      React.createElement(CopyButton, { text: "some-text", disabled: true })
    );
    assert.ok(
      htmlDisabled.includes("disabled"),
      "Button must have disabled attribute"
    );
    assert.ok(
      htmlDisabled.includes("opacity-50"),
      "Button must have opacity-50 class"
    );

    const htmlEmpty = renderWithIntl(
      React.createElement(CopyButton, { text: "" })
    );
    assert.ok(
      htmlEmpty.includes("disabled"),
      "Button must be disabled on empty text"
    );
  });

  it("should use custom aria-label and title when passed", () => {
    const html = renderWithIntl(
      React.createElement(CopyButton, {
        text: "custom-tx-sig",
        ariaLabel: "Copy transaction signature",
        title: "Copy signature to clipboard",
      })
    );

    assert.ok(html.includes('aria-label="Copy transaction signature"'));
    assert.ok(html.includes('title="Copy signature to clipboard"'));
  });
});
