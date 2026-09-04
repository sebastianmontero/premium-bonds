import { NextRequest, NextResponse } from "next/server";
import { db, isDatabaseConfigured } from "@/app/lib/db";
import { pendingRedemptions } from "@/app/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import {
  ApiResponse,
  PendingRedemptionDto,
  toPendingRedemptionDto,
} from "@/app/lib/indexer-mappers";

export const dynamic = "force-dynamic";

const VALID_STATUSES = new Set([
  "pending",
  "settling",
  "ready",
  "claimed",
  "all",
]);

export async function GET(
  req: NextRequest
): Promise<NextResponse<ApiResponse<PendingRedemptionDto[]>>> {
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
  const rawStatus = searchParams.get("status") || "pending";
  const statusParam = VALID_STATUSES.has(rawStatus) ? rawStatus : "pending";
  const limit = Math.min(Number(searchParams.get("limit") || 50), 100);

  if (!user) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        error: "Missing 'user' parameter",
      },
      { status: 400 }
    );
  }

  try {
    const conditions = [
      eq(pendingRedemptions.poolId, poolId),
      eq(pendingRedemptions.userAddress, user),
    ];

    if (statusParam === "pending") {
      conditions.push(
        inArray(pendingRedemptions.status, ["settling", "ready"])
      );
    } else if (statusParam !== "all") {
      conditions.push(eq(pendingRedemptions.status, statusParam));
    }

    const rows = await db
      .select()
      .from(pendingRedemptions)
      .where(and(...conditions))
      .orderBy(desc(pendingRedemptions.requestedAt))
      .limit(limit);

    const data = rows.map(toPendingRedemptionDto);

    return NextResponse.json(
      { success: true, data, fallbackRequired: false },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err: unknown) {
    console.error("[API Redemptions Error]:", err);
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
