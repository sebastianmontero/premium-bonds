import { z } from "zod";
import type { ActivityEntry, DrawHistoryStats } from "@/app/types";
import type {
  DrawCycleSummaryDto,
  PrizeHistoryEntryDto,
} from "@/app/lib/indexer-mappers";

/**
 * Branded Keyset Cursor for Activity Feed
 */
export type KeysetCursor = string & { readonly __brand: unique symbol };

/**
 * Encodes blockTime and id into a URL-safe base64url KeysetCursor.
 */
export function encodeKeysetCursor(
  blockTime: number,
  id: number
): KeysetCursor {
  const payload = JSON.stringify({ b: blockTime, i: id });
  const base64url = Buffer.from(payload, "utf8").toString("base64url");
  return base64url as KeysetCursor;
}

/**
 * Decodes a URL-safe base64url (or legacy underscore formatted) KeysetCursor.
 * Returns null if input is malformed.
 */
export function decodeKeysetCursor(
  rawCursor: string | null | undefined
): { blockTime: number; id: number } | null {
  if (!rawCursor || typeof rawCursor !== "string") return null;
  const trimmed = rawCursor.trim();
  if (!trimmed) return null;

  // 1. Try base64url JSON format
  try {
    const jsonStr = Buffer.from(trimmed, "base64url").toString("utf8");
    const parsed = JSON.parse(jsonStr);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof parsed.b === "number" &&
      Number.isFinite(parsed.b) &&
      typeof parsed.i === "number" &&
      Number.isFinite(parsed.i)
    ) {
      return { blockTime: parsed.b, id: parsed.i };
    }
  } catch {
    // Fall through to legacy format
  }

  // 2. Fallback to legacy `${blockTime}_${id}` format
  const parts = trimmed.split("_");
  if (parts.length === 2) {
    const blockTime = Number(parts[0]);
    const id = Number(parts[1]);
    if (Number.isFinite(blockTime) && Number.isFinite(id)) {
      return { blockTime, id };
    }
  }

  return null;
}

// ─── Query Filter Schemas ───────────────────────────────────────────────────

export const PrizeLedgerFilterSchema = z.object({
  user: z.string().trim().min(32).max(44).optional(),
  poolId: z.coerce.number().int().positive().default(1),
  cycleId: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(["all", "processing", "reinvested"]).default("all"),
  tier: z.enum(["all", "grand", "runnerup", "consolation"]).default("all"),
  search: z.string().trim().optional(),
});

export type PrizeLedgerFilters = z.infer<typeof PrizeLedgerFilterSchema>;

export const ActivityLedgerFilterSchema = z.object({
  user: z.string().trim().min(32).max(44),
  poolId: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().trim().optional(),
  type: z
    .enum([
      "all",
      "deposit",
      "withdraw",
      "win",
      "auto-reinvest",
      "claim-redemption",
    ])
    .default("all"),
  search: z.string().trim().optional(),
});

export type ActivityLedgerFilters = z.infer<typeof ActivityLedgerFilterSchema>;

import { VALID_DRAW_STATUS_FILTERS } from "@/app/lib/draw-helpers";

export const DrawExplorerFilterSchema = z.object({
  poolId: z.coerce.number().int().positive().default(1),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
  status: z.enum(VALID_DRAW_STATUS_FILTERS).default("all"),
  search: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export type DrawExplorerFilters = z.infer<typeof DrawExplorerFilterSchema>;

// ─── API Envelope Response Contracts ────────────────────────────────────────

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface KeysetMeta {
  limit: number;
  nextCursor: KeysetCursor | null;
  hasMore: boolean;
}

export interface PrizeLedgerAggregates {
  totalFilteredValue: string;
}

export interface ApiSuccessResponse<
  T,
  TMeta = Record<string, unknown>,
  TAggregates = Record<string, unknown>,
> {
  success: true;
  data: T;
  meta?: TMeta;
  aggregates?: TAggregates;
  fallbackRequired: false;
}

export interface ApiErrorResponse {
  success: false;
  data?: never;
  meta?: never;
  aggregates?: never;
  fallbackRequired: true;
  error: string;
}

export type ApiResponse<
  T,
  TMeta = Record<string, unknown>,
  TAggregates = Record<string, unknown>,
> = ApiSuccessResponse<T, TMeta, TAggregates> | ApiErrorResponse;

export type PaginatedWinnersResponse = ApiResponse<
  PrizeHistoryEntryDto[],
  PaginationMeta,
  PrizeLedgerAggregates
>;

export type KeysetActivityResponse = ApiResponse<ActivityEntry[], KeysetMeta>;

export type PaginatedDrawsResponse = ApiResponse<
  DrawCycleSummaryDto[],
  PaginationMeta,
  DrawHistoryStats
>;
