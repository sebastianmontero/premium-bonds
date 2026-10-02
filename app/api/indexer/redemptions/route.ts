import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/app/lib/db";
import {
  RedemptionLedgerFilterSchema,
  type BaseIndexerRouteDeps,
  type PendingRedemptionsResponse,
} from "@/app/types/indexer-contracts";
import {
  respondSuccess,
  respondFallback,
  respondValidationError,
} from "@/app/lib/indexer-response";
import { fetchPendingRedemptions } from "./queries";

export const dynamic = "force-dynamic";

export interface RedemptionsRouteDeps extends BaseIndexerRouteDeps {
  fetchRedemptions?: typeof fetchPendingRedemptions;
}

export async function handleGetRedemptions(
  req: NextRequest,
  deps: RedemptionsRouteDeps = {}
): Promise<NextResponse<PendingRedemptionsResponse>> {
  const { searchParams } = req.nextUrl;
  const rawParams = {
    user: searchParams.get("user") || undefined,
    poolId: searchParams.get("poolId") || 1,
    status: searchParams.get("status") || "pending",
    limit: searchParams.get("limit") || 50,
  };

  const parsed = RedemptionLedgerFilterSchema.safeParse(rawParams);
  if (!parsed.success) {
    return respondValidationError(parsed.error);
  }

  const isConfigured = deps.isConfigured ?? isDatabaseConfigured;
  if (!isConfigured) {
    return respondFallback("Database not configured");
  }

  try {
    const fetchRedemptionsFn = deps.fetchRedemptions ?? fetchPendingRedemptions;
    const data = await fetchRedemptionsFn(parsed.data);

    return respondSuccess(data);
  } catch (err: unknown) {
    console.warn("[API Redemptions Error - Falling Back to RPC]:", err);
    return respondFallback(err);
  }
}

export async function GET(
  req: NextRequest
): Promise<NextResponse<PendingRedemptionsResponse>> {
  return handleGetRedemptions(req);
}
