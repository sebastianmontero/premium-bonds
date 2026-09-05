/**
 * DOM utilities for high-performance direct text updates compatible with React 19 Fiber reconciliation.
 */

/** Constant for DOM TEXT_NODE (NodeType 3) safe for universal/SSR execution environments */
const TEXT_NODE_TYPE = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;

/**
 * Safely updates the text content of a DOM element in-place without replacing or detaching
 * the underlying TextNode tracked by React's Fiber reconciler (`fiber.stateNode`).
 *
 * Setting `el.textContent = '...'` removes all existing child nodes (including the initial
 * TextNode created during React's render phase) and inserts a new unmanaged TextNode. When
 * React subsequently reconciles, replaces, or unmounts the tree (such as during localnet warp
 * or query invalidations), calling `parent.removeChild(trackedTextNode)` fails with:
 * `NotFoundError: Failed to execute 'removeChild' on 'Node': The node to be removed is not a child of this node.`
 *
 * By mutating `firstChild.nodeValue` directly, the exact TextNode instance tracked by Fiber is preserved.
 *
 * @param el Target DOM element or HTMLElement ref
 * @param text The new text string to display
 */
export function safeSetElementText(
  el: Element | HTMLElement | null | undefined,
  text: string
): void {
  if (!el) return;
  const firstChild = el.firstChild;
  if (firstChild && firstChild.nodeType === TEXT_NODE_TYPE) {
    if (firstChild.nodeValue !== text) {
      firstChild.nodeValue = text;
    }
    while (el.childNodes.length > 1) {
      el.removeChild(el.lastChild!);
    }
  } else {
    if (el.textContent !== text) {
      el.textContent = text;
    }
  }
}
