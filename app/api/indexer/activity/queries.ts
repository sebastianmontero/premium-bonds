import { sql } from "drizzle-orm";
import { db } from "@/app/lib/db";
import { bondsActivity } from "@/app/lib/db/schema";
import { formatActivityDescription } from "@/app/lib/activity-helpers";
import {
  decodeKeysetCursor,
  encodeKeysetCursor,
  type ActivityLedgerFilters,
  type KeysetCursor,
  type KeysetMeta,
} from "@/app/types/indexer-contracts";
import type { ActivityEntry, ActivityType } from "@/app/types";

export interface KeysetActivityResult {
  data: ActivityEntry[];
  meta: KeysetMeta;
}

interface ActivityRow extends Record<string, unknown> {
  id: number;
  signature: string;
  event_index: number;
  user_address: string;
  pool_id: number;
  activity_type: string;
  bonds: number;
  amount_usdc: string | number;
  redemption_id: string | number | null;
  cycle_id: number | null;
  block_time: number;
}

export async function fetchKeysetActivity(
  filters: ActivityLedgerFilters
): Promise<KeysetActivityResult> {
  const limit = Math.min(Math.max(1, filters.limit || 20), 100);
  const conditions: ReturnType<typeof sql>[] = [
    sql`${bondsActivity.userAddress} = ${filters.user}`,
    sql`${bondsActivity.poolId} = ${filters.poolId}`,
  ];

  if (filters.cursor) {
    const decoded = decodeKeysetCursor(filters.cursor);
    if (decoded) {
      conditions.push(
        sql`(${bondsActivity.blockTime}, ${bondsActivity.id}) < (${decoded.blockTime}, ${decoded.id})`
      );
    }
  }

  if (filters.type && filters.type !== "all") {
    conditions.push(sql`${bondsActivity.activityType} = ${filters.type}`);
  }

  if (filters.search) {
    const term = filters.search.trim();
    const cleanNumeric = term.replace(/^#/, "").trim();
    const num = Number(cleanNumeric);

    if (!isNaN(num) && cleanNumeric !== "") {
      conditions.push(
        sql`(${bondsActivity.cycleId} = ${num} OR ${bondsActivity.signature} ILIKE ${term + "%"})`
      );
    } else {
      conditions.push(
        sql`(${bondsActivity.signature} ILIKE ${term + "%"} OR ${bondsActivity.activityType} ILIKE ${term + "%"})`
      );
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);

  // Fetch limit + 1 to determine hasMore cleanly in a single round-trip
  const query = sql`
    SELECT
      ${bondsActivity.id},
      ${bondsActivity.signature},
      ${bondsActivity.eventIndex},
      ${bondsActivity.userAddress},
      ${bondsActivity.poolId},
      ${bondsActivity.activityType},
      ${bondsActivity.bonds},
      ${bondsActivity.amountUsdc},
      ${bondsActivity.redemptionId},
      ${bondsActivity.cycleId},
      ${bondsActivity.blockTime}
    FROM ${bondsActivity}
    WHERE ${whereClause}
    ORDER BY ${bondsActivity.blockTime} DESC, ${bondsActivity.id} DESC
    LIMIT ${limit + 1};
  `;

  const result = await db.execute<ActivityRow>(query);
  const rows = result.rows;

  const hasMore = rows.length > limit;
  const pagedRows = hasMore ? rows.slice(0, limit) : rows;

  const data: ActivityEntry[] = pagedRows.map((r) => ({
    id: `evt-${r.activity_type}-${r.signature.slice(0, 8)}-${r.event_index}`,
    date: new Date(Number(r.block_time) * 1000).toISOString(),
    type: r.activity_type as ActivityType,
    description: formatActivityDescription({
      activityType: r.activity_type,
      bonds: r.bonds,
      amountUsdc: Number(r.amount_usdc),
      cycleId: r.cycle_id,
    }),
    amount: Number(r.amount_usdc),
    txSignature: r.signature,
  }));

  const lastRow = pagedRows[pagedRows.length - 1];
  const nextCursor: KeysetCursor | null =
    hasMore && lastRow
      ? encodeKeysetCursor(Number(lastRow.block_time), Number(lastRow.id))
      : null;

  return {
    data,
    meta: {
      limit,
      nextCursor,
      hasMore,
    },
  };
}
