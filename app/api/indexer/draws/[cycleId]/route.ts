import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { drawHistory, drawWinners } from "@/app/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  ApiResponse,
  toPrizeHistoryEntryDto,
  PrizeHistoryEntryDto,
} from "@/app/lib/indexer-mappers";

export const dynamic = "force-dynamic";

export interface DetailedDrawCycleApiResponse {
  poolId: number;
  cycleId: number;
  status: string;
  prizePot: string;
  cycleFeeCollected: string;
  lockedTicketCount: string;
  harvestSlot: number;
  randomnessAccount: string;
  vrfSeedHex: string;
  winnersCount: number;
  totalDistributed: string;
  winnersSynced: boolean;
  initiatedAt: number | null;
  revealedAt: number | null;
  completedAt: number | null;
  winners: PrizeHistoryEntryDto[];
}

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ cycleId: string }> }
): Promise<NextResponse<ApiResponse<DetailedDrawCycleApiResponse>>> {
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

  try {
    const { cycleId: cycleIdParam } = await context.params;
    const cycleNum = parseInt(cycleIdParam, 10);
    const poolId = parseInt(req.nextUrl.searchParams.get("poolId") || "1", 10);

    if (isNaN(cycleNum) || isNaN(poolId)) {
      return NextResponse.json(
        {
          success: false,
          fallbackRequired: true,
          error: "Invalid cycleId or poolId",
        },
        { status: 400 }
      );
    }

    const [draw] = await db
      .select()
      .from(drawHistory)
      .where(
        and(eq(drawHistory.poolId, poolId), eq(drawHistory.cycleId, cycleNum))
      )
      .limit(1);

    if (!draw) {
      return NextResponse.json(
        {
          success: false,
          fallbackRequired: true,
          error: "Draw cycle not found",
        },
        { status: 404 }
      );
    }

    const winners = await db
      .select()
      .from(drawWinners)
      .where(
        and(eq(drawWinners.poolId, poolId), eq(drawWinners.cycleId, cycleNum))
      )
      .orderBy(drawWinners.winnerIndex);

    const data: DetailedDrawCycleApiResponse = {
      poolId: draw.poolId,
      cycleId: draw.cycleId,
      status: draw.status,
      prizePot: draw.prizePot.toString(),
      cycleFeeCollected: draw.cycleFeeCollected.toString(),
      lockedTicketCount: draw.lockedTicketCount.toString(),
      harvestSlot: draw.harvestSlot,
      randomnessAccount: draw.randomnessAccount,
      vrfSeedHex: draw.vrfSeedHex,
      winnersCount: draw.winnersCount,
      totalDistributed: draw.totalDistributed.toString(),
      winnersSynced: draw.winnersSynced,
      initiatedAt: draw.initiatedAt,
      revealedAt: draw.revealedAt,
      completedAt: draw.completedAt,
      winners: winners.map(toPrizeHistoryEntryDto),
    };

    return NextResponse.json(
      { success: true, data, fallbackRequired: false },
      {
        headers: {
          "Cache-Control":
            draw.status === "Complete"
              ? "public, s-maxage=86400, stale-while-revalidate=604800"
              : "no-store",
        },
      }
    );
  } catch (err: unknown) {
    console.error("[API Draw Details Error]:", err);
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
