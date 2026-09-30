import type { QueryClient, QueryKey } from "@tanstack/react-query";

export class DebouncedQueryInvalidator {
  private pendingKeys = new Map<string, QueryKey>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private windowStart = 0;
  private disposed = false;

  constructor(
    private readonly queryClient: QueryClient,
    private readonly delayMs: number = 150,
    private readonly maxCoalesceMs: number = 500
  ) {}

  schedule(keys: readonly (readonly unknown[])[]): void {
    if (this.disposed) return;

    for (const key of keys) {
      this.pendingKeys.set(JSON.stringify(key), key as QueryKey);
    }

    const now = Date.now();
    if (!this.timer) {
      this.windowStart = now;
      this.timer = setTimeout(() => this.flush(), this.delayMs);
    } else if (now - this.windowStart < this.maxCoalesceMs) {
      // Extend timer within the maximum coalescing burst window
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.flush(), this.delayMs);
    }
    // If maxCoalesceMs is reached, let the existing timer fire without extending
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingKeys.size === 0) return;

    const keysToInvalidate = Array.from(this.pendingKeys.values());
    this.pendingKeys.clear();
    this.windowStart = 0;

    for (const queryKey of keysToInvalidate) {
      this.queryClient.invalidateQueries({ queryKey });
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.flush();
  }
}
