import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  mapDrawHistoryRowsToSummaries,
  calculateDrawHistoryStats,
  type DrawCycleSummaryDto,
} from "@/app/lib/indexer-mappers";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import { buildDrawCyclesWithPayoutsQuery } from "./queries";

export type { DrawCycleSummaryDto };

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured) {
    return NextResponse.json(
      { draws: [], stats: null, fallback: true },
      { headers: NO_CACHE_HEADERS }
    );
  }

  const { searchParams } = req.nextUrl;
  const poolId = Number(searchParams.get("poolId") || 1);
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);

  try {
    const query = buildDrawCyclesWithPayoutsQuery(poolId, limit);
    const rows = await query;

    const summaries = mapDrawHistoryRowsToSummaries(rows);
    const stats = calculateDrawHistoryStats(summaries);

    return NextResponse.json(
      { draws: summaries, stats, fallback: false },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (err) {
    console.warn("[Indexer Draws API Error - Falling Back to RPC]:", err);
    return NextResponse.json(
      { draws: [], stats: null, fallback: true },
      { headers: NO_CACHE_HEADERS }
    );
  }
}
