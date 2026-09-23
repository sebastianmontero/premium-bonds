---
name: responsive-ui-tailwind-nextjs
description: Playbook, best practices, and expert runbook for designing and building responsive UI systems using Tailwind CSS v4, Next.js 16 App Router, and React 19. Use when designing mobile-first or container-responsive layouts, implementing fluid typography and spacing with clamp(), configuring Tailwind v4 @theme and native container queries (@container), building zero-hydration-mismatch components, creating geometry-matched Suspense skeletons (0 CLS), optimizing responsive images (next/image sizes), designing touch-ergonomic mobile bottom sheets and drawers, or auditing responsive performance (LCP/CLS/INP).
user-invocable: true
license: MIT
metadata:
  author: Community & Antigravity
  version: 1.0.0
---

# Responsive UI Engineering Playbook: Tailwind CSS v4, Next.js 16 & React 19

## What this Skill is for

Use this skill when:

- Designing or implementing responsive interfaces using **Tailwind CSS v4**, **Next.js 16 (App Router)**, and **React 19**.
- Migrating legacy viewport media queries (`sm:`, `md:`, `lg:`) to modern **container queries** (`@container`, `@sm:`, `@md:`).
- Eliminating **React 19 hydration mismatches** caused by client-side window dimension checks (`window.innerWidth`, `useMediaQuery`).
- Designing fluid typography, spacing scales, and zero-breakpoint layouts (`clamp()`, dynamic viewport units `dvh`/`svh`, CSS Subgrid, auto-fit grid).
- Implementing adaptive navigation patterns: mobile bottom-sheet drawers vs desktop header bars and parallel/intercepting routes (`@modal`).
- Optimizing **Next.js 16 Core Web Vitals**: fixing mobile LCP image loading via `next/image` `sizes` formulas and preventing CLS with geometry-matched Suspense skeletons.
- Enforcing mobile touch ergonomics: $48 \times 48\text{px}$ touch targets, safe-area insets (`env(safe-area-inset-bottom)`), and thumb-zone layouts.

---

## Core Architectural Principles

### 1. Container-First over Viewport-First

Components should be responsive to their parent container rather than the browser viewport. A card widget placed inside a 320px sidebar must render identically to the same card on a 320px mobile viewport, regardless of the user's desktop screen size.

### 2. Zero Hydration Mismatch Guarantee

The server has no viewport. Never branch JSX rendering on the server based on window dimensions (`isMobile ? <A/> : <B/>`). Use **CSS-driven dual DOMs** (`hidden md:flex`) or safe **deterministic SSR defaults** via `useSyncExternalStore`.

### 3. Intrinsic Fluidity over Discrete Breakpoint Jumps

Prefer layouts that naturally flow and wrap (`grid-cols-[repeat(auto-fit,minmax(min(100%,18rem),1fr))]`) and fluid typography (`clamp()`) over abrupt layout jumps at fixed pixel boundaries.

### 4. The Thumb-Zone Mobile Hierarchy

On mobile viewports, place primary actions, bottom sheets, and navigation tabs in the lower 40% of the screen ("easy thumb sweep"). Reserve top zones for status and secondary navigation.

### 5. Geometry-Matched Skeletons (0 CLS)

Streaming SSR Suspense fallbacks must mirror the exact responsive grid columns, flex gaps, and aspect ratios of the loaded component to achieve Cumulative Layout Shift (CLS) = 0.

---

## Technical Decision & Selection Matrix

### Layout Strategy Matrix

| Use Case                         | Recommended Technique                                              | Why It Wins                                                                                                                 |
| :------------------------------- | :----------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------- |
| **Reusable Widgets / Cards**     | Tailwind v4 Native Container Queries (`@container`, `@sm:`)        | Component adapts to any layout slot (main feed, sidebar, modal, drawer) with zero external layout context coupling.         |
| **Dynamic Item Grids**           | Intrinsic CSS Grid (`repeat(auto-fit, minmax(min(100%, X), 1fr))`) | Fluid 1-to-N column wrapping across any screen size without writing a single media query breakpoint.                        |
| **Grid Card Internal Alignment** | CSS Subgrid (`grid-rows-subgrid row-span-3`)                       | Harmonizes headers, body text, and bottom CTAs across cards with varying content lengths.                                   |
| **Overlays (Modals / Drawers)**  | Next.js 16 Parallel (`@modal`) + Intercepting (`(.)route`) Routes  | Desktop modal / mobile bottom sheet with deep linking, direct shareable URLs, and native browser history (`router.back()`). |
| **Adaptive Viewport Visibility** | CSS Display Toggling (`hidden md:flex`, `flex md:hidden`)          | Byte-identical SSR HTML. 0 ms layout shift, zero hydration warnings, works without JavaScript.                              |

