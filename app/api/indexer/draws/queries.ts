import { db } from "@/app/lib/db";
import { drawHistory, drawWinners } from "@/app/lib/db/schema";
import { eq, desc, getTableColumns, sql } from "drizzle-orm";

/**
 * Builds the correlated query for draw cycles with per-cycle processed winner counts.
 *
 * NOTE: Explicit table qualification (${drawWinners}.${drawWinners.poolId}) is required
 * because Drizzle's PgDialect strips table prefixes from PgColumn instances in single-table
 * queries (isSingleTable: true), which otherwise compiles into the self-tautological
 * subquery condition `"pool_id" = "pool_id" AND "cycle_id" = "cycle_id"`.
 */
export function buildDrawCyclesWithPayoutsQuery(
  poolId: number = 1,
  limit: number = 50
) {
  const sanitizedPoolId = Number.isFinite(poolId) && poolId > 0 ? poolId : 1;
  const sanitizedLimit = Math.min(Math.max(1, Number(limit) || 50), 100);

  return db
    .select({
      ...getTableColumns(drawHistory),
      payoutsCompleted: sql<number>`COALESCE((
        SELECT count(*)::int
        FROM ${drawWinners}
        WHERE ${drawWinners}.${drawWinners.poolId} = ${drawHistory}.${drawHistory.poolId}
          AND ${drawWinners}.${drawWinners.cycleId} = ${drawHistory}.${drawHistory.cycleId}
          AND ${drawWinners}.${drawWinners.processed} = true
      ), 0)`,
    })
    .from(drawHistory)
    .where(eq(drawHistory.poolId, sanitizedPoolId))
    .orderBy(desc(drawHistory.cycleId))
    .limit(sanitizedLimit);
}
