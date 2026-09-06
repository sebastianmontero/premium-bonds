import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  ActivityLedgerFilterSchema,
  type KeysetActivityResponse,
} from "@/app/types/indexer-contracts";
import { fetchKeysetActivity } from "./queries";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<
  NextResponse<
    KeysetActivityResponse & {
      entries?: unknown;
      nextCursor?: unknown;
      fallback?: boolean;
    }
  >
> {
  if (!isDatabaseConfigured) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        fallback: true,
        error: "Database not configured",
      },
      { status: 200 }
    );
  }

  const { searchParams } = req.nextUrl;
  const rawParams = {
    user: searchParams.get("user") || undefined,
    poolId: searchParams.get("poolId") || 1,
    limit: searchParams.get("limit") || 20,
    cursor: searchParams.get("cursor") || undefined,
    type: searchParams.get("type") || "all",
    search: searchParams.get("search") || undefined,
  };

  const parsed = ActivityLedgerFilterSchema.safeParse(rawParams);
  if (!parsed.success) {
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        fallback: true,
        error: parsed.error.issues.map((i) => i.message).join(", "),
      },
      { status: 400 }
    );
  }

  try {
    const result = await fetchKeysetActivity(parsed.data);

    return NextResponse.json(
      {
        success: true,
        data: result.data,
        meta: result.meta,
        entries: result.data,
        nextCursor: result.meta.nextCursor,
        fallbackRequired: false,
        fallback: false,
      },
      {
        headers: {
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      }
    );
  } catch (err: unknown) {
    console.warn("[Indexer Activity API Error - Falling Back to RPC]:", err);
    return NextResponse.json(
      {
        success: false,
        fallbackRequired: true,
        fallback: true,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 200 }
    );
  }
}
