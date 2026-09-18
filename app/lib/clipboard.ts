/**
 * Copies text to the clipboard using the modern Async Clipboard API,
 * with a fallback to document.execCommand for restricted, non-HTTPS,
 * or legacy mobile WebView contexts.
 *
 * @param text - The string to copy to the clipboard.
 * @returns Promise<boolean> resolving to true if copied successfully.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined" || !text) return false;

  // 1. Modern Async Clipboard API
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to execCommand fallback
    }
  }

  // 2. Legacy execCommand Fallback (iOS WebView & non-secure contexts)
  try {
    const textArea = document.createElement("textarea");
    textArea.value = text;
    textArea.style.position = "fixed";
    textArea.style.left = "-9999px";
    textArea.style.top = "-9999px";
    textArea.style.opacity = "0";
    textArea.style.fontSize = "16px"; // Prevent iOS Safari auto-zoom
    textArea.setAttribute("readonly", "");
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    textArea.setSelectionRange(0, text.length);
    const successful = document.execCommand("copy");
    document.body.removeChild(textArea);
    return successful;
  } catch {
    return false;
  }
}
