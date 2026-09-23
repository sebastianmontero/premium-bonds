# React 19 & Next.js 16 App Router Responsive Architecture

## 1. The Zero Hydration Mismatch Guarantee

The fundamental law of modern React 19 Server Components (RSC) and SSR:

> **The server has no viewport, no screen resolution, and no window object.**

Any attempt to render different HTML trees on the server versus client based on screen dimensions produces a React hydration error, flashes unstyled or incorrect content, and breaks client interactivity.

### 1.1 Anti-Pattern: Viewport Sniffing in Component Render

```tsx
// ❌ WRONG: Triggers Hydration Mismatch & Layout Flashing
export function BrokenHeader() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    setIsMobile(window.innerWidth < 768);
  }, []);

  // Server renders desktop; on client mount it abruptly flashes to mobile!
  return isMobile ? <MobileMenu /> : <DesktopMenu />;
}
```

### 1.2 Solution Pattern A: CSS-Driven Dual DOM (Recommended)

Render both component structures into HTML. The browser's native CSS layout engine toggles visibility **before the first paint**, achieving 0 ms layout shift and 0 KB JavaScript hydration overhead:

```tsx
// ✅ CORRECT: Zero Hydration Mismatch, Zero CLS
export function ResponsiveNavbar() {
  return (
    <header className="relative w-full border-b border-outline-variant bg-surface">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6">
        <Logo />

        {/* Mobile presentation (hidden on md+) */}
        <div className="flex items-center gap-2 md:hidden">
          <MobileSearchTrigger />
          <MobileDrawerMenu />
        </div>

        {/* Desktop presentation (hidden on mobile) */}
        <nav className="hidden items-center gap-6 md:flex">
          <DesktopNavLinks />
          <DesktopSearchBar />
          <UserActionGroup />
        </nav>
      </div>
    </header>
  );
}
```

### 1.3 Solution Pattern B: SSR-Safe `useSyncExternalStore`

If the mobile and desktop variants have drastically different component weight or mutually exclusive third-party dependencies (e.g. mobile touch swipe carousel vs desktop virtualized AG-Grid), use a safe `useSyncExternalStore` hook with an explicit server default:

```tsx
"use client";

import { useSyncExternalStore } from "react";

function subscribe(callback: () => void) {
  const mql = window.matchMedia("(min-width: 768px)");
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}

function getSnapshot() {
  return window.matchMedia("(min-width: 768px)").matches;
}

function getServerSnapshot() {
  return false; // Deterministic server baseline: Mobile-First
}

export function useIsDesktop(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// In the component:
export function HeavyDataTable({ rows }: { rows: Row[] }) {
  const isDesktop = useIsDesktop();
  // Hydrates cleanly because server matches client initial snapshot (false)
  return isDesktop ? (
    <DesktopVirtualGrid rows={rows} />
  ) : (
    <MobileVirtualList rows={rows} />
  );
}
```

---

## 2. Server Components Streaming & Zero-CLS Skeletons

In Next.js 16, layouts and page wrappers should remain **Server Components (RSC)**. When streaming data using `<Suspense>`, Cumulative Layout Shift (CLS) occurs if the fallback skeleton dimensions deviate from the resolved component.

### 2.1 Geometry-Matched Skeleton Rule

The skeleton container must replicate the exact CSS Grid / Flexbox classes, gap spacing, and padding of the resolved component.

```tsx
// app/[locale]/bonds/page.tsx (Server Component)
import { Suspense } from "react";
import { BondsGrid, BondsGridSkeleton } from "@/components/bonds/BondsGrid";

export default async function BondsPage() {
  return (
    <section className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-on-surface sm:text-3xl">
          Available Bonds
        </h1>
      </header>

      {/* Skeletons match responsive geometry identically */}
      <Suspense fallback={<BondsGridSkeleton />}>
        <BondsGrid />
      </Suspense>
    </section>
  );
}

// components/bonds/BondsGrid.tsx
export function BondsGridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <div
          key={i}
          className="h-64 animate-pulse rounded-2xl bg-surface-container-high border border-outline-variant/40"
        />
      ))}
    </div>
  );
}
```

---

## 3. Responsive Images with `next/image`

