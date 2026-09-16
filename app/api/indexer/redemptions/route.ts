import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  ApiResponse,
  PendingRedemptionDto,
  toPendingRedemptionDto,
} from "@/app/lib/indexer-mappers";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";
import { fetchPendingRedemptions } from "./queries";

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
      { headers: NO_CACHE_HEADERS, status: 200 }
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
      { headers: NO_CACHE_HEADERS, status: 400 }
    );
  }

  try {
    const rows = await fetchPendingRedemptions({
      user,
      poolId,
      status: statusParam,
      limit,
    });

    const data = rows.map(toPendingRedemptionDto);

    return NextResponse.json(
      { success: true, data, fallbackRequired: false },
      { headers: NO_CACHE_HEADERS }
    );
  } catch (err: unknown) {
    console.warn("[API Redemptions Error - Falling Back to RPC]:", err);
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { headers: NO_CACHE_HEADERS, status: 200 }
    );
  }
}
