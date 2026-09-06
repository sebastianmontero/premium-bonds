import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  PrizeLedgerFilterSchema,
  type PaginatedWinnersResponse,
} from "@/app/types/indexer-contracts";
import { fetchPaginatedWinners } from "./queries";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest
): Promise<NextResponse<PaginatedWinnersResponse>> {
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
  const rawParams = {
    user: searchParams.get("user") || undefined,
    poolId: searchParams.get("poolId") || 1,
    cycleId: searchParams.get("cycleId") || undefined,
    page: searchParams.get("page") || 1,
    pageSize: searchParams.get("pageSize") || searchParams.get("limit") || 10,
    status: searchParams.get("status") || "all",
    tier: searchParams.get("tier") || "all",
    search: searchParams.get("search") || undefined,
  };

  const parsed = PrizeLedgerFilterSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      },
      { status: 400 }
    );
  }

  try {
    const result = await fetchPaginatedWinners(parsed.data);

    return NextResponse.json(
      {
        success: true,
        data: result.data,
        meta: result.meta,
        aggregates: result.aggregates,
        fallbackRequired: false,
      },
      {
        headers: {
          "Cache-Control": parsed.data.user
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
