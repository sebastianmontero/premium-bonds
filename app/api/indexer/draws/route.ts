import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  mapDrawHistoryRowsToSummaries,
  type DrawCycleSummaryDto,
} from "@/app/lib/indexer-mappers";
import { defaultPoolStatsAggregator } from "@/app/lib/services/pool-stats-aggregator";
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
    const [rows, poolStats] = await Promise.all([
      buildDrawCyclesWithPayoutsQuery(poolId, limit),
      defaultPoolStatsAggregator.getPoolDrawStats(poolId, {
        bypassCache: true,
      }),
    ]);

    const summaries = mapDrawHistoryRowsToSummaries(rows);
    const stats = poolStats ?? {
      totalYieldDistributed: 0,
      totalDrawsCompleted: 0,
      totalWinningBonds: 0,
      averagePrizePot: 0,
    };

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
