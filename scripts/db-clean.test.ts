import { describe, it } from "node:test";
import * as assert from "node:assert";
import { Readable, Writable } from "node:stream";
import { Pool } from "pg";
import {
  cleanIndexerDatabase,
  INDEXER_TABLE_NAMES,
  CleanDatabaseOptions,
} from "../app/lib/db/clean";
import {
  maskDatabaseUrl,
  runDbCleanCli,
  CliIo,
  cleanRelayerCursorFiles,
} from "./db-clean";
import { sanitizeDatabaseName, isPostgresReady } from "./localnet-postgres";
import { DatabaseNotConfiguredError } from "../app/lib/db";

describe("maskDatabaseUrl", () => {
  it("masks standard credentials in database URLs", () => {
    const raw =
      "postgresql://postgres:secretpassword@localhost:5432/pb_local_test";
    const masked = maskDatabaseUrl(raw);
    assert.equal(
      masked,
      "postgresql://postgres:***@localhost:5432/pb_local_test"
    );
  });

  it("handles complex special characters in passwords", () => {
    const raw =
      "postgresql://myuser:p%40ss%3Aword%23123@db.host.com:5432/prod_db";
    const masked = maskDatabaseUrl(raw);
    assert.equal(masked, "postgresql://myuser:***@db.host.com:5432/prod_db");
  });

  it("handles URLs without passwords", () => {
    const raw = "postgresql://localhost:5432/pb_local_test";
    const masked = maskDatabaseUrl(raw);
    assert.equal(masked, "postgresql://localhost:5432/pb_local_test");
  });

  it("handles empty or unconfigured strings gracefully", () => {
    assert.equal(maskDatabaseUrl(""), "[not configured]");
  });
});

describe("sanitizeDatabaseName", () => {
  it("prefixes simple database names with pb_local_", () => {
    assert.equal(sanitizeDatabaseName("test"), "pb_local_test");
    assert.equal(sanitizeDatabaseName("demo_1"), "pb_local_demo_1");
  });

  it("preserves names that already have pb_local_ prefix", () => {
    assert.equal(sanitizeDatabaseName("pb_local_dev"), "pb_local_dev");
  });

  it("strips .sqlite suffix before prefixing", () => {
    assert.equal(sanitizeDatabaseName("testnet.sqlite"), "pb_local_testnet");
  });

  it("throws on invalid characters to prevent SQL injection in DDL", () => {
    assert.throws(
      () => sanitizeDatabaseName("test; DROP DATABASE postgres;"),
      /Invalid database name/
    );
    assert.throws(
      () => sanitizeDatabaseName("test-db-hyphen"),
      /Invalid database name/
    );
    assert.throws(
      () => sanitizeDatabaseName("test db space"),
      /Invalid database name/
    );
  });
});

