import { Pool } from "pg";
import {
  pool as defaultPool,
  isDatabaseConfigured,
  DatabaseNotConfiguredError,
} from "./index";

/**
 * All tables populated by the indexer subsystem in topological/safe order.
 */
export const INDEXER_TABLE_NAMES = [
  "indexer_cursor",
  "protocol_events",
  "bonds_activity",
  "draw_history",
  "draw_winners",
  "pending_redemptions",
  "pool_snapshots",
  "user_portfolio_stats",
] as const;

export type IndexerTableName = (typeof INDEXER_TABLE_NAMES)[number];

export interface CleanDatabaseOptions {
  /** Connection pool to execute against (defaults to app/lib/db singleton pool) */
  pool?: Pool;
  /** Explicit list of tables to truncate (defaults to all INDEXER_TABLE_NAMES) */
  tables?: readonly IndexerTableName[];
  /** Whether to restart identity sequences (default: true) */
  restartIdentity?: boolean;
  /** Whether to cascade truncation to referencing foreign keys (default: true) */
  cascade?: boolean;
}

export interface CleanDatabaseResult {
  success: boolean;
  truncatedTables: readonly IndexerTableName[];
  durationMs: number;
}

/**
 * Atomically truncates indexer database tables and restarts identity sequences.
 */
export async function cleanIndexerDatabase(
  options: CleanDatabaseOptions = {}
): Promise<CleanDatabaseResult> {
  const activePool = options.pool ?? defaultPool;

  if (!options.pool && !isDatabaseConfigured) {
    throw new DatabaseNotConfiguredError();
  }

  const tablesToTruncate = options.tables ?? INDEXER_TABLE_NAMES;
  if (tablesToTruncate.length === 0) {
    return {
      success: true,
      truncatedTables: [],
      durationMs: 0,
    };
  }

  const restartClause =
    options.restartIdentity !== false ? "RESTART IDENTITY" : "";
  const cascadeClause = options.cascade !== false ? "CASCADE" : "";
  const tableListStr = tablesToTruncate.map((t) => `"${t}"`).join(", ");
  const query =
    `TRUNCATE TABLE ${tableListStr} ${restartClause} ${cascadeClause}`.trim();

  const start = Date.now();
  try {
    await activePool.query(query);
  } catch (err: unknown) {
    // Check for PostgreSQL error code 42P01 (relation / table does not exist)
    const pgError = err as { code?: string; message?: string };
    if (pgError.code === "42P01") {
      // Unmigrated or missing table; check which individual tables exist and truncate those
      const existingTablesResult = await activePool.query<{
        table_name: string;
      }>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [tablesToTruncate]
      );
      const existingTables = existingTablesResult.rows
        .map((r) => r.table_name)
        .filter((t): t is IndexerTableName =>
          (INDEXER_TABLE_NAMES as readonly string[]).includes(t)
        );

      if (existingTables.length > 0) {
        const fallbackListStr = existingTables.map((t) => `"${t}"`).join(", ");
        await activePool.query(
          `TRUNCATE TABLE ${fallbackListStr} ${restartClause} ${cascadeClause}`.trim()
        );
        return {
          success: true,
          truncatedTables: existingTables,
          durationMs: Date.now() - start,
        };
      } else {
        // No indexer tables exist yet (clean fresh DB)
        return {
          success: true,
          truncatedTables: [],
          durationMs: Date.now() - start,
        };
      }
    }
    throw err;
  }

  return {
    success: true,
    truncatedTables: tablesToTruncate,
    durationMs: Date.now() - start,
  };
}
