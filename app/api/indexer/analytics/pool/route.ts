import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { poolSnapshots } from "@/app/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import {
  ApiResponse,
  PoolSnapshotDto,
  toPoolSnapshotDto,
} from "@/app/lib/indexer-mappers";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest
): Promise<NextResponse<ApiResponse<PoolSnapshotDto[]>>> {
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
  const limit = Math.min(Number(searchParams.get("limit") || 30), 100);

  try {
    const rows = await db
      .select()
      .from(poolSnapshots)
      .where(eq(poolSnapshots.poolId, poolId))
      .orderBy(desc(poolSnapshots.snapshotTime))
      .limit(limit);

    const data = rows.map(toPoolSnapshotDto);

    return NextResponse.json(
      { success: true, data, fallbackRequired: false },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
        },
      }
    );
  } catch (err: unknown) {
    console.error("[API Analytics Pool Error]:", err);
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
