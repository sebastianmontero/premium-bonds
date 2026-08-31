import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { userPortfolioStats } from "@/app/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  ApiResponse,
  UserPortfolioStatsDto,
  toUserPortfolioStatsDto,
} from "@/app/lib/indexer-mappers";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest
): Promise<NextResponse<ApiResponse<UserPortfolioStatsDto[]>>> {
  if (!isDatabaseConfigured) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        error: "Database not configured",
      },
      { status: 200 }
    );
  }

  const { searchParams } = req.nextUrl;
  const poolId = Number(searchParams.get("poolId") || 1);
  const sortBy = searchParams.get("sortBy") || "winnings";
  const limit = Math.min(Number(searchParams.get("limit") || 20), 100);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderColumn: any = userPortfolioStats.totalWonUsdc;
    if (sortBy === "bonds") {
      orderColumn = userPortfolioStats.activeBonds;
    } else if (sortBy === "winCount") {
      orderColumn = userPortfolioStats.winCount;
    }

    const rows = await db
      .select()
      .from(userPortfolioStats)
      .where(eq(userPortfolioStats.poolId, poolId))
      .orderBy(desc(orderColumn))
      .limit(limit);

    const data = rows.map(toUserPortfolioStatsDto);

    return NextResponse.json(
      { success: true, data, fallbackRequired: false },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
        },
      }
    );
  } catch (err: unknown) {
    console.error("[API Leaderboard Error]:", err);
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
