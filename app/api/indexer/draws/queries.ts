import { db } from "@/app/lib/db";
import { drawHistory, drawWinners } from "@/app/lib/db/schema";
import { eq, desc, getTableColumns, sql } from "drizzle-orm";
import type { DrawCycleSummaryDto } from "@/app/lib/indexer-mappers";
import { isTerminalDrawStatus } from "@/app/lib/draw-helpers";
import type {
  DrawExplorerFilters,
  PaginationMeta,
} from "@/app/types/indexer-contracts";

export interface PaginatedDrawsResult {
  data: DrawCycleSummaryDto[];
  meta: PaginationMeta;
  allFinalized: boolean;
}

interface RawDrawRow extends Record<string, unknown> {
  pool_id: number;
  cycle_id: number;
  status: string;
  prize_pot: string | number;
  cycle_fee_collected: string | number;
  locked_ticket_count: string | number;
  harvest_slot: number;
  randomness_account: string;
  vrf_seed_hex: string;
  winners_count: number;
  total_distributed: string | number;
  winners_synced: boolean;
  initiated_at: number;
  revealed_at: number | null;
  completed_at: number | null;
  signature: string;
  block_time: number;
  payouts_completed: number;
}

interface DrawsEnvelopeRow extends Record<string, unknown> {
  total_count: number;
  rows: RawDrawRow[];
}

/**
 * Builds the correlated query for draw cycles with per-cycle processed winner counts.
 * Maintained for backwards compatibility and unit test assertions.
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

/**
 * Executes a high-performance paginated CTE with indexed lateral join for draw history.
 */
export async function fetchPaginatedDraws(
  filters: DrawExplorerFilters
): Promise<PaginatedDrawsResult> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(
    Math.max(1, filters.pageSize || filters.limit || 10),
    100
  );
  const offset = (page - 1) * pageSize;

  const conditions: ReturnType<typeof sql>[] = [
    sql`dh.pool_id = ${filters.poolId}`,
  ];

  if (filters.status && filters.status !== "all") {
    conditions.push(sql`dh.status = ${filters.status}`);
  }

  if (filters.search) {
    const term = filters.search.trim();
    const cleanNumeric = term
      .replace(/^draw\s*#?/i, "")
      .replace(/^#/, "")
      .trim();
    const num = Number(cleanNumeric);

    if (!isNaN(num) && cleanNumeric !== "") {
      conditions.push(sql`dh.cycle_id = ${num}`);
    } else {
      conditions.push(
        sql`(dh.signature ILIKE ${term + "%"} OR dh.vrf_seed_hex ILIKE ${term + "%"})`
      );
    }
  }

  const whereClause = sql.join(conditions, sql` AND `);

  const query = sql`
    WITH matching_draws AS (
      SELECT *
      FROM draw_history dh
      WHERE ${whereClause}
    ),
    meta AS (
      SELECT COUNT(*)::int AS total_count FROM matching_draws
    ),
    paged_draws AS (
      SELECT * FROM matching_draws
      ORDER BY cycle_id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    ),
    draws_with_payouts AS (
      SELECT
        pd.pool_id,
        pd.cycle_id,
        pd.status,
        pd.prize_pot,
        pd.cycle_fee_collected,
        pd.locked_ticket_count,
        pd.harvest_slot,
        pd.randomness_account,
        pd.vrf_seed_hex,
        pd.winners_count,
        pd.total_distributed,
        pd.winners_synced,
        pd.initiated_at,
        pd.revealed_at,
        pd.completed_at,
        pd.signature,
        pd.block_time,
        COALESCE(pw.payouts_completed, 0) AS payouts_completed
      FROM paged_draws pd
      LEFT JOIN LATERAL (
        SELECT COUNT(*)::int AS payouts_completed
        FROM draw_winners dw
        WHERE dw.pool_id = pd.pool_id
          AND dw.cycle_id = pd.cycle_id
          AND dw.processed = true
      ) pw ON true
      ORDER BY pd.cycle_id DESC
    )
    SELECT
      m.total_count,
      COALESCE(
        (SELECT json_agg(d.*) FROM draws_with_payouts d),
        '[]'::json
      ) AS rows
    FROM meta m;
  `;

  const result = await db.execute<DrawsEnvelopeRow>(query);
  const envelope = result.rows[0] ?? { total_count: 0, rows: [] };

  const totalCount = Number(envelope.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rawRows: RawDrawRow[] = Array.isArray(envelope.rows)
    ? envelope.rows
    : [];

  const data: DrawCycleSummaryDto[] = rawRows.map((r) => {
    const rawPayouts = Number(r.payouts_completed ?? 0);
    const payoutsCompleted = Math.min(Math.max(0, rawPayouts), r.winners_count);

    return {
      poolId: r.pool_id,
      cycleId: r.cycle_id,
      status: r.status as import("@/app/types").DrawStatusName,
      prizePot: Number(r.prize_pot),
      cycleFeeCollected: Number(r.cycle_fee_collected ?? 0),
      lockedTicketCount: Number(r.locked_ticket_count ?? 0),
      harvestSlot: Number(r.harvest_slot ?? 0),
      randomnessAccount: r.randomness_account || "",
      vrfSeedHex: r.vrf_seed_hex || "",
      winnersCount: r.winners_count,
      payoutsCompleted,
      hasPayoutRegistry: r.winners_count > 0,
      completedAt: isTerminalDrawStatus(r.status)
        ? (r.completed_at ?? r.block_time)
        : undefined,
      initiatedAt:
        r.initiated_at && r.initiated_at > 0 ? r.initiated_at : r.block_time,
      revealedAt: r.revealed_at ?? undefined,
    };
  });

  const allFinalized =
    data.length > 0 && data.every((d) => isTerminalDrawStatus(d.status));

  return {
    data,
    meta: {
      page,
      pageSize,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    },
    allFinalized,
  };
}
