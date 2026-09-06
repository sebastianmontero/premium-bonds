import { NextRequest, NextResponse } from "next/server";
import { getEnrichedPoolInfo } from "@/app/lib/services/pool-stats-aggregator";
import { NO_CACHE_HEADERS } from "@/app/lib/api-headers";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const poolId = Number(searchParams.get("poolId") || 1);

  try {
    const poolInfo = await getEnrichedPoolInfo(poolId, { bypassCache: true });
    if (!poolInfo) {
      return NextResponse.json(
        { error: "Pool not initialized", code: "POOL_NOT_INITIALIZED" },
        { status: 404, headers: NO_CACHE_HEADERS }
      );
    }
    return NextResponse.json(poolInfo, {
      headers: NO_CACHE_HEADERS,
    });
  } catch (error) {
    console.error("[api/indexer/pool] Failed to fetch pool state:", error);
    return NextResponse.json(
      { error: "Failed to fetch on-chain pool state" },
      { status: 500, headers: NO_CACHE_HEADERS }
    );
  }
}
