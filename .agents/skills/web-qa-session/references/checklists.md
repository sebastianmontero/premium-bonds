# Web QA Session Checklists

This reference document contains the full technical checklists for executing web application QA checks across various categories.

---

## 1. Functional & Edge Case Checklist

Validate that the application logic handles normal user behaviors as well as unexpected system and user events.

- [ ] **Happy Path Verification:** Run through the primary customer journey (e.g., connect wallet, fund account, view bonds, buy ticket, claim reward).
- [ ] **Boundary Input Testing:**
  - Enter negative values, zero, and extremely large numbers in input fields.
  - Enter non-numeric inputs in numeric fields (e.g., letters, special characters, emoji).
  - Submit empty forms or skip optional fields.
- [ ] **State Interruption:**
  - Reload the page while a transaction is pending or processing.
  - Temporarily disable the internet connection (airplane mode / devtools offline) during a transaction.
  - Disconnect or lock the wallet extension mid-flow.
- [ ] **Session Sync & Multiple Tabs:**
  - Open the app in two tabs. Log out in Tab A, then try to perform an action in Tab B.
  - Perform a state-mutating transaction in Tab A and verify Tab B updates or prompts to sync.
- [ ] **Error Messaging:**
  - Ensure all error states display human-readable, context-aware error messages instead of raw stack traces or empty red boxes.

---

## 2. Visual & Responsive Design Checklist

Ensure the interface renders correctly, remains visually appealing, and has consistent styling across all form factors.

- [ ] **Breakpoint Layout Audit:**
  - View key screens at Mobile (375px), Tablet (768px), Laptop (1024px), and Desktop (1440px).
  - Ensure no text overflows, buttons remain clickable, and flex/grid columns wrap correctly.
- [ ] **Layout Shifts (CLS):**
  - Watch for layout jumps during loading. Verify that images, icons, and dynamic widgets have defined heights/widths or skeletons to prevent layout shift.
- [ ] **Interactive Elements Focus & Hover:**
  - Hover over all buttons and links. Verify they change state (background color, cursor style, or scale transition).
  - Check that disabled buttons look visibly disabled (lower opacity, grayed out) and do not trigger click actions or cursors.
- [ ] **Dark & Light Mode Integration:**
  - Toggle between dark and light themes (if supported).
  - Verify there is no low-contrast text (e.g., dark text on a dark background or light text on a light background).

---

## 3. Technical Accessibility (a11y) Checklist

Verify that the application meets WCAG 2.1 Level AA compliance guidelines using standard manual techniques.

- [ ] **Keyboard Only Navigation:**
  - Navigate the entire app using *only* the `Tab` and `Shift+Tab` keys.
  - Use `Enter` and `Spacebar` to interact with buttons, links, tabs, and custom inputs.
  - Verify that the cursor focus sequence is logical (usually top-to-bottom, left-to-right).
- [ ] **Visible Focus Indicators:**
  - Ensure every interactive element displays a clear, highly visible focus ring/outline when it has keyboard focus.
  - Ensure `outline: none` is never used without a custom visible replacement.
- [ ] **No Keyboard Traps:**
  - Ensure the keyboard focus is never trapped inside a widget (like a modal or a custom dropdown). The user must be able to escape the element (e.g., hitting `Esc` to close a modal and returning focus to the trigger button).
- [ ] **Color Contrast:**
  - Verify that the contrast ratio for all text is at least `4.5:1` (for standard body text) or `3:1` (for large text).
  - Ensure color is never the *only* visual indicator of status (e.g., use an warning icon alongside red text to indicate errors).
- [ ] **Zoom & Scaling (200%):**
  - Zoom the browser to 200% using `Ctrl +` or `Cmd +`.
  - Ensure all text scales correctly, elements do not overlap, and the page is fully functional without requiring horizontal scrolling.

---

## 4. Performance & Console Checklist

Verify runtime health, resource loading, and compliance with performance goals.

- [ ] **Lighthouse Performance Scan:**
  - Run a Lighthouse audit on the page.
  - Aim for scores: Performance > 80, Accessibility > 90, Best Practices > 90, SEO > 90.
- [ ] **Browser Console Audit:**
  - Open browser DevTools (`F12`) and view the **Console** tab.
  - Verify there are no red errors (`Uncaught TypeError`, failing network requests `404/500`, CORS warnings).
  - Ensure React keys warning errors are resolved (`Each child in a list should have a unique "key" prop`).
- [ ] **Network Throttling Performance:**
  - Open the **Network** tab in DevTools, set throttling to "Slow 3G".
  - Verify that loading states (skeleton screens, custom spinners) render immediately and remain active until the data is fully loaded.
