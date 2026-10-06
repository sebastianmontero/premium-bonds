import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import type { DrawCycleSummaryDto } from "@/app/lib/indexer-mappers";
import type { DrawHistoryStats } from "@/app/types";
import { defaultPoolStatsAggregator } from "@/app/lib/services/pool-stats-aggregator";
import {
  DrawExplorerFilterSchema,
  type BaseIndexerRouteDeps,
  type PaginatedDrawsResponse,
} from "@/app/types/indexer-contracts";
import {
  respondSuccess,
  respondFallback,
  respondValidationError,
} from "@/app/lib/indexer-response";
import { fetchPaginatedDraws } from "./queries";

export type { DrawCycleSummaryDto };

export const dynamic = "force-dynamic";

export interface DrawsRouteDeps extends BaseIndexerRouteDeps {
  fetchDraws?: typeof fetchPaginatedDraws;
  getPoolStats?: (
    poolId: number,
    options?: { bypassCache?: boolean }
  ) => Promise<DrawHistoryStats | null | undefined>;
}

export async function handleGetDraws(
  req: NextRequest,
  deps: DrawsRouteDeps = {}
): Promise<NextResponse<PaginatedDrawsResponse>> {
  const { searchParams } = req.nextUrl;
  const bypassCache = searchParams.get("bypassCache") === "true";
  const rawParams = {
    poolId: searchParams.get("poolId") || 1,
    page: searchParams.get("page") || 1,
    pageSize: searchParams.get("pageSize") || searchParams.get("limit") || 10,
    limit: searchParams.get("limit") || undefined,
    status: searchParams.get("status") || "all",
    search: searchParams.get("search") || undefined,
  };

  const parsed = DrawExplorerFilterSchema.safeParse(rawParams);
  if (!parsed.success) {
    return respondValidationError(parsed.error);
  }

  const isConfigured = deps.isConfigured ?? isDatabaseConfigured;
  if (!isConfigured) {
    return respondFallback("Database not configured");
  }

  try {
    const fetchDrawsFn = deps.fetchDraws ?? fetchPaginatedDraws;
    const getStatsFn =
      deps.getPoolStats ??
      ((poolId: number, options?: { bypassCache?: boolean }) =>
        defaultPoolStatsAggregator.getPoolDrawStats(poolId, options));

    const [result, poolStats] = await Promise.all([
      fetchDrawsFn(parsed.data),
      getStatsFn(parsed.data.poolId, { bypassCache }),
    ]);

    return respondSuccess(result.data, {
      meta: result.meta,
      aggregates: poolStats ?? null,
    });
  } catch (err: unknown) {
    console.warn("[Indexer Draws API Error - Falling Back to RPC]:", err);
    return respondFallback(err);
  }
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<PaginatedDrawsResponse>> {
  return handleGetDraws(req);
}
