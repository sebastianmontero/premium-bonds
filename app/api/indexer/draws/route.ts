import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { drawHistory } from "@/app/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import type { DrawHistoryStats, DrawStatusName } from "@/app/types";

export const dynamic = "force-dynamic";

export interface DrawCycleSummaryDto {
  poolId: number;
  cycleId: number;
  status: DrawStatusName;
  prizePot: number;
  cycleFeeCollected: number;
  lockedTicketCount: number;
  harvestSlot: number;
  randomnessAccount: string;
  vrfSeedHex: string;
  winnersCount: number;
  payoutsCompleted: number;
  hasPayoutRegistry: boolean;
  completedAt?: number;
  initiatedAt?: number;
  revealedAt?: number;
}

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ draws: [], stats: null, fallback: true });
  }

  const { searchParams } = req.nextUrl;
  const poolId = Number(searchParams.get("poolId") || 1);
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);

  try {
    const rows = await db
      .select()
      .from(drawHistory)
      .where(eq(drawHistory.poolId, poolId))
      .orderBy(desc(drawHistory.cycleId))
      .limit(limit);

    let totalYield = 0;
    let completedDraws = 0;
    let totalWinningBonds = 0;

    const summaries: DrawCycleSummaryDto[] = rows.map((r) => {
      const potNum = Number(r.prizePot);
      if (r.status === "Complete") {
        completedDraws++;
        totalYield += potNum;
        totalWinningBonds += r.winnersCount;
      }

      return {
        poolId: r.poolId,
        cycleId: r.cycleId,
        status: r.status as DrawStatusName,
        prizePot: potNum,
        cycleFeeCollected: Number(r.cycleFeeCollected ?? 0n),
        lockedTicketCount: r.lockedTicketCount ?? 0,
        harvestSlot: Number(r.harvestSlot ?? 0),
        randomnessAccount: r.randomnessAccount || "",
        vrfSeedHex: r.vrfSeedHex || "",
        winnersCount: r.winnersCount,
        payoutsCompleted: r.winnersCount,
        hasPayoutRegistry: r.winnersCount > 0,
        completedAt: r.blockTime,
        initiatedAt: r.blockTime,
        revealedAt: r.blockTime,
      };
    });

    const stats: DrawHistoryStats = {
      totalYieldDistributed: totalYield,
      totalDrawsCompleted: completedDraws,
      totalWinningBonds,
      averagePrizePot: completedDraws > 0 ? totalYield / completedDraws : 0,
    };

    return NextResponse.json(
      { draws: summaries, stats, fallback: false },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    console.warn("[Indexer Draws API Error - Falling Back to RPC]:", err);
    return NextResponse.json({ draws: [], stats: null, fallback: true });
  }
}
