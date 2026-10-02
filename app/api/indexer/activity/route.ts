import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  ActivityLedgerFilterSchema,
  type BaseIndexerRouteDeps,
  type KeysetActivityResponse,
} from "@/app/types/indexer-contracts";
import {
  respondSuccess,
  respondFallback,
  respondValidationError,
} from "@/app/lib/indexer-response";
import { fetchKeysetActivity } from "./queries";

export const dynamic = "force-dynamic";

export interface ActivityRouteDeps extends BaseIndexerRouteDeps {
  fetchActivity?: typeof fetchKeysetActivity;
}

export async function handleGetActivity(
  req: NextRequest,
  deps: ActivityRouteDeps = {}
): Promise<NextResponse<KeysetActivityResponse>> {
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
    return respondValidationError(parsed.error);
  }

  const isConfigured = deps.isConfigured ?? isDatabaseConfigured;
  if (!isConfigured) {
    return respondFallback("Database not configured");
  }

  try {
    const fetchActivityFn = deps.fetchActivity ?? fetchKeysetActivity;
    const result = await fetchActivityFn(parsed.data);

    return respondSuccess(result.data, {
      meta: result.meta,
    });
  } catch (err: unknown) {
    console.warn("[Indexer Activity API Error - Falling Back to RPC]:", err);
    return respondFallback(err);
  }
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<KeysetActivityResponse>> {
  return handleGetActivity(req);
}
