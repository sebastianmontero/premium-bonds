import { db } from "@/app/lib/db";
import { pendingRedemptions } from "@/app/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import type { RedemptionLedgerFilters } from "@/app/types/indexer-contracts";
import {
  toPendingRedemptionDto,
  type PendingRedemptionDto,
} from "@/app/lib/indexer-mappers";

export async function fetchPendingRedemptions(
  params: RedemptionLedgerFilters,
  dbClient = db
): Promise<PendingRedemptionDto[]> {
  const conditions = [
    eq(pendingRedemptions.poolId, params.poolId),
    eq(pendingRedemptions.userAddress, params.user),
  ];
  if (params.status === "pending") {
    conditions.push(inArray(pendingRedemptions.status, ["settling", "ready"]));
  } else if (params.status !== "all") {
    conditions.push(eq(pendingRedemptions.status, params.status));
  }
  const rows = await dbClient
    .select()
    .from(pendingRedemptions)
    .where(and(...conditions))
    .orderBy(desc(pendingRedemptions.requestedAt))
    .limit(params.limit);
  return rows.map(toPendingRedemptionDto);
}
