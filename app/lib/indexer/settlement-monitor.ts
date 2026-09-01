import { db } from "../db";
import { pendingRedemptions } from "../db/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import {
  broadcastAggregatedInvalidations,
  type RealtimeBroadcastItem,
} from "../realtime/server";

export class SettlementMonitorService {
  async checkHumaSettlements(
    poolId: number,
    nextRequestId: bigint
  ): Promise<number> {
    const updated = await db
      .update(pendingRedemptions)
      .set({ status: "ready" })
      .where(
        and(
          eq(pendingRedemptions.poolId, poolId),
          eq(pendingRedemptions.status, "settling"),
          isNotNull(pendingRedemptions.humaRequestId),
          lt(pendingRedemptions.humaRequestId, nextRequestId.toString())
        )
      )
      .returning({ userAddress: pendingRedemptions.userAddress });

    if (updated.length > 0) {
      const distinctUsers = Array.from(
        new Set(updated.map((u) => u.userAddress))
      );
      const invalidations: RealtimeBroadcastItem[] = distinctUsers.map(
        (userAddress) => ({
          scopes: ["redemptions", "user"],
          poolId,
          userAddress,
          reason: "settlement:huma_ready",
        })
      );
      if (distinctUsers.length > 1) {
        invalidations.push({
          scopes: ["redemptions"],
          poolId,
          reason: "settlement:huma_ready",
        });
      }
      await broadcastAggregatedInvalidations(invalidations);
    }
    return updated.length;
  }
}
