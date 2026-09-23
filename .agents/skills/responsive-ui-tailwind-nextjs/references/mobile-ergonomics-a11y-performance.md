# Mobile Ergonomics, Accessibility & Responsive Performance

## 1. Mobile Ergonomics & The "Thumb Zone"

On mobile devices, more than 75% of one-handed interactions are driven by the user's thumb. Ergonomic responsive UI design maps user controls directly to natural physical reach zones.

```
┌──────────────────────────────────────────────┐
│  HARD TO REACH ZONE                          │ Top 20%
│  - Secondary actions, breadcrumbs, logos     │ Hard stretch for thumb
├──────────────────────────────────────────────┤
│  NATURAL VIEWING ZONE                        │ Center 40%
│  - Primary content, charts, cards            │ Ideal for reading
├──────────────────────────────────────────────┤
│  NATURAL THUMB SWEEP (EASY REACH ZONE)       │ Bottom 40%
│  - Primary CTAs, sticky action bars,         │ Minimum thumb strain
│    bottom sheets, navigation tabs            │
└──────────────────────────────────────────────┘
```

### 1.1 Bottom-Sheet vs Centered Dialog

- **Desktop (>= 768px)**: Centered modal dialog with backdrop (`fixed inset-0 flex items-center justify-center`).
- **Mobile (< 768px)**: Anchored bottom sheet drawer (`fixed inset-x-0 bottom-0 max-h-[90dvh] rounded-t-3xl`).
- **Rationale**: Mobile users holding phones with one hand cannot easily reach the top "X" close button or confirm actions in centered modals.

### 1.2 Fixed Bottom Action Bar with Safe-Area Insets

Primary transaction actions (e.g. "Buy Bond", "Stake", "Deposit") should stick to the bottom on mobile devices, respecting the home bar:

```html
<div
  class="fixed bottom-0 inset-x-0 z-30 border-t border-outline-variant bg-surface-container/95 backdrop-blur-md px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:static md:border-0 md:bg-transparent md:p-0"
>
  <button
    class="btn-primary w-full md:w-auto min-h-[48px] text-base font-semibold shadow-lg"
  >
    Confirm Deposit
  </button>
</div>
```

---

## 2. Touch Target Density & Virtual Keyboards

### 2.1 Minimum Clickable Dimensions

- **Standard**: WCAG 2.5.5 (Enhanced) and Google Material Design mandate a minimum touch target size of **$48 \times 48\text{px}$** (WCAG 2.5.8 Minimum: $24 \times 24\text{px}$, but $48\text{px}$ is recommended for error prevention).
- In Tailwind v4: `min-h-12 min-w-12` (48px) or `min-h-[44px] min-w-[44px]`.
- For smaller visual icons (e.g. 20px icon), expand the touch target using pseudo-elements or padding:
  ```html
  <button class="relative p-3 text-on-surface-variant hover:text-on-surface">
    <!-- Visual icon is 20px, but button hit area is 44px -->
    <svg class="h-5 w-5" ... />
  </button>
  ```

### 2.2 Eliminating 300ms Tap Delay

Add `touch-action: manipulation` to interactive controls and scroll containers to inform mobile browsers that double-tap to zoom is disabled for that element, triggering instant click events:

```css
@layer base {
  button,
  a,
  input,
  select,
  textarea {
    touch-action: manipulation;
  }
}
```

### 2.3 Mobile Form Input Font Size Rule (Preventing iOS Auto-Zoom)

> [!CAUTION]
> On iOS Safari, focusing on an `<input>` or `<select>` with a `font-size` smaller than `16px` (`1rem`) triggers an **automatic viewport zoom**. This causes horizontal layout shifts and breaks the visual frame.
> **Rule**: Always set `text-base` (or `text-[1rem]`) on form inputs for mobile viewports, even if desktop uses `text-sm`:
>
> ```html
> <input
>   class="text-base md:text-sm rounded-xl border border-outline-variant px-3 py-2.5"
> />
> ```

---

## 3. Responsive Data Presentation (Table to Cards Transformation)

Complex multi-column tables are unusable when squished onto narrow screens. Transform tabular data into clean cards on mobile devices without duplicating data fetching:

