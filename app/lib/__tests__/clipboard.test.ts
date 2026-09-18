import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { copyToClipboard } from "../clipboard";

describe("Clipboard Utility Suite (copyToClipboard)", () => {
  const origNavigatorDesc = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator"
  );
  const origWindowDesc = Object.getOwnPropertyDescriptor(globalThis, "window");
  const origDocumentDesc = Object.getOwnPropertyDescriptor(
    globalThis,
    "document"
  );

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

  function setMockDocument(doc: unknown) {
    Object.defineProperty(globalThis, "document", {
      value: doc,
      configurable: true,
      writable: true,
    });
  }

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

    if (origDocumentDesc) {
      Object.defineProperty(globalThis, "document", origDocumentDesc);
    } else {
      Reflect.deleteProperty(globalThis, "document");
    }
  });

  it("should return false when window is undefined (SSR environment)", async () => {
    setMockWindow(undefined);
    const result = await copyToClipboard("test-value");
    assert.strictEqual(result, false);
  });

  it("should return false when text is empty or falsy", async () => {
    setMockWindow({});
    const resultEmpty = await copyToClipboard("");
    assert.strictEqual(resultEmpty, false);
  });

  it("should copy via navigator.clipboard.writeText when available and resolve true", async () => {
    let writtenText = "";
    setMockWindow({});
    setMockNavigator({
      clipboard: {
        writeText: async (text: string) => {
          writtenText = text;
        },
      },
    });

    const success = await copyToClipboard("solana-pubkey-123");
    assert.strictEqual(success, true);
    assert.strictEqual(writtenText, "solana-pubkey-123");
  });

  it("should fall back to document.execCommand when navigator.clipboard.writeText throws", async () => {
    let execCommandCalledWith = "";
    let appendedChild: unknown = null;
    let removedChild: unknown = null;
    let selectionRange: [number, number] | null = null;
    let focused = false;
    let selected = false;

    setMockWindow({});
    setMockNavigator({
      clipboard: {
        writeText: async () => {
          throw new Error("Clipboard permission denied");
        },
      },
    });

    setMockDocument({
      createElement: (tag: string) => {
        return {
          tagName: tag.toUpperCase(),
          value: "",
          style: {},
          setAttribute: () => {},
          focus: () => {
            focused = true;
          },
          select: () => {
            selected = true;
          },
          setSelectionRange: (start: number, end: number) => {
            selectionRange = [start, end];
          },
        };
      },
      body: {
        appendChild: (child: unknown) => {
          appendedChild = child;
          return child;
        },
        removeChild: (child: unknown) => {
          removedChild = child;
          return child;
        },
      },
      execCommand: (command: string) => {
        execCommandCalledWith = command;
        return true;
      },
    });

    const success = await copyToClipboard("fallback-ticket-#42");
    assert.strictEqual(success, true);
    assert.strictEqual(execCommandCalledWith, "copy");
    assert.ok(appendedChild, "Expected textarea to be appended to body");
    const textArea = appendedChild as {
      value: string;
      style: { fontSize?: string };
    };
    assert.strictEqual(textArea.value, "fallback-ticket-#42");
    assert.strictEqual(textArea.style.fontSize, "16px"); // iOS Safari zoom prevention
    assert.strictEqual(focused, true);
    assert.strictEqual(selected, true);
    assert.deepStrictEqual(selectionRange, [0, "fallback-ticket-#42".length]);
    assert.strictEqual(removedChild, appendedChild);
  });

  it("should fall back to document.execCommand when navigator.clipboard is undefined", async () => {
    let execCommandCalledWith = "";

    setMockWindow({});
    setMockNavigator({});

    setMockDocument({
      createElement: () => ({
        style: {},
        setAttribute: () => {},
        focus: () => {},
        select: () => {},
        setSelectionRange: () => {},
      }),
      body: {
        appendChild: (child: unknown) => child,
        removeChild: (child: unknown) => child,
      },
      execCommand: (command: string) => {
        execCommandCalledWith = command;
        return true;
      },
    });

    const success = await copyToClipboard("legacy-webview-copy");
    assert.strictEqual(success, true);
    assert.strictEqual(execCommandCalledWith, "copy");
  });

  it("should return false when both clipboard API and execCommand fail/throw", async () => {
    setMockWindow({});
    setMockNavigator({});

    setMockDocument({
      createElement: () => {
        throw new Error("DOM access restricted");
      },
    });

    const success = await copyToClipboard("error-text");
    assert.strictEqual(success, false);
  });
});
