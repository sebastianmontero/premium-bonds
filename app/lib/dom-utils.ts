/**
 * DOM utilities for high-performance direct text updates compatible with React 19 Fiber reconciliation.
 */

/**
 * DOM Node.TEXT_NODE constant (3).
 * Falls back to numeric literal 3 in SSR / Node.js environments where DOM globals are absent.
 */
const DOM_TEXT_NODE = typeof Node !== "undefined" ? Node.TEXT_NODE : 3;

/**
 * Safely updates the text content of a DOM element in-place without replacing or detaching
 * the underlying TextNode tracked by React's Fiber reconciler (`fiber.stateNode`).
 *
 * Crucially, external code must NEVER call `el.removeChild()` on any child node created by React.
 * If an element has multiple sibling TextNodes (e.g. `{percent}%` in JSX), detaching extra
 * TextNodes causes React's `commitDeletionEffects` to throw `NotFoundError` when unmounting.
 * Instead, this helper sets `primaryTextNode.nodeValue = text` and blanks out any subsequent sibling
 * TextNodes (`nodeValue = ''`), keeping them attached to the DOM so React Fiber can safely
 * unmount them later without throwing.
 *
 * @param el Target DOM element ref
 * @param text The new text string to display
 */
export function safeSetElementText(
  el: Element | null | undefined,
  text: string
): void {
  if (!el) return;

  const childNodes = el.childNodes;
  const len = childNodes.length;
  let primaryTextNode: Node | null = null;

  for (let i = 0; i < len; i++) {
    const child = childNodes[i];
    if (child.nodeType === DOM_TEXT_NODE) {
      if (!primaryTextNode) {
        primaryTextNode = child;
        if (child.nodeValue !== text) {
          child.nodeValue = text;
        }
      } else if (child.nodeValue !== "") {
        // Blank residual sibling text nodes in-place (never remove — React tracks them)
        child.nodeValue = "";
      }
    }
  }

  if (primaryTextNode) return;

  // Cold-start fallback: ONLY append if element is completely empty
  if (len === 0) {
    const doc =
      el.ownerDocument || (typeof document !== "undefined" ? document : null);
    if (doc) {
      el.appendChild(doc.createTextNode(text));
    }
  }
}