```tsx
interface TransactionItem {
  id: string;
  txHash: string;
  type: string;
  amount: string;
  date: string;
  status: "confirmed" | "pending";
}

export function ResponsiveTransactionsTable({
  items,
}: {
  items: TransactionItem[];
}) {
  return (
    <div className="w-full">
      {/* Mobile Stacked Card List (< 768px) */}
      <div className="space-y-3 md:hidden">
        {items.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-outline-variant bg-surface-container p-4 shadow-sm"
          >
            <div className="flex items-center justify-between pb-2 border-b border-outline-variant/50">
              <span className="font-semibold text-on-surface">{item.type}</span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                  item.status === "confirmed"
                    ? "bg-primary/10 text-primary"
                    : "bg-secondary/10 text-secondary"
                }`}
              >
                {item.status}
              </span>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <span className="text-on-surface-variant">Amount</span>
              <span className="text-end font-mono font-medium text-on-surface">
                {item.amount}
              </span>
              <span className="text-on-surface-variant">Date</span>
              <span className="text-end text-on-surface-variant">
                {item.date}
              </span>
              <span className="text-on-surface-variant">Tx Hash</span>
              <span className="text-end font-mono text-xs text-primary truncate">
                {item.txHash}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Tabular Grid (>= 768px) */}
      <div className="hidden md:block overflow-x-auto rounded-2xl border border-outline-variant">
        <table className="w-full text-start text-sm">
          <thead className="bg-surface-container-high text-on-surface-variant font-medium">
            <tr>
              <th className="px-6 py-3.5 text-start">Type</th>
              <th className="px-6 py-3.5 text-start">Status</th>
              <th className="px-6 py-3.5 text-end">Amount</th>
              <th className="px-6 py-3.5 text-end">Date</th>
              <th className="px-6 py-3.5 text-end">Tx Hash</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-outline-variant/30 bg-surface">
            {items.map((item) => (
              <tr
                key={item.id}
                className="hover:bg-surface-container-low transition-colors"
              >
                <td className="px-6 py-4 font-medium text-on-surface">
                  {item.type}
                </td>
                <td className="px-6 py-4">
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-primary/10 text-primary">
                    {item.status}
                  </span>
                </td>
                <td className="px-6 py-4 text-end font-mono font-medium">
                  {item.amount}
                </td>
                <td className="px-6 py-4 text-end text-on-surface-variant">
                  {item.date}
                </td>
                <td className="px-6 py-4 text-end font-mono text-xs text-primary">
                  {item.txHash}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
```

---

## 4. Accessibility Across Form Factors

### 4.1 Reduced Motion (`prefers-reduced-motion`)

Users with vestibular disorders or motion sensitivities configure their operating systems to reduce motion. Ensure high-amplitude transitions and auto-playing animations respect this preference:

```html
<!-- Smooth transition on standard devices; instantaneous cut for reduced-motion users -->
<div
  class="transition-all duration-300 motion-reduce:transition-none motion-reduce:transform-none"
>
  <!-- Content -->
</div>
```

### 4.2 Windows High Contrast Mode (`forced-colors`)

In High Contrast mode, custom background colors and subtle border shades (`border-outline-variant/20`) can become invisible. Use `forced-colors` utilities to guarantee border outlines remain defined:

```html
<button
  class="rounded-xl border border-transparent forced-colors:border-[ButtonBorder] bg-primary text-on-primary"
>
  Action Button
</button>
```

### 4.3 Focus Rings Across Input Modalities

Never disable `:focus` rings globally with `outline-none` without providing `:focus-visible` replacements:

```html
<button
  class="focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
>
  Keyboard Accessible Target
</button>
```

---

## 5. Core Web Vitals (CWV) Responsive Audit Checklist

| Metric                              | Target             | Responsive Root Cause                                                              | Remediation                                                                                                                                                                 |
| :---------------------------------- | :----------------- | :--------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LCP** (Largest Contentful Paint)  | $\le 2.5\text{s}$  | Mobile downloads 4K desktop hero images; unoptimized fonts block render.           | - Add `priority` to hero image.<br>- Supply precise `sizes` attribute.<br>- Use `next/font` with `display: swap`.                                                           |
| **CLS** (Cumulative Layout Shift)   | $\le 0.1$          | Skeletons don't match grid dimensions; images lack aspect ratio; ads push content. | - Geometry-matched Suspense skeletons.<br>- Explicit `aspect-video` or `aspect-square`.<br>- `scrollbar-gutter: stable`.                                                    |
| **INP** (Interaction to Next Paint) | $\le 200\text{ms}$ | Complex layout recalculation or heavy state updates during mobile touch gestures.  | - React 19 `useTransition` for non-urgent re-renders.<br>- `touch-action: manipulation` on buttons.<br>- Use CSS transforms (`translate-y`) over layout properties (`top`). |