---

## Quick-Start Workflows & Implementation Checklists

### 1. Tailwind CSS v4 Responsive Token Setup (`@theme`)

Declare responsive breakpoints in `rem` units (so user font scaling adapts proportionally) and register container query tokens directly in CSS:

```css
/* app/globals.css */
@import "tailwindcss";

@theme {
  /* Viewport Breakpoints (rem-based) */
  --breakpoint-xs: 30rem; /* 480px */
  --breakpoint-sm: 40rem; /* 640px */
  --breakpoint-md: 48rem; /* 768px */
  --breakpoint-lg: 64rem; /* 1024px */
  --breakpoint-xl: 80rem; /* 1280px */
  --breakpoint-2xl: 96rem; /* 1536px */

  /* Native Container Query Breakpoints */
  --container-xs: 20rem; /* 320px */
  --container-sm: 26rem; /* 416px */
  --container-md: 36rem; /* 576px */
  --container-lg: 48rem; /* 768px */
}
```

---

### 2. Building a Container-Responsive Component

Wrap the parent element with `@container` and apply `@` variants to children:

```tsx
export function MetricCard({ title, value, change }: MetricProps) {
  return (
    <article className="@container rounded-2xl bg-surface-container p-4 border border-outline-variant">
      {/* Stacks vertically when container < 26rem; side-by-side when container >= 26rem */}
      <div className="flex flex-col gap-2 @sm:flex-row @sm:items-center @sm:justify-between">
        <div>
          <span className="text-xs text-on-surface-variant uppercase">
            {title}
          </span>
          <p className="font-mono text-[clamp(1.25rem,4cqi,2rem)] font-bold text-on-surface">
            {value}
          </p>
        </div>
        <div className="inline-flex items-center rounded-lg bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {change}
        </div>
      </div>
    </article>
  );
}
```

---

### 3. Adaptive Overlay (Mobile Bottom Sheet / Desktop Modal)

Ensure overlays adapt to the thumb zone on mobile and center on desktop without hydration errors:

```tsx
export function AdaptiveModal({ isOpen, onClose, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 md:items-center md:p-4">
      {/* Backdrop */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm"
      />

      {/* 
        Responsive Shell:
        - Mobile: Bottom-anchored sheet, max-h-[88dvh], rounded-t-3xl, safe area bottom padding
        - Desktop: Centered dialog box, max-w-lg, rounded-3xl
      */}
      <div
        className="relative z-10 w-full max-h-[88dvh] overflow-y-auto rounded-t-3xl border-t border-outline-variant bg-surface-container p-6 md:max-h-[85vh] md:max-w-lg md:rounded-3xl md:border"
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))" }}
      >
        {/* Mobile Drag Indicator */}
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-outline-variant md:hidden" />
        {children}
      </div>
    </div>
  );
}
```

---

### 4. Next.js 16 `next/image` Responsive `sizes` Checklist

Never use `fill` without `sizes`. Apply the standard sizing formula:

```tsx
import Image from "next/image";

export function ResponsiveHero({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="relative aspect-4/3 w-full sm:aspect-16/9 lg:aspect-21/9 overflow-hidden rounded-3xl">
      <Image
        src={src}
        alt={alt}
        fill
        priority // Crucial for LCP candidate
        quality={80}
        // Formula: (max-width: mobile) 100vw, (max-width: tablet) 90vw, desktopMaxPx
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 90vw, 1200px"
        className="object-cover object-center"
      />
    </div>
  );
}
```

---

## Anti-Patterns & Refactoring Recipes

### Anti-Pattern 1: Viewport Sniffing Causing Hydration Mismatch

```tsx
// ❌ WRONG: window is undefined on server; causes hydration crash
const isMobile = window.innerWidth < 768;
return isMobile ? <MobileNav /> : <DesktopNav />;

// ✅ REFACTORED: CSS-driven dual DOM
return (
  <>
    <div className="flex md:hidden">
      <MobileNav />
    </div>
    <div className="hidden md:flex">
      <DesktopNav />
    </div>
  </>
);
```

### Anti-Pattern 2: The `100vw` / `w-screen` Horizontal Scrollbar Leak

