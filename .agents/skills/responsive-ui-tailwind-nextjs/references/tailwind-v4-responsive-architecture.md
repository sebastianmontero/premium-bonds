# Tailwind CSS v4 Responsive Architecture & Modern Layouts

## 1. CSS-First Theme Configuration (`@theme`)

Tailwind CSS v4 deprecates `tailwind.config.js` in favor of native CSS declaration using `@theme` and `@theme inline`.

### 1.1 Defining Breakpoints in `rem` Units

Always define responsive breakpoints in `rem` units instead of physical pixels. When users adjust their browser font size (e.g., from 16px to 24px) for vision accessibility, `rem`-based breakpoints adjust proportionally, preserving visual hierarchy and preventing horizontal text overflow.

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  /* Breakpoint tokens (Viewport-based) */
  --breakpoint-xs: 30rem; /* 480px @ 16px root */
  --breakpoint-sm: 40rem; /* 640px */
  --breakpoint-md: 48rem; /* 768px */
  --breakpoint-lg: 64rem; /* 1024px */
  --breakpoint-xl: 80rem; /* 1280px */
  --breakpoint-2xl: 96rem; /* 1536px */
  --breakpoint-3xl: 120rem; /* 1920px */

  /* Container query breakpoints (Parent-container based) */
  --container-2xs: 16rem; /* 256px */
  --container-xs: 20rem; /* 320px */
  --container-sm: 26rem; /* 416px */
  --container-md: 36rem; /* 576px */
  --container-lg: 48rem; /* 768px */
  --container-xl: 64rem; /* 1024px */
  --container-2xl: 80rem; /* 1280px */
}
```

### 1.2 Using `@theme inline` with CSS Variables

If your application already manages design tokens in `:root` (for theming, dark mode, or dynamic branding), use `@theme inline` to map them directly without duplicate CSS property definitions:

```css
:root {
  --spacing-safe-mobile: 1rem;
  --spacing-safe-desktop: 2rem;
}

@theme inline {
  --spacing-safe-mobile: var(--spacing-safe-mobile);
  --spacing-safe-desktop: var(--spacing-safe-desktop);
}
```

---

## 2. First-Class Native Container Queries

In Tailwind CSS v4, container queries are a first-class citizen built directly into the Oxide core compiler. No external plugins (like `@tailwindcss/container-queries`) are needed.

### 2.1 Establishing Containment Context

Apply `@container` to any parent wrapper. By default, `@container` sets `container-type: inline-size`.

```html
<section class="@container">
  <div class="flex flex-col @md:flex-row @xl:grid @xl:grid-cols-3 gap-4">
    <!-- Adapts automatically whether placed in a 300px sidebar or full-width main view -->
  </div>
</section>
```

### 2.2 Named Containers

When nesting multiple containers, target specific parent ancestors using named containers:

```html
<aside class="@container/sidebar w-full md:w-80">
  <div class="@container/card rounded-xl bg-surface-container p-4">
    <!-- Triggers when the sidebar itself is wide, even if the card is narrow -->
    <h3 class="@lg/sidebar:text-xl text-base font-bold">Sidebar Widget</h3>
    <!-- Triggers when the specific card container crosses 36rem -->
    <div class="@md/card:flex-row flex flex-col gap-2">...</div>
  </div>
</aside>
```

### 2.3 Container Query Units (`cqi`, `cqw`, `cqb`)

Use container query units directly for proportional, fluid component styling:

- `cqi`: 1% of the container's inline size (width in horizontal writing modes).
- `cqb`: 1% of the container's block size (height in horizontal writing modes).
- `cqmin` / `cqmax`: Smallest / largest of `cqi` or `cqb`.

```html
<!-- Scales card padding smoothly between 4% and 8% of container width -->
<div class="@container p-[clamp(1rem,5cqi,2.5rem)]">
  <!-- Dynamic avatar size relative to container -->
  <div
    class="w-[clamp(3rem,12cqi,6rem)] h-[clamp(3rem,12cqi,6rem)] rounded-full"
  ></div>
</div>
```

---

## 3. Intrinsic Layouts (Zero-Breakpoint Responsiveness)

Before writing media queries, use CSS layout algorithms that naturally wrap and fit content to available space.

### 3.1 Fluid Grid without Media Queries

The `auto-fit` with `minmax(min(100%, X), 1fr)` pattern generates from 1 to N columns automatically without breakpoints:

```html
<div
  class="grid grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))] gap-6"
>
  <div class="rounded-xl p-6 bg-surface-container">Item 1</div>
  <div class="rounded-xl p-6 bg-surface-container">Item 2</div>
  <div class="rounded-xl p-6 bg-surface-container">Item 3</div>
