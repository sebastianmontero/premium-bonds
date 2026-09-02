import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { drawWinners } from "@/app/lib/db/schema";
import { eq, and, desc, asc } from "drizzle-orm";
import {
  ApiResponse,
  PrizeHistoryEntryDto,
  toPrizeHistoryEntryDto,
} from "@/app/lib/indexer-mappers";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest
): Promise<NextResponse<ApiResponse<PrizeHistoryEntryDto[]>>> {
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
  const user = searchParams.get("user");
  const poolId = Number(searchParams.get("poolId") || 1);
  const cycleIdParam = searchParams.get("cycleId");
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);

  try {
    const conditions = [eq(drawWinners.poolId, poolId)];
    if (user) {
      conditions.push(eq(drawWinners.winnerAddress, user));
    }
    if (cycleIdParam) {
      const cycleId = Number(cycleIdParam);
      if (!isNaN(cycleId)) {
        conditions.push(eq(drawWinners.cycleId, cycleId));
      }
    }

    const rows = await db
      .select()
      .from(drawWinners)
      .where(and(...conditions))
      .orderBy(
        desc(drawWinners.cycleId),
        asc(drawWinners.tierIndex),
        desc(drawWinners.amountOwed),
        asc(drawWinners.winnerIndex)
      )
      .limit(limit);

    const data = rows.map(toPrizeHistoryEntryDto);

    return NextResponse.json(
      { success: true, data, fallbackRequired: false },
      {
        headers: {
          "Cache-Control": user
            ? "private, no-cache, no-store, must-revalidate"
            : "public, s-maxage=10, stale-while-revalidate=30",
        },
      }
    );
  } catch (err: unknown) {
    console.error("[API Winners Error]:", err);
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
