import { NextRequest, NextResponse } from "next/server";
import { getCachedPoolInfo } from "@/app/lib/services/pool-state-service";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const poolId = Number(searchParams.get("poolId") || 1);

  try {
    const poolInfo = await getCachedPoolInfo(poolId);
    if (!poolInfo) {
      return NextResponse.json(
        { error: "Pool not initialized", code: "POOL_NOT_INITIALIZED" },
        { status: 404 }
      );
    }
    return NextResponse.json(poolInfo, {
      headers: {
        "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10",
      },
    });
  } catch (error) {
    console.error("[api/indexer/pool] Failed to fetch pool state:", error);
    return NextResponse.json(
      { error: "Failed to fetch on-chain pool state" },
      { status: 500 }
    );
  }
}
