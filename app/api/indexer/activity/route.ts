import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { bondsActivity } from "@/app/lib/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { formatActivityDescription } from "@/app/lib/activity-helpers";
import type { ActivityEntry, ActivityType } from "@/app/types";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (!isDatabaseConfigured) {
    return NextResponse.json({ entries: [], fallback: true, nextCursor: null });
  }

  const { searchParams } = req.nextUrl;
  const user = searchParams.get("user");
  const poolId = searchParams.get("poolId")
    ? Number(searchParams.get("poolId"))
    : undefined;
  const limit = Math.min(Number(searchParams.get("limit") || 20), 100);
  const cursorParam = searchParams.get("cursor");

  if (!user) {
    return NextResponse.json(
      { error: "Missing 'user' parameter" },
      { status: 400 }
    );
  }

  try {
    const conditions = [eq(bondsActivity.userAddress, user)];
    if (poolId !== undefined) conditions.push(eq(bondsActivity.poolId, poolId));

    if (cursorParam) {
      const [cursorBlockTime, cursorId] = cursorParam.split("_").map(Number);
      if (!isNaN(cursorBlockTime) && !isNaN(cursorId)) {
        conditions.push(
          sql`(${bondsActivity.blockTime}, ${bondsActivity.id}) < (${cursorBlockTime}, ${cursorId})`
        );
      }
    }

    const rows = await db
      .select()
      .from(bondsActivity)
      .where(and(...conditions))
      .orderBy(desc(bondsActivity.blockTime), desc(bondsActivity.id))
      .limit(limit);

    const entries: ActivityEntry[] = rows.map((r) => ({
      id: `evt-${r.activityType}-${r.signature.slice(0, 8)}-${r.eventIndex}`,
      date: new Date(r.blockTime * 1000).toISOString(),
      type: r.activityType as ActivityType,
      description: formatActivityDescription({
        activityType: r.activityType,
        bonds: r.bonds,
        amountUsdc: r.amountUsdc,
        cycleId: r.cycleId,
      }),
      amount: Number(r.amountUsdc),
      txSignature: r.signature,
    }));

    const lastRow = rows[rows.length - 1];
    const nextCursor =
      rows.length === limit && lastRow
        ? `${lastRow.blockTime}_${lastRow.id}`
        : null;

    return NextResponse.json(
      { entries, fallback: false, nextCursor },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err) {
    console.warn("[Indexer Activity API Error - Falling Back to RPC]:", err);
    return NextResponse.json({ entries: [], fallback: true, nextCursor: null });
  }
}
