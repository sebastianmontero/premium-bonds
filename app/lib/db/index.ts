import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";
import * as schema from "./schema";

// Configure WebSocket for Neon Serverless in Node.js runtime & CLI scripts
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
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

      // 4. Safe EventEmitter no-ops (return proxy for method chaining)
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

      // 5. Fail fast on operational method invocations (connect, query, etc.)
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
    ? new Pool({
        connectionString,
        max: 5,
        idleTimeoutMillis: 10_000,
      })
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
