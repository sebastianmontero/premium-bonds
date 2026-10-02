import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import {
  PrizeLedgerFilterSchema,
  type BaseIndexerRouteDeps,
  type PaginatedWinnersResponse,
} from "@/app/types/indexer-contracts";
import {
  respondSuccess,
  respondFallback,
  respondValidationError,
} from "@/app/lib/indexer-response";
import { fetchPaginatedWinners } from "./queries";

export const dynamic = "force-dynamic";

export interface WinnersRouteDeps extends BaseIndexerRouteDeps {
  fetchWinners?: typeof fetchPaginatedWinners;
}

export async function handleGetWinners(
  req: NextRequest,
  deps: WinnersRouteDeps = {}
): Promise<NextResponse<PaginatedWinnersResponse>> {
  const { searchParams } = req.nextUrl;
  const rawParams = {
    user: searchParams.get("user") || undefined,
    poolId: searchParams.get("poolId") || 1,
    cycleId: searchParams.get("cycleId") || undefined,
    page: searchParams.get("page") || 1,
    pageSize: searchParams.get("pageSize") || searchParams.get("limit") || 10,
    status: searchParams.get("status") || "all",
    tierIndex: searchParams.get("tierIndex") ?? undefined,
    search: searchParams.get("search") || undefined,
  };

  const parsed = PrizeLedgerFilterSchema.safeParse(rawParams);
  if (!parsed.success) {
    return respondValidationError(parsed.error);
  }

  const isConfigured = deps.isConfigured ?? isDatabaseConfigured;
  if (!isConfigured) {
    return respondFallback("Database not configured");
  }

  try {
    const fetchWinnersFn = deps.fetchWinners ?? fetchPaginatedWinners;
    const result = await fetchWinnersFn(parsed.data);

    const headers = parsed.data.user
      ? NO_CACHE_HEADERS
      : { "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30" };

    return respondSuccess(result.data, {
      meta: result.meta,
      aggregates: result.aggregates,
      headers,
    });
  } catch (err: unknown) {
    console.error("[API Winners Error]:", err);
    return respondFallback(err);
  }
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<PaginatedWinnersResponse>> {
  return handleGetWinners(req);
}
