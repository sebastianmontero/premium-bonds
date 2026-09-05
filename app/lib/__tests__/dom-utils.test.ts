import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { safeSetElementText } from "../dom-utils";

/**
 * Minimal mock DOM Element & TextNode classes to simulate browser DOM
 * in headless Node.js test environments.
 */
class MockTextNode {
  readonly nodeType = 3; // Node.TEXT_NODE
  nodeValue: string;
  parentNode: MockElement | null = null;

  constructor(text: string) {
    this.nodeValue = text;
  }
}

class MockElement {
  readonly nodeType = 1; // Node.ELEMENT_NODE
  childNodes: (MockTextNode | MockElement)[] = [];
  parentNode: MockElement | null = null;

  get firstChild(): MockTextNode | MockElement | null {
    return this.childNodes[0] ?? null;
  }

  get lastChild(): MockTextNode | MockElement | null {
    return this.childNodes[this.childNodes.length - 1] ?? null;
  }

  get textContent(): string {
    return this.childNodes.map((c) => ("nodeValue" in c ? c.nodeValue : c.textContent)).join("");
  }

  set textContent(text: string) {
    // Destructive DOM setter: clears all existing children and appends a single new text node
    for (const child of this.childNodes) {
      child.parentNode = null;
    }
    this.childNodes = [];
    if (text !== "") {
      const textNode = new MockTextNode(text);
      textNode.parentNode = this;
      this.childNodes.push(textNode);
    }
  }

  appendChild(child: MockTextNode | MockElement): void {
    child.parentNode = this;
    this.childNodes.push(child);
  }

  removeChild(child: MockTextNode | MockElement): MockTextNode | MockElement {
    const index = this.childNodes.indexOf(child);
    if (index === -1) {
      throw new Error(
        "NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node."
      );
    }
    child.parentNode = null;
    this.childNodes.splice(index, 1);
    return child;
  }
}

describe("DOM Utilities - safeSetElementText Suite", () => {
  it("should mutate existing TextNode in-place without replacing node reference", () => {
    const span = new MockElement();
    span.textContent = "$100.00";
    const initialTextNode = span.firstChild;

    assert.ok(initialTextNode, "Expected initial TextNode to exist");

    // Perform live ticker text update
    safeSetElementText(span as unknown as HTMLElement, "$105.50");

    assert.strictEqual(span.textContent, "$105.50");
    // CRITICAL: Fiber reference check
    assert.strictEqual(
      span.firstChild,
      initialTextNode,
      "Expected firstChild object identity to be preserved across live text updates"
    );
    assert.strictEqual(span.childNodes.length, 1);
  });

  it("should prevent React removeChild NotFoundError on parent unmount after multiple live updates", () => {
    const parent = new MockElement();
    const span = new MockElement();
    span.textContent = "$0.00";
    parent.appendChild(span);

    // Track initial child for React Fiber
    const trackedChild = span.firstChild!;
    assert.ok(trackedChild);

    // Simulate 60 FPS animation ticker loop updates
    safeSetElementText(span as unknown as HTMLElement, "$1.23");
    safeSetElementText(span as unknown as HTMLElement, "$2.45");
    safeSetElementText(span as unknown as HTMLElement, "$3.67");

    // React reconciling / unmounting the span's child
    assert.doesNotThrow(() => {
      span.removeChild(trackedChild);
    }, "React reconciler must successfully remove the tracked TextNode without throwing NotFoundError");

    assert.strictEqual(span.childNodes.length, 0);

    // React unmounting the span from parent container
    assert.doesNotThrow(() => {
      parent.removeChild(span);
    }, "Parent container must successfully remove the span element");

    assert.strictEqual(parent.childNodes.length, 0);
  });

  it("should demonstrate why standard textContent = '...' causes NotFoundError and safeSetElementText avoids it", () => {
    // 1. Failure demonstration with destructive textContent:
    const badSpan = new MockElement();
    badSpan.textContent = "$0.00";
    const reactTrackedNode = badSpan.firstChild!;

    // Destructive textContent replaces the child
    badSpan.textContent = "$100.00";

    // React attempts to unmount the node it tracked
    assert.throws(
      () => {
        badSpan.removeChild(reactTrackedNode);
      },
      /NotFoundError/,
      "Destructive textContent should detach the node and cause NotFoundError"
    );

    // 2. Success demonstration with safeSetElementText:
    const goodSpan = new MockElement();
    goodSpan.textContent = "$0.00";
    const goodTrackedNode = goodSpan.firstChild!;

    // Safe in-place update
    safeSetElementText(goodSpan as unknown as HTMLElement, "$100.00");

    // React attempts to unmount the node it tracked
    assert.doesNotThrow(() => {
      goodSpan.removeChild(goodTrackedNode);
    }, "safeSetElementText must keep the tracked node attached so unmounting succeeds");
  });

  it("should cleanly prune extra child nodes when multiple sibling text nodes exist", () => {
    const span = new MockElement();
    const t1 = new MockTextNode("Prefix: ");
    const t2 = new MockTextNode("$10.00");
    span.appendChild(t1);
    span.appendChild(t2);

    assert.strictEqual(span.childNodes.length, 2);

    safeSetElementText(span as unknown as HTMLElement, "$50.00");

    assert.strictEqual(span.textContent, "$50.00");
    assert.strictEqual(span.childNodes.length, 1);
    assert.strictEqual(span.firstChild, t1);
  });

  it("should handle empty elements by falling back to initial textContent", () => {
    const span = new MockElement();
    assert.strictEqual(span.childNodes.length, 0);

    safeSetElementText(span as unknown as HTMLElement, "Initialized Text");

    assert.strictEqual(span.textContent, "Initialized Text");
    assert.strictEqual(span.childNodes.length, 1);
    const first = span.firstChild;
    assert.strictEqual(first?.nodeType, 3);
  });

  it("should safely no-op on null or undefined elements without throwing", () => {
    assert.doesNotThrow(() => safeSetElementText(null, "No-op text"));
    assert.doesNotThrow(() => safeSetElementText(undefined, "No-op text"));
  });
});