describe("cleanIndexerDatabase", () => {
  it("contains all 8 indexer tables in INDEXER_TABLE_NAMES", () => {
    assert.equal(INDEXER_TABLE_NAMES.length, 8);
    assert.ok(INDEXER_TABLE_NAMES.includes("indexer_cursor"));
    assert.ok(INDEXER_TABLE_NAMES.includes("protocol_events"));
    assert.ok(INDEXER_TABLE_NAMES.includes("bonds_activity"));
    assert.ok(INDEXER_TABLE_NAMES.includes("draw_history"));
    assert.ok(INDEXER_TABLE_NAMES.includes("draw_winners"));
    assert.ok(INDEXER_TABLE_NAMES.includes("pending_redemptions"));
    assert.ok(INDEXER_TABLE_NAMES.includes("pool_snapshots"));
    assert.ok(INDEXER_TABLE_NAMES.includes("user_portfolio_stats"));
  });

  it("executes atomic TRUNCATE statement against injected pool", async () => {
    const executedQueries: string[] = [];
    const mockPool = {
      async query(sql: string) {
        executedQueries.push(sql);
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;

    const result = await cleanIndexerDatabase({ pool: mockPool });

    assert.equal(result.success, true);
    assert.equal(result.truncatedTables.length, 8);
    assert.equal(executedQueries.length, 1);
    assert.ok(
      executedQueries[0].startsWith("TRUNCATE TABLE ") &&
        executedQueries[0].includes('"protocol_events"') &&
        executedQueries[0].endsWith("RESTART IDENTITY CASCADE")
    );
  });

  it("supports truncating a custom subset of tables without restart identity", async () => {
    const executedQueries: string[] = [];
    const mockPool = {
      async query(sql: string) {
        executedQueries.push(sql);
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;

    const result = await cleanIndexerDatabase({
      pool: mockPool,
      tables: ["indexer_cursor", "protocol_events"],
      restartIdentity: false,
      cascade: false,
    });

    assert.equal(result.success, true);
    assert.deepEqual(result.truncatedTables, [
      "indexer_cursor",
      "protocol_events",
    ]);
    assert.equal(
      executedQueries[0],
      'TRUNCATE TABLE "indexer_cursor", "protocol_events"'
    );
  });

  it("handles missing tables (Postgres error 42P01) gracefully on fresh/unmigrated DB", async () => {
    let callCount = 0;
    const executedQueries: string[] = [];
    const mockPool = {
      async query(sql: string, params?: unknown[]) {
        executedQueries.push(sql);
        callCount++;
        if (callCount === 1) {
          // Simulate table does not exist error
          const err = new Error(
            'relation "protocol_events" does not exist'
          ) as Error & {
            code: string;
          };
          err.code = "42P01";
          throw err;
        }
        if (callCount === 2) {
          // Response for information_schema query
          return { rows: [{ table_name: "indexer_cursor" }] };
        }
        return { rows: [], rowCount: 0 };
      },
    } as unknown as Pool;

    const result = await cleanIndexerDatabase({ pool: mockPool });

    assert.equal(result.success, true);
    assert.deepEqual(result.truncatedTables, ["indexer_cursor"]);
    assert.equal(callCount, 3);
  });
});

describe("runDbCleanCli", () => {
  function createMockStreams(inputs: string[] = []) {
    let outputData = "";
    const stdout = new Writable({
      write(chunk, _encoding, callback) {
        outputData += chunk.toString();
        callback();
      },
    });

    const stdin = Readable.from(inputs.map((str) => Buffer.from(str + "\n")));

    return {
      stdin,
      stdout,
      getOutput: () => outputData,
    };
  }

  it("prints usage help and exits 0 on --help", async () => {
    const { stdin, stdout, getOutput } = createMockStreams();
    const code = await runDbCleanCli(["--help"], {
      stdin,
      stdout,
      isTTY: true,
    });

    assert.equal(code, 0);
    const out = getOutput();
    assert.ok(out.includes("Usage: npm run db:clean"));
    assert.ok(out.includes("--force"));
  });

  it("fails fast with exit code 1 when non-interactive and --force is missing", async () => {
    const { stdin, stdout, getOutput } = createMockStreams();
    const mockPool = {
      async query() {
        return { rows: [] };
      },
    } as unknown as Pool;

    const code = await runDbCleanCli([], {
      stdin,
      stdout,
      isTTY: false,
      pool: mockPool,
    });

    assert.equal(code, 1);
    const out = getOutput();
    assert.ok(out.includes("Non-interactive environment detected"));
    assert.ok(out.includes("--force"));
  });

  it("executes truncation directly when --force is passed in non-interactive mode", async () => {
    const { stdin, stdout, getOutput } = createMockStreams();
    let truncated = false;
    const mockPool = {
      async query() {
        truncated = true;
        return { rows: [] };
      },
    } as unknown as Pool;

    const code = await runDbCleanCli(["--force"], {
      stdin,
      stdout,
      isTTY: false,
      pool: mockPool,
    });

    assert.equal(code, 0);
    assert.equal(truncated, true);
    assert.ok(getOutput().includes("Successfully truncated"));
  });

  it("prompts for confirmation in interactive mode and truncates on 'y'", async () => {
    const { stdin, stdout, getOutput } = createMockStreams(["y"]);
    let truncated = false;
    const mockPool = {
      async query() {
        truncated = true;
        return { rows: [] };
      },
    } as unknown as Pool;

    const code = await runDbCleanCli([], {
      stdin,
      stdout,
      isTTY: true,
      pool: mockPool,
    });

    assert.equal(code, 0);
    assert.equal(truncated, true);
    assert.ok(getOutput().includes("Are you sure you want to truncate"));
    assert.ok(getOutput().includes("Successfully truncated"));
  });

  it("prompts for confirmation in interactive mode and cancels on 'n'", async () => {
    const { stdin, stdout, getOutput } = createMockStreams(["n"]);
    let truncated = false;
    const mockPool = {
      async query() {
        truncated = true;
        return { rows: [] };
      },
    } as unknown as Pool;

    const code = await runDbCleanCli([], {
      stdin,
      stdout,
      isTTY: true,
      pool: mockPool,
    });

    assert.equal(code, 0);
    assert.equal(truncated, false);
    assert.ok(getOutput().includes("Operation cancelled"));
  });
});
