import * as path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { getPoolConfig } from "./index";

/**
 * Runs Drizzle database migrations against the specified PostgreSQL database.
 * Uses a single-connection pool and ensures deterministic teardown.
 */
export async function runMigrations(
  connectionString: string,
  migrationsFolder?: string
): Promise<void> {
  const poolConfig = getPoolConfig(connectionString);
  const pool = new Pool({ ...poolConfig, max: 1 });
  const db = drizzle(pool);
  const folder = migrationsFolder || path.resolve(process.cwd(), "drizzle");

  try {
    await migrate(db, { migrationsFolder: folder });
  } finally {
    await pool.end();
  }
}
