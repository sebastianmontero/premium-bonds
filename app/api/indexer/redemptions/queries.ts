import { db } from "@/app/lib/db";
import { pendingRedemptions } from "@/app/lib/db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";

export async function fetchPendingRedemptions(
  params: {
    user: string;
    poolId: number;
    status: string;
    limit: number;
  },
  dbClient = db
) {
  const conditions = [
    eq(pendingRedemptions.poolId, params.poolId),
    eq(pendingRedemptions.userAddress, params.user),
  ];
  if (params.status === "pending") {
    conditions.push(inArray(pendingRedemptions.status, ["settling", "ready"]));
  } else if (params.status !== "all") {
    conditions.push(eq(pendingRedemptions.status, params.status));
  }
  return dbClient
    .select()
    .from(pendingRedemptions)
    .where(and(...conditions))
    .orderBy(desc(pendingRedemptions.requestedAt))
    .limit(params.limit);
}