The `next/image` component optimizes images automatically, but developers frequently miss the **`sizes` attribute**, resulting in massive mobile bandwidth waste and degraded LCP.

### 3.1 The Crucial `sizes` Attribute Formula

When using `fill` or dynamic widths, Next.js generates an `img srcset`. The browser chooses which image resolution to download based entirely on the `sizes` hint.

| Layout Pattern                                        | Optimal `sizes` Attribute                                          |
| :---------------------------------------------------- | :----------------------------------------------------------------- |
| **Full-width Hero Banner**                            | `sizes="100vw"`                                                    |
| **Full-width Mobile, Constrained Desktop Container**  | `sizes="(max-width: 1280px) 100vw, 1280px"`                        |
| **2-Column Grid (1 col on mobile, 2 col on tablet+)** | `sizes="(max-width: 640px) 100vw, 50vw"`                           |
| **3-Column Grid inside `max-w-7xl` container**        | `sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"` |
| **Avatar or Fixed Thumbnail**                         | Do not use `fill`. Use explicit `width={48} height={48}`.          |

### 3.2 LCP Optimization with `priority`

Flag images that appear above the fold (Hero images, top banners) with `priority`. This disables lazy loading and injects a high-priority `<link rel="preload">` in the document head:

```tsx
import Image from "next/image";

export function HeroBanner({
  imageUrl,
  title,
}: {
  imageUrl: string;
  title: string;
}) {
  return (
    <div className="relative aspect-16/9 w-full overflow-hidden rounded-3xl md:aspect-21/9">
      <Image
        src={imageUrl}
        alt={title}
        fill
        priority
        quality={80}
        sizes="(max-width: 768px) 100vw, (max-width: 1280px) 90vw, 1200px"
        className="object-cover object-center"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-surface via-transparent to-transparent" />
    </div>
  );
}
```

---

## 4. Parallel & Intercepting Routes for Adaptive Overlays

Next.js 16 supports rendering an item as an overlay (Modal or Drawer) during client-side navigation, while retaining a full-page URL for direct visits or hard refreshes.

### 4.1 Routing Structure

```
app/
├── @modal/
│   ├── default.tsx                # Returns null
│   └── (.)bonds/[id]/
│       └── page.tsx               # Client overlay: Drawer on mobile, Modal on desktop
├── bonds/
│   └── [id]/
│       └── page.tsx               # Full-page SSR layout (Direct Link / Refresh)
└── layout.tsx                     # Accepts { children, modal }: { children: ReactNode; modal: ReactNode }
```

### 4.2 Adaptive Overlay Implementation

```tsx
// app/@modal/(.)bonds/[id]/page.tsx
"use client";

import { useRouter } from "next/navigation";
import { ResponsiveDialog } from "@/components/common/ResponsiveDialog";

export default function InterceptedBondDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();

  return (
    <ResponsiveDialog isOpen={true} onClose={() => router.back()}>
      {/* Shared bond details content */}
    </ResponsiveDialog>
  );
}
```

---

## 5. React 19 Concurrency & Touch Responsiveness

### 5.1 Non-Blocking Updates with `useTransition`

On mobile devices with slower mobile processors, rendering heavy DOM subtrees (e.g. searching or filtering 100+ cards) blocks the UI thread, causing sluggish scroll behavior and poor Interaction to Next Paint (INP).

Use React 19 `useTransition` to mark responsive view transitions as non-urgent:

```tsx
"use client";

import { useTransition, useState } from "react";

export function ResponsiveFilterableBonds({
  initialBonds,
}: {
  initialBonds: Bond[];
}) {
  const [filteredBonds, setFilteredBonds] = useState(initialBonds);
  const [isPending, startTransition] = useTransition();

  const handleFilter = (category: string) => {
    // Touch ripple & drawer dismiss happen instantly; heavy list re-render is non-blocking
    startTransition(() => {
      setFilteredBonds(initialBonds.filter((b) => b.category === category));
    });
  };

  return (
    <div
      className={isPending ? "opacity-75 transition-opacity" : "opacity-100"}
    >
      <FilterPills onSelect={handleFilter} />
      <BondsGrid bonds={filteredBonds} />
    </div>
  );
}
```