</div>
```

> [!IMPORTANT]
> The `min(100%, 20rem)` guard is critical. On small mobile screens (such as 320px wide devices), a pure `minmax(20rem, 1fr)` would cause horizontal overflow because 20rem (320px + margins) exceeds the viewport. `min(100%, ...)` ensures the minimum width collapses down safely to 100% on narrow screens.

### 3.2 Harmonized Card Sections with CSS Subgrid

In traditional responsive grids, variable card titles or body descriptions make buttons and badges unaligned across columns. Subgrid solves this natively:

```html
<div class="grid grid-cols-1 md:grid-cols-3 gap-6">
  <!-- Card spans 3 rows in the parent column -->
  <article
    class="grid grid-rows-subgrid row-span-3 rounded-2xl bg-surface-container p-6 shadow-sm"
  >
    <h3 class="font-display text-lg font-bold text-on-surface">
      Title of variable length
    </h3>
    <p class="text-sm text-on-surface-variant">
      Description that may wrap across 2 or 5 lines depending on content.
    </p>
    <div
      class="pt-4 border-t border-outline-variant flex justify-between items-center"
    >
      <span class="font-mono text-primary">$100.00</span>
      <button class="btn-primary">Buy</button>
    </div>
  </article>
</div>
```

---

## 4. Fluid Typography & Spacing Formula

### 4.1 Accessibility Rule for `clamp()`

When using `clamp(MIN, PREFERRED, MAX)` for typography, **WCAG 1.4.4 (Resize Text)** requires that users must be able to zoom text up to 200% without loss of content.
To guarantee this:

- **Maximum clamp value must NOT exceed $2.5\times$ the minimum clamp value.**
- The preferred value should combine a relative unit (`vw` or `cqi`) with a `rem` baseline so browser font scaling is respected.

```css
/* Accessible Fluid Clamp Formula */
/* Min: 1.25rem (20px), Preferred: 1rem + 2cqi, Max: 2.25rem (36px) -> Ratio = 1.8x (< 2.5x) */
.fluid-heading {
  font-size: clamp(1.25rem, 1rem + 2cqi, 2.25rem);
  line-height: 1.2;
}
```

In Tailwind utility syntax:

```html
<h1 class="text-[clamp(1.5rem,1.2rem+2vw,3rem)] leading-tight font-extrabold">
  Responsive Headline
</h1>
```

---

## 5. Modern Viewport Units & Insets

### 5.1 Dynamic Viewport Units vs `100vh` Bug

Mobile browsers have dynamic toolbars (URL bar and bottom navigation bar) that expand and contract as the user scrolls.

| Unit      | Tailwind v4 Class | Meaning                                                   | Best Use Case                                              |
| :-------- | :---------------- | :-------------------------------------------------------- | :--------------------------------------------------------- |
| **`dvh`** | `h-dvh`           | Dynamic viewport height (updates as toolbars move)        | Interactive full-screen drawers, mobile slide-overs        |
| **`svh`** | `h-svh`           | Smallest viewport height (assuming toolbars are expanded) | Hero sections to eliminate layout shifts on initial scroll |
| **`lvh`** | `h-lvh`           | Largest viewport height (assuming toolbars are collapsed) | Background canvas or full-bleed decorative elements        |
| **`dvw`** | `w-dvw`           | Dynamic viewport width                                    | Full bleed layouts accounting for mobile side toolbars     |

> [!WARNING]
> **Prohibition of `100vw` / `w-screen`**:
> Never use `w-screen` or `100vw` for main layout wrappers. `100vw` measures the window width _including_ vertical scrollbars on Windows, Linux, and non-overlay macOS scrollbars. This causes an immediate 15–17px horizontal overflow and an unsightly horizontal scrollbar. Always use `w-full` or `max-w-full`.

### 5.2 Device Safe-Area Insets

Modern smartphones have display cutouts (notches, dynamic islands) and bottom home indicator bars. Ensure fixed and sticky elements respect safe areas:

```html
<!-- Fixed bottom navigation bar with safe-area padding -->
<div
  class="fixed bottom-0 inset-x-0 bg-surface-container border-t border-outline-variant pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 px-4 z-40"
>
  <nav class="flex justify-around items-center">...</nav>
</div>
```

---

## 6. Flow-Relative Logical Properties for RTL Support

Never hardcode physical left/right rules. Tailwind CSS v4 provides first-class logical utility mappings:

| Physical (Avoid) | Logical (Preferred) | CSS Output                                                             |
| :--------------- | :------------------ | :--------------------------------------------------------------------- |
| `left-0`         | `start-0`           | `inset-inline-start: 0`                                                |
| `right-0`        | `end-0`             | `inset-inline-end: 0`                                                  |
| `ml-4`           | `ms-4`              | `margin-inline-start: 1rem`                                            |
| `mr-4`           | `me-4`              | `margin-inline-end: 1rem`                                              |
| `pl-6`           | `ps-6`              | `padding-inline-start: 1.5rem`                                         |
| `pr-6`           | `pe-6`              | `padding-inline-end: 1.5rem`                                           |
| `border-l`       | `border-s`          | `border-inline-start-width: 1px`                                       |
| `rounded-l-xl`   | `rounded-s-xl`      | `border-start-start-radius: 0.75rem; border-end-start-radius: 0.75rem` |
| `text-left`      | `text-start`        | `text-align: start`                                                    |
| `text-right`     | `text-end`          | `text-align: end`                                                      |
