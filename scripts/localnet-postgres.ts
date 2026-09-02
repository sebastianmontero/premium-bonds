import { spawn } from "node:child_process";
import { Client } from "pg";
import { runMigrations } from "../app/lib/db/migrate";

const DEFAULT_ADMIN_URL =
  "postgresql://postgres:postgres@127.0.0.1:5432/postgres";
const DEFAULT_POSTGRES_READY_TIMEOUT_MS = 30_000;
const POSTGRES_PROBE_TIMEOUT_MS = 1_500;
const POLL_INTERVAL_MS = 500;

/**
 * Executes 'docker compose up -d postgres' asynchronously while streaming
 * output to stdout/stderr so image download progress is visible.
 */
async function runDockerComposeUp(): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("docker", ["compose", "up", "-d", "postgres"], {
      stdio: "inherit",
    });

    proc.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "ENOENT") {
        reject(
          new Error(
            "Docker CLI is not installed or not found in PATH. Please install Docker to use the containerized PostgreSQL service."
          )
        );
      } else {
        reject(err);
      }
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
          new Error(
            `"docker compose up -d postgres" exited with non-zero exit code ${code}.`
          )
        );
      }
    });
  });
}

/**
 * Validates and sanitizes a local database name to prevent SQL injection in DDL.
 */
export function sanitizeDatabaseName(rawName: string): string {
  const trimmed = rawName.trim();
  // Strip .sqlite extension if passed
  const base = trimmed.endsWith(".sqlite") ? trimmed.slice(0, -7) : trimmed;
  // Prefix with pb_local_ if not present
  const full = base.startsWith("pb_local_") ? base : `pb_local_${base}`;

  if (!/^[a-zA-Z0-9_]+$/.test(full)) {
    throw new Error(
      `Invalid database name "${rawName}". Name must only contain alphanumeric characters and underscores.`
    );
  }
  return full;
}

/**
 * Attempts an active PostgreSQL handshake query (SELECT 1).
 */
export async function isPostgresReady(
  connectionString = DEFAULT_ADMIN_URL,
  timeoutMs = 2000
): Promise<boolean> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch {
    try {
      await client.end();
    } catch {
      // Ignore teardown errors
    }
    return false;
  }
}

/**
 * Ensures PostgreSQL service is accepting connections on 127.0.0.1:5432.
 * If down, attempts auto-starting via Docker Compose and polls readiness.
 */
export async function ensurePostgresRunning(
  timeoutMs = DEFAULT_POSTGRES_READY_TIMEOUT_MS
): Promise<void> {
  const ready = await isPostgresReady(
    DEFAULT_ADMIN_URL,
    POSTGRES_PROBE_TIMEOUT_MS
  );
  if (ready) {
    return;
  }

  console.log(
    "🐘 [Localnet] PostgreSQL not detected on 127.0.0.1:5432. Starting container via Docker Compose..."
  );

  try {
    await runDockerComposeUp();
  } catch (err: unknown) {
    const errorDetails = err instanceof Error ? err.message : String(err);
    throw new Error(
      "\n❌ [PostgreSQL Unavailable]\n" +
        "Could not start PostgreSQL container via Docker Compose.\n" +
        `Reason: ${errorDetails}\n\n` +
        "Troubleshooting steps:\n" +
        "  1. Ensure Docker Desktop / daemon is running.\n" +
        "  2. Check if port 5432 is already occupied: 'lsof -i :5432' or 'ss -tulpn | grep 5432'.\n" +
        "  3. Alternatively, start your native PostgreSQL service: 'sudo systemctl start postgresql'\n"
    );
  }

  const startTime = Date.now();
  while (Date.now() - startTime < timeoutMs) {
    if (await isPostgresReady(DEFAULT_ADMIN_URL, POSTGRES_PROBE_TIMEOUT_MS)) {
      console.log(
        "✅ [Localnet] PostgreSQL container is ready and accepting connections."
      );
      return;
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }

  throw new Error(
    `Timed out waiting ${timeoutMs / 1000}s for PostgreSQL to become ready on 127.0.0.1:5432.\n` +
      "Check container logs with: 'docker logs pb-postgres'"
  );
}

/**
 * Ensures the target local PostgreSQL database exists and has migrations applied.
 */
export async function ensureLocalDatabase(
  dbName: string,
  migrationsFolder?: string
): Promise<string> {
  const cleanDbName = sanitizeDatabaseName(dbName);
  const targetUrl = `postgresql://postgres:postgres@127.0.0.1:5432/${cleanDbName}`;

  const adminClient = new Client({ connectionString: DEFAULT_ADMIN_URL });
  await adminClient.connect();

  try {
    const checkRes = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [cleanDbName]
    );

    if (checkRes.rowCount === 0) {
      console.log(`📦 Creating PostgreSQL database "${cleanDbName}"...`);
      await adminClient.query(`CREATE DATABASE "${cleanDbName}"`);
      console.log(`✅ Created database "${cleanDbName}".`);
    }
  } finally {
    await adminClient.end();
  }

  // Run migrations against the newly verified / created database
  console.log(
    `🚀 Applying migrations to PostgreSQL database "${cleanDbName}"...`
  );
  await runMigrations(targetUrl, migrationsFolder);
  console.log(`✅ Migrations up to date on "${cleanDbName}".`);

  return targetUrl;
}

/**
 * Forcefully drops a local PostgreSQL database after terminating active connections.
 */
export async function dropLocalDatabase(dbName: string): Promise<boolean> {
  const cleanDbName = sanitizeDatabaseName(dbName);
  const adminClient = new Client({ connectionString: DEFAULT_ADMIN_URL });
  await adminClient.connect();

  try {
    const checkRes = await adminClient.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      [cleanDbName]
    );

    if (checkRes.rowCount === 0) {
      return false;
    }

    console.log(
      `🗑️ Terminating active connections and dropping database "${cleanDbName}"...`
    );
    // Terminate other backend connections
    await adminClient.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [cleanDbName]
    );

    // Drop database
    await adminClient.query(`DROP DATABASE IF EXISTS "${cleanDbName}"`);
    console.log(`✅ Dropped PostgreSQL database "${cleanDbName}".`);
    return true;
  } finally {
    await adminClient.end();
  }
}

export interface LocalDatabaseInfo {
  name: string;
  sizeBytes: number;
}

/**
 * Lists all local pb_local_* databases.
 */
export async function listLocalDatabases(): Promise<LocalDatabaseInfo[]> {
  if (!(await isPostgresReady(DEFAULT_ADMIN_URL, 1000))) {
    return [];
  }

  const adminClient = new Client({ connectionString: DEFAULT_ADMIN_URL });
  await adminClient.connect();

  try {
    const res = await adminClient.query<{
      datname: string;
      size_bytes: string;
    }>(
      `SELECT datname, pg_database_size(datname) as size_bytes
       FROM pg_database
       WHERE datname LIKE 'pb_local_%' AND datistemplate = false
       ORDER BY datname ASC`
    );

    return res.rows.map((r) => ({
      name: r.datname,
      sizeBytes: parseInt(r.size_bytes, 10) || 0,
    }));
  } finally {
    await adminClient.end();
  }
}
