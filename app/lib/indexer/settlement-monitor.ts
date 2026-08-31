import { db } from "../db";
import { pendingRedemptions } from "../db/schema";
import { eq, and, lt, isNotNull } from "drizzle-orm";
import { broadcastAggregatedInvalidations } from "../realtime/server";

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
      await broadcastAggregatedInvalidations([
        {
          scopes: ["redemptions", "user"],
          poolId,
          userAddress:
            distinctUsers.length === 1 ? distinctUsers[0] : undefined,
          reason: "settlement:huma_ready",
        },
      ]);
    }
    return updated.length;
  }
}
