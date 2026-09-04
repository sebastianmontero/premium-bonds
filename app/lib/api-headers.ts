/**
 * Shared HTTP response header constants for indexer API routes.
 * Decoupled from record mappers to prevent Divergent Change.
 */
export const NO_CACHE_HEADERS = {
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
} as const;
