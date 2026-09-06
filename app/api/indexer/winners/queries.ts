import { sql } from "drizzle-orm";
import { db } from "@/app/lib/db";
import type { PrizeHistoryEntryDto } from "@/app/lib/indexer-mappers";
import type {
  PaginationMeta,
  PrizeLedgerAggregates,
  PrizeLedgerFilters,
} from "@/app/types/indexer-contracts";

export interface PaginatedWinnersResult {
  data: PrizeHistoryEntryDto[];
  meta: PaginationMeta;
  aggregates: PrizeLedgerAggregates;
}

interface RawWinnerRow extends Record<string, unknown> {
  pool_id: number;
  cycle_id: number;
  winner_index: number;
  winner_address: string;
  tier_index: number;
  amount_owed: string | number;
  winning_ticket_idx: string | number | null;
  processed: boolean;
  bonds_bought: string | number;
  dust_accumulated: string | number;
  claim_signature: string | null;
  revealed_at: number;
  vrf_seed_hex: string | null;
}

interface CteEnvelopeRow extends Record<string, unknown> {
  total_count: number;
  total_filtered_value: string;
  rows: RawWinnerRow[];
}

export async function fetchPaginatedWinners(
  filters: PrizeLedgerFilters
): Promise<PaginatedWinnersResult> {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(Math.max(1, filters.pageSize || 10), 100);
  const offset = (page - 1) * pageSize;

  const conditions: ReturnType<typeof sql>[] = [
    sql`w.pool_id = ${filters.poolId}`,
    sql`dh.status NOT IN ('Voided', 'ForceUnlocked')`,
  ];

  if (filters.user) {
    conditions.push(sql`w.winner_address = ${filters.user}`);
  }

  if (filters.cycleId !== undefined) {
    conditions.push(sql`w.cycle_id = ${filters.cycleId}`);
  }

  if (filters.status === "processing") {
    conditions.push(sql`w.processed = false`);
  } else if (filters.status === "reinvested") {
    conditions.push(sql`w.processed = true`);
  }

  if (filters.tier === "grand") {
    conditions.push(sql`w.tier_index = 0`);
  } else if (filters.tier === "runnerup") {
    conditions.push(sql`w.tier_index = 1`);
  } else if (filters.tier === "consolation") {
    conditions.push(sql`w.tier_index >= 2`);
  }

  if (filters.search) {
    const term = filters.search.trim().toLowerCase();
    const cleanNumeric = term.replace(/^#/, "").trim();
    const num = Number(cleanNumeric);

    if (!isNaN(num) && cleanNumeric !== "") {
      conditions.push(
        sql`(w.cycle_id = ${num} OR w.winning_ticket_idx = ${num} OR w.claim_signature ILIKE ${term + "%"})`
      );
    } else {
      conditions.push(
        sql`(w.claim_signature ILIKE ${term + "%"} OR dh.vrf_seed_hex ILIKE ${term + "%"})`
      );
    }
  }

  const whereClause =
    conditions.length > 0
      ? sql`WHERE ${sql.join(conditions, sql` AND `)}`
      : sql``;

  const query = sql`
    WITH filtered_winners AS (
      SELECT
        w.pool_id,
        w.cycle_id,
        w.winner_index,
        w.winner_address,
        w.tier_index,
        w.amount_owed,
        w.winning_ticket_idx,
        w.processed,
        w.bonds_bought,
        w.dust_accumulated,
        w.claim_signature,
        w.revealed_at,
        dh.vrf_seed_hex
      FROM draw_winners w
      INNER JOIN draw_history dh
        ON w.pool_id = dh.pool_id AND w.cycle_id = dh.cycle_id
      ${whereClause}
    ),
    meta AS (
      SELECT
        COUNT(*)::int AS total_count,
        COALESCE(SUM(amount_owed), 0)::text AS total_filtered_value
      FROM filtered_winners
    ),
    paged_rows AS (
      SELECT *
      FROM filtered_winners
      ORDER BY cycle_id DESC, tier_index ASC, amount_owed DESC, winner_index ASC
      LIMIT ${pageSize} OFFSET ${offset}
    )
    SELECT
      m.total_count,
      m.total_filtered_value,
      COALESCE(
        (SELECT json_agg(r.*) FROM paged_rows r),
        '[]'::json
      ) AS rows
    FROM meta m;
  `;

  const result = await db.execute<CteEnvelopeRow>(query);
  const envelope = result.rows[0] ?? {
    total_count: 0,
    total_filtered_value: "0",
    rows: [],
  };

  const totalCount = Number(envelope.total_count || 0);
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const rawRows: RawWinnerRow[] = Array.isArray(envelope.rows)
    ? envelope.rows
    : [];

  const data: PrizeHistoryEntryDto[] = rawRows.map((r) => ({
    poolId: r.pool_id,
    cycleId: r.cycle_id,
    winnerIndex: r.winner_index,
    winnerAddress: r.winner_address,
    tierIndex: r.tier_index,
    amountOwed: String(r.amount_owed ?? "0"),
    winningTicketIdx:
      r.winning_ticket_idx != null ? String(r.winning_ticket_idx) : null,
    processed: Boolean(r.processed),
    bondsBought: String(r.bonds_bought ?? "0"),
    dustAccumulated: String(r.dust_accumulated ?? "0"),
    claimSignature: r.claim_signature ?? null,
    revealedAt: Number(r.revealed_at || 0),
    vrfSeedHex: r.vrf_seed_hex ?? null,
  }));

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
    aggregates: {
      totalFilteredValue: envelope.total_filtered_value || "0",
    },
  };
}
