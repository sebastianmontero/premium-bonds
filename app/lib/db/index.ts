import * as fs from "node:fs";
import * as path from "node:path";
import { Pool, PoolConfig } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

// Fallback environment loading for CLI/Node environments where process.env was not preloaded
if (
  typeof process !== "undefined" &&
  !process.env.DATABASE_URL &&
  typeof process.loadEnvFile === "function"
) {
  try {
    const cwd = process.cwd();
    const envLocal = path.resolve(cwd, ".env.local");
    const envDefault = path.resolve(cwd, ".env");
    if (fs.existsSync(envLocal)) {
      process.loadEnvFile(envLocal);
    }
    if (fs.existsSync(envDefault)) {
      process.loadEnvFile(envDefault);
    }
  } catch {
    // Ignore fallback load errors in restricted or non-filesystem environments
  }
}

const connectionString = process.env.DATABASE_URL || "";

export const isDatabaseConfigured = Boolean(
  connectionString && connectionString.startsWith("postgres")
);

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "DATABASE_URL is not set or invalid. " +
        "Please configure DATABASE_URL in .env.local to use database features."
    );
    this.name = "DatabaseNotConfiguredError";
  }
}

/**
 * Derives pool configuration with dynamic SSL handling:
 * - Localhost / 127.0.0.1: SSL disabled (plain TCP)
 * - Remote / Cloud endpoints (e.g. Neon): SSL enabled with rejectUnauthorized: false
 */
export function getPoolConfig(connStr: string): PoolConfig {
  const isRemote =
    !connStr.includes("localhost") &&
    !connStr.includes("127.0.0.1") &&
    !connStr.includes("0.0.0.0");

  return {
    connectionString: connStr,
    max: 5,
    idleTimeoutMillis: 10_000,
    ssl: isRemote ? { rejectUnauthorized: false } : undefined,
  };
}

function createUnconfiguredPoolProxy(): Pool {
  const target = {} as Pool;
  const proxy = new Proxy(target, {
    get(_target, prop: string | symbol) {
      // 1. Safe Promise resolution (prevent thenable trapping in async functions)
      if (prop === "then") return undefined;

      // 2. Safe symbol inspection (Node util.inspect, Symbol.toStringTag, etc.)
      if (typeof prop === "symbol") return undefined;

      // 3. Graceful lifecycle teardown
      if (prop === "end") return async () => {};

      // 4. Safe property & EventEmitter inspection for drizzle-orm/node-postgres
      if (prop === "options") return {};
      if (prop === "_events" || prop === "_eventsCount") return undefined;
      if (prop === "listenerCount") return () => 0;

      // 5. Safe EventEmitter no-ops (return proxy for method chaining)
      if (
        prop === "on" ||
        prop === "addListener" ||
        prop === "removeListener" ||
        prop === "once" ||
        prop === "off" ||
        prop === "removeAllListeners"
      ) {
        return () => proxy;
      }
      if (prop === "emit") return () => false;
      if (prop === "toString") return () => "[Unconfigured Database Pool]";
      if (prop === "toJSON")
        return () => ({ type: "UnconfiguredDatabasePool" });
      if (prop === "constructor") return Object;

      // 6. Fail fast on operational method invocations (connect, query, etc.)
      return () => {
        throw new DatabaseNotConfiguredError();
      };
    },
  });
  return proxy;
}

const globalForDb = globalThis as unknown as {
  pool: Pool | undefined;
};

export const pool =
  globalForDb.pool ??
  (isDatabaseConfigured
    ? new Pool(getPoolConfig(connectionString))
    : createUnconfiguredPoolProxy());

if (isDatabaseConfigured && process.env.NODE_ENV !== "production") {
  globalForDb.pool = pool;
}

export const db = drizzle(pool, { schema });

/**
 * Deterministically closes the database connection pool.
 */
export async function closeDatabase(): Promise<void> {
  if (pool && typeof pool.end === "function") {
    await pool.end();
  }
}