```tsx
// ❌ WRONG: 100vw includes vertical scrollbars on Windows/Linux, triggering horizontal overflow
<div className="w-screen max-w-screen">...</div>

// ✅ REFACTORED: Use w-full or 100%
<div className="w-full max-w-full">...</div>
```

### Anti-Pattern 3: Skeletons that Mismatch Responsive Grid Columns (CLS)

```tsx
// ❌ WRONG: Skeleton is a single static column; real grid is 3 columns on desktop
// This causes a massive Cumulative Layout Shift (CLS) when loaded!
<Suspense fallback={<div className="h-96 w-full animate-pulse bg-surface-container" />}>
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">...</div>
</Suspense>

// ✅ REFACTORED: Skeleton mirrors the exact responsive grid classes
<Suspense fallback={
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {Array.from({ length: 6 }).map((_, i) => (
      <div key={i} className="h-64 animate-pulse rounded-2xl bg-surface-container" />
    ))}
  </div>
}>
  <CardsGrid />
</Suspense>
```

### Anti-Pattern 4: iOS Form Input Auto-Zoom

```tsx
// ❌ WRONG: Font size < 16px triggers automatic viewport zoom on iOS Safari focus
<input className="text-xs sm:text-sm px-3 py-2 rounded-lg" />

// ✅ REFACTORED: Ensure font size is at least text-base (16px) on mobile
<input className="text-base md:text-sm px-3 py-2 rounded-lg" />
```

---

## Testing & Responsive Verification Protocol

Before completing responsive UI tasks, execute the following audit steps:

1. **Viewport Presets Check**:
   - **Mobile Portrait**: 320px (iPhone SE minimum), 375px / 390px / 412px (standard smartphones).
   - **Mobile Landscape**: 667px / 844px.
   - **Tablet Portrait**: 768px (iPad Mini), 820px (iPad Air).
   - **Desktop / Laptop**: 1024px, 1280px, 1440px.
   - **Ultrawide**: 1920px+.

2. **Horizontal Overflow Audit**:
   Verify zero horizontal scrollbar leakage across all viewports in browser console:

   ```javascript
   document.documentElement.scrollWidth <= window.innerWidth;
   ```

3. **Touch Target Verification**:
   Ensure all primary buttons and links have `min-h-[44px]` (or `min-h-[48px]`).

4. **Safe-Area Insets Check**:
   Confirm bottom navigation bars and sheets include `pb-[max(1rem,env(safe-area-inset-bottom))]`.

5. **Core Web Vitals Thresholds**:
   - **LCP**: $\le 2.5\text{s}$ (Mobile 4G).
   - **CLS**: $\le 0.1$.
   - **INP**: $\le 200\text{ms}$.

---

## Detailed References & Reference Implementations

- [Tailwind CSS v4 Responsive Architecture](./references/tailwind-v4-responsive-architecture.md): In-depth guide to `@theme`, native container queries (`@container`), fluid typography (`clamp()`), intrinsic grid/subgrid layout, modern viewport units (`dvh`/`dvw`), and logical properties.
- [React 19 & Next.js 16 Responsive Patterns](./references/react19-nextjs16-responsive-patterns.md): In-depth guide to zero-hydration mismatch patterns, Server Components layout streaming, responsive skeletons (0 CLS), `next/image` responsive sizing rules, and parallel/intercepting routes (`@modal` + `(.)drawer`).
- [Mobile Ergonomics, Accessibility & Performance](./references/mobile-ergonomics-a11y-performance.md): In-depth guide to mobile ergonomics, thumb-zone, bottom sheets vs dialogs, safe-area insets, responsive data transformation (table $\rightarrow$ cards), touch targets ($\ge 44/48\text{px}$), WCAG 2.2 zoom compliance, and Core Web Vitals (LCP/CLS/INP) optimization.
- [Container-Responsive Card Example](./examples/ContainerResponsiveCard.tsx): Production-ready React 19 + Tailwind v4 component demonstrating container queries, fluid typography, and subgrid.
- [Responsive Dialog & Drawer Example](./examples/ResponsiveDialogDrawer.tsx): Adaptive overlay that renders as a bottom sheet drawer on mobile and a centered modal dialog on desktop with zero hydration mismatch and native touch dismiss.
- [Responsive Image Hero Example](./examples/ResponsiveImageHero.tsx): High-performance responsive hero banner using Next.js 16 `next/image` with accurate responsive `sizes`, priority LCP loading, and container-aware overlay.
