import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import type { DrawCycleSummaryDto } from "@/app/lib/indexer-mappers";
import { defaultPoolStatsAggregator } from "@/app/lib/services/pool-stats-aggregator";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import {
  DrawExplorerFilterSchema,
  type PaginatedDrawsResponse,
} from "@/app/types/indexer-contracts";
import { fetchPaginatedDraws } from "./queries";

export type { DrawCycleSummaryDto };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<
  NextResponse<
    PaginatedDrawsResponse & {
      draws?: unknown;
      stats?: unknown;
      fallback?: boolean;
    }
  >
> {
  if (!isDatabaseConfigured) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        fallback: true,
        error: "Database not configured",
      },
      { headers: NO_CACHE_HEADERS, status: 200 }
    );
  }

  const { searchParams } = req.nextUrl;
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
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        fallback: true,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      },
      { headers: NO_CACHE_HEADERS, status: 400 }
    );
  }

  try {
    const [result, poolStats] = await Promise.all([
      fetchPaginatedDraws(parsed.data),
      defaultPoolStatsAggregator.getPoolDrawStats(parsed.data.poolId, {
        bypassCache: true,
      }),
    ]);

    const stats = poolStats ?? {
      totalYieldDistributed: 0,
      totalDrawsCompleted: 0,
      totalWinningBonds: 0,
      averagePrizePot: 0,
    };

    const headers = result.allFinalized
      ? { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120" }
      : NO_CACHE_HEADERS;

    return NextResponse.json(
      {
        success: true,
        data: result.data,
        meta: result.meta,
        aggregates: stats,
        draws: result.data,
        stats,
        fallbackRequired: false,
        fallback: false,
      },
      { headers }
    );
  } catch (err: unknown) {
    console.warn("[Indexer Draws API Error - Falling Back to RPC]:", err);
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { headers: NO_CACHE_HEADERS, status: 200 }
    );
  }
}
