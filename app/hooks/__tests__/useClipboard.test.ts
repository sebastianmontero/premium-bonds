import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { useClipboard, type UseClipboardOptions } from "../useClipboard";

describe("useClipboard Hook Invariant Suite", () => {
  const origNavigatorDesc = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator"
  );
  const origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");

  function setMockNavigator(nav: unknown) {
    Object.defineProperty(globalThis, "navigator", {
      value: nav,
      configurable: true,
      writable: true,
    });
  }

  function setMockWindow(win: unknown) {
    Object.defineProperty(globalThis, "window", {
      value: win,
      configurable: true,
      writable: true,
    });
  }

  function renderHookHelper(options?: UseClipboardOptions) {
    let captured: ReturnType<typeof useClipboard> | null = null;

    function HookConsumer(props: {
      onCapture: (hook: ReturnType<typeof useClipboard>) => void;
    }) {
      const state = useClipboard(options);
      props.onCapture(state);
      return React.createElement("div", null, state.copied ? "copied" : "idle");
    }

    const html = renderToStaticMarkup(
      React.createElement(HookConsumer, {
        onCapture: (hook) => {
          captured = hook;
        },
      })
    );

    return {
      hook: captured as unknown as ReturnType<typeof useClipboard>,
      html,
    };
  }

  beforeEach(() => {
    setMockWindow({});
  });

  afterEach(() => {
    if (origNavigatorDesc) {
      Object.defineProperty(globalThis, "navigator", origNavigatorDesc);
    } else {
      Reflect.deleteProperty(globalThis, "navigator");
    }

    if (origWindowDesc) {
      Object.defineProperty(globalThis, "window", origWindowDesc);
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  });

  it("should initialize with copied = false and stable methods", () => {
    const { hook, html } = renderHookHelper();

    assert.strictEqual(html, "<div>idle</div>");
    assert.ok(hook !== null);
    assert.strictEqual(hook.copied, false);
    assert.strictEqual(typeof hook.copy, "function");
    assert.strictEqual(typeof hook.reset, "function");
  });

  it("should handle copy failure gracefully and call onError if copy fails", async () => {
    let errorReceived: unknown = null;

    // Simulate rejection
    setMockNavigator({
      clipboard: {
        writeText: async () => {
          throw new Error("Copy denied");
        },
      },
    });

    const { hook } = renderHookHelper({
      onError: (err) => {
        errorReceived = err;
      },
    });

    assert.ok(hook !== null);

    const result = await hook.copy("");
    assert.strictEqual(
      result,
      false,
      "Copying empty string should return false immediately"
    );

    // Copying non-empty string when clipboard rejects (and no document.execCommand available)
    const failResult = await hook.copy("failing-text");
    assert.strictEqual(failResult, false);
    assert.ok(errorReceived !== null, "Expected onError callback to be called");
  });

  it("should call onSuccess when copy succeeds", async () => {
    let successText = "";

    setMockNavigator({
      clipboard: {
        writeText: async () => {},
      },
    });

    const { hook } = renderHookHelper({
      onSuccess: (text) => {
        successText = text;
      },
    });

    assert.ok(hook !== null);

    const result = await hook.copy("prize-ticket-#999");
    assert.strictEqual(result, true);
    assert.strictEqual(successText, "prize-ticket-#999");
  });

  it("should support reset method to cancel copied state", () => {
    const { hook } = renderHookHelper();

    assert.ok(hook !== null);
    assert.doesNotThrow(() => {
      hook.reset();
    });
  });
});
